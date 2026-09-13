import type { SubCount } from '../../shared/taxonomy';
import type { Outlet, Story } from '../../shared/types';
import { fetchJson, keep, readFresh } from './load';
import { deleteEntry, forgetStamp, readEntry } from './store';

/**
 * The world this tab is holding, and everything that loads or drops it.
 *
 * This lived inside SectionFeed.tsx, which made a component the owner of the
 * app's feed data: a scroll container imported its warm helper, a preferences
 * utility imported clearSections, and importing the component armed a
 * fifteen-minute timer. None of that was about rendering a section. The
 * component renders; this decides what there is to render.
 *
 * Warming is the router's now. The strip calls preloadRoute on intent, which
 * runs the feed routes' loader, which is loadWorld - so there is no separate
 * warm helper to keep in step with it.
 */
/** What one category answers with. Derived from the world now rather than
 *  fetched, but the same shape this component has always rendered. */
export type SectionStory = Story & { subs: string[]; cslug: string; outlets: Outlet[] };
export type SectionData = {
  stamp: string | null; name: string; kind: 'scope' | 'topic'; subs: SubCount[];
  total: number; ids: string[]; stories: SectionStory[];
};

type WorldSection = {
  name: string; kind: 'scope' | 'topic'; total: number; ids: string[]; subs: SubCount[];
};
export type World = {
  stamp: string | null; sections: Record<string, WorldSection>; stories: SectionStory[];
};

const WORLD = '/api/world';
const TTL_MS = 60_000;

/**
 * One fetch for everything the reader can read.
 *
 * The fourteen sections are fourteen orderings of a single forty-eight-hour
 * pool of about three hundred stories, so asking per section re-sent rows the
 * browser already held under another heading — and cost a request for every
 * tap on the strip. The bodies arrive once, deduplicated; a section switch, a
 * story opening and a related-stories list are all reads of this array.
 *
 * Module scope, so it survives every navigation inside the app and dies with
 * the tab.
 */
let inflight: Promise<World> | null = null;
let at = 0;

export function loadWorld(): Promise<World> {
  if (inflight && Date.now() - at < TTL_MS) return inflight;
  at = Date.now();
  const p = resolve();
  inflight = p;
  p.catch(() => { if (inflight === p) { inflight = null; at = 0; } });
  return p;
}

/**
 * Stored copy first, and no request at all when it is still current.
 *
 * The stamp is one small answer for the whole app, so asking it and finding it
 * unchanged settles everything this browser holds. Only when it has moved — at
 * most every fifteen minutes, usually less — is there anything to fetch, and
 * then only the handful of stories the last pipeline run produced.
 */
async function resolve(): Promise<World> {
  // readFresh is load.ts's persist check. What it cannot do generically is the
  // rest of this function: when the stamp HAS moved, the stored copy is still
  // worth something - it holds three hundred bodies that have not changed - so
  // this asks for what is newer and merges, rather than re-fetching all of it.
  const { data: current } = await readFresh<World>(WORLD);
  if (current) return current;

  const stale = await readEntry<World>(WORLD);
  const have = stale?.data;
  const since = have?.stories.length
    ? Math.max(...have.stories.map((s) => s.last_seen))
    : 0;
  const fresh = await ask(since);
  if (!since) { keep(WORLD, fresh.stamp, fresh); return fresh; }

  const merged = merge(have!, fresh);
  // A delta naming a body we no longer hold means storage was evicted under
  // us. One full answer is cheaper and simpler than an endpoint per id.
  const wanted = new Set(Object.values(merged.sections).flatMap((x) => x.ids));
  if (merged.stories.length < wanted.size) {
    const whole = await ask(0);
    keep(WORLD, whole.stamp, whole);
    return whole;
  }
  keep(WORLD, merged.stamp, merged);
  return merged;
}

function ask(since: number): Promise<World> {
  return fetchJson<World>(since ? `${WORLD}?since=${since}` : WORLD);
}

/**
 * The orderings always arrive in full and the bodies do not: an id that stops
 * appearing is how this learns a story was reaped, which a `since` alone could
 * never say.
 */
function merge(have: World, delta: World): World {
  const bodies = new Map<string, SectionStory>();
  for (const s of have.stories) bodies.set(s.id, s);
  for (const s of delta.stories) bodies.set(s.id, s);

  const wanted = new Set(Object.values(delta.sections).flatMap((x) => x.ids));
  return {
    stamp: delta.stamp,
    sections: delta.sections,
    stories: [...wanted].map((id) => bodies.get(id)).filter((s): s is SectionStory => !!s),
  };
}

/** Built once per world rather than once per section: fourteen sections read
 *  the same three hundred rows. */
const index = new WeakMap<World, Map<string, SectionStory>>();
function byId(w: World): Map<string, SectionStory> {
  let m = index.get(w);
  if (!m) { m = new Map(w.stories.map((s) => [s.id, s])); index.set(w, m); }
  return m;
}

export function sectionFrom(w: World, cat: string): SectionData {
  const s = w.sections[cat];
  const by = byId(w);
  return {
    stamp: w.stamp,
    name: s?.name ?? cat,
    kind: s?.kind ?? 'topic',
    subs: s?.subs ?? [],
    total: s?.total ?? 0,
    ids: s?.ids ?? [],
    stories: (s?.ids ?? []).map((id) => by.get(id)).filter((x): x is SectionStory => !!x),
  };
}

/**
 * Drop it outright. Saving preferences re-ranks four of the fourteen
 * orderings, and what is held here was built before the save; a TTL would let
 * the old order stand for up to a minute after the reader watched it change.
 */
export function clearSections() {
  inflight = null; at = 0;
  // IndexedDB outlives the tab and is keyed on the cycle stamp, which a
  // preference change does not move. Dropping the map alone would read the
  // old ranking straight back off disk.
  deleteEntry(WORLD);
}

/**
 * The pipeline moves every fifteen minutes, so this asks on the same clock.
 *
 * It costs a stamp read, not a world: `resolve` returns the stored copy
 * untouched when the stamp has not moved, and when it has, `since` brings back
 * the three or four stories that run produced rather than three hundred.
 *
 * Only while the tab is being looked at — a backgrounded PWA polls nothing —
 * and again the moment it comes back, which is when a reader who left it open
 * for an hour looks again.
 */
const REFRESH_MS = 15 * 60_000;

function refresh() {
  if (document.visibilityState !== 'visible') return;
  forgetStamp();
  at = 0;
  void loadWorld().catch(() => {});
}

/**
 * Arms the refresh, and hands back the way to disarm it.
 *
 * This ran at module scope, which meant importing the feed component started a
 * fifteen-minute timer whether or not one was ever rendered, and nothing could
 * stop it. __root calls this once; the cleanup matters mostly because a test
 * that leaves a timer running poisons the next one.
 */
export function startWorldRefresh(): () => void {
  const timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', refresh);
  };
}
