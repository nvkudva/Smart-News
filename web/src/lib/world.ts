import type { SubCount } from '../../shared/taxonomy';
import type { Outlet, Story } from '../../shared/types';
import { fetchJson, keep, readFresh } from './load';
import { forgetStamp, readEntry, unstampEntry } from './store';

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
  name: string; kind: 'scope' | 'topic'; subs: SubCount[]; stories: SectionStory[];
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
  //
  // A preference change re-ranks the orderings without moving the stamp, so
  // the stored copy cannot be trusted as fresh - but its bodies are still
  // good, and `since` lets the server send only the orderings and whatever is
  // newer. It used to delete the copy and re-fetch all three hundred bodies
  // for a change to the list of hidden categories.
  const force = unstamping;
  unstamping = null;
  // Before the freshness check below, and before this load's own write: the
  // unstamp is a read then a write in two transactions, and landing after
  // keep() would replace a fresh world with the stale one.
  if (force) await force;
  else {
    const { data: current } = await readFresh<World>(WORLD);
    if (current) return warmed(current);
  }

  const stale = await readEntry<World>(WORLD);
  // Nothing stored is the same shape as nothing worth keeping: `since` is 0, so
  // `ask` returns the whole world and merging it over an empty one is itself.
  // Special-casing that was a branch and a non-null assertion for a state merge
  // already answers.
  const have = stale?.data ?? { stamp: null, sections: {}, stories: [] };
  // Both clocks: a written story keeps the last_seen its articles gave it and
  // is written hours later, so a cursor on last_seen alone sat behind nearly
  // every new story and the delta came back short every cycle.
  const since = have.stories.length
    ? Math.max(...have.stories.map((s) => Math.max(s.last_seen, s.summarised_at ?? 0)))
    : 0;

  // `short` is merge's answer, not part of the world, so it does not get stored.
  const { short, ...merged } = merge(have, await ask(since));
  // A delta naming a body we no longer hold means storage was evicted under
  // us. One full answer is cheaper and simpler than an endpoint per id.
  if (short) {
    const whole = await ask(0);
    keep(WORLD, whole.stamp, whole);
    return warmed(whole);
  }
  keep(WORLD, merged.stamp, merged);
  return warmed(merged);
}

/**
 * Hand the worker the photographs to fetch ahead of the scroll, so a story
 * opened offline has its picture and not just its tint. Newest first, because
 * that is the order the feed shows them in and the worker caps the batch. The
 * worker skips what it already holds, so this is cheap to send on every load.
 */
function warmed(w: World): World {
  // `ready`, not `controller`: on the very first load the world resolves
  // before the worker has claimed the page, and a message to nobody is lost.
  const urls = [...w.stories]
    .sort((a, b) => b.last_seen - a.last_seen)
    .flatMap((s) => (s.image_url ? [s.image_url] : []));
  if (urls.length && typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then((reg) => reg.active?.postMessage({ type: 'sn:warm', urls: [...new Set(urls)] }))
      .catch(() => {});
  }
  return w;
}

/**
 * Past the browser's own cache: the client only asks when the stamp moved or
 * the preferences changed, so every ask is one it wants answered. Left to
 * max-age and stale-while-revalidate, a re-ask after a preference change could
 * be answered with the previous delta - same URL, same `since` - and the old
 * ordering would be stored against a stamp that cannot expire it.
 */
function ask(since: number): Promise<World> {
  return fetchJson<World>(since ? `${WORLD}?since=${since}` : WORLD, undefined, { cache: 'no-cache' });
}

/**
 * The world only if this browser already holds it - in memory, or on disk and
 * still current - and never a fetch. A story page reached from the feed has
 * it; a shared link opened cold does not, and downloading three hundred bodies
 * to show one of them is the wrong trade, so that page asks for its story.
 */
export async function heldWorld(): Promise<World | null> {
  if (inflight && Date.now() - at < TTL_MS) return inflight.catch(() => null);
  return (await readFresh<World>(WORLD)).data;
}

/**
 * The orderings always arrive in full and the bodies do not: an id that stops
 * appearing is how this learns a story was reaped, which a `since` alone could
 * never say.
 */
function merge(have: World, delta: World): World & { short: boolean } {
  const bodies = new Map<string, SectionStory>();
  for (const s of have.stories) bodies.set(s.id, s);
  for (const s of delta.stories) bodies.set(s.id, s);

  // The set was built here and then again by the caller to ask the one question
  // it wanted of it: is a named body missing.
  const wanted = new Set(Object.values(delta.sections).flatMap((x) => x.ids));
  const stories = [...wanted].map((id) => bodies.get(id)).filter((s): s is SectionStory => !!s);
  return {
    stamp: delta.stamp,
    sections: delta.sections,
    stories,
    short: stories.length < wanted.size,
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

/** One story out of the world, or null when the id is not in the window. */
export function storyFrom(w: World, id: string): SectionStory | null {
  return byId(w).get(id) ?? null;
}

export function sectionFrom(w: World, cat: string): SectionData {
  const s = w.sections[cat];
  // One missing-section case, stated once, instead of a default per field.
  if (!s) return { name: cat, kind: 'topic', subs: [], stories: [] };

  const by = byId(w);
  return {
    name: s.name,
    kind: s.kind,
    subs: s.subs,
    stories: s.ids.map((id) => by.get(id)).filter((x): x is SectionStory => !!x),
  };
}

/**
 * Drop it outright. Saving preferences re-ranks four of the fourteen
 * orderings, and what is held here was built before the save; a TTL would let
 * the old order stand for up to a minute after the reader watched it change.
 */
let unstamping: Promise<void> | null = null;

/**
 * The orderings are stale; the bodies are not. IndexedDB outlives the tab and
 * is keyed on the cycle stamp, which a preference change does not move, so the
 * stored copy loses its stamp on disk - a reload inside the same cycle must
 * not read the old ranking back - and the next load in this session is told
 * outright, holding the write so it can wait for it.
 */
export function clearSections() {
  inflight = null; at = 0;
  unstamping = unstampEntry(WORLD).catch(() => {});
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
