'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Outlet, Story } from '@/lib/feed';
import type { SubCount } from '@/lib/taxonomy';
import { StoryCard, variantFor } from './StoryCard';
import { SubcategoryStrip } from './SubcategoryStrip';
import { forgetStamp, readEntry, sessionStamp, writeEntry } from '@/lib/store';

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
type World = {
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
let held: World | null = null;
let at = 0;

export function loadWorld(): Promise<World> {
  if (inflight && Date.now() - at < TTL_MS) return inflight;
  at = Date.now();
  const p = resolve();
  inflight = p;
  p.then((w) => { if (inflight === p) held = w; })
   .catch(() => { if (inflight === p) { inflight = null; at = 0; } });
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
  const [stamp, stored] = await Promise.all([sessionStamp(), readEntry<World>(WORLD)]);
  const have = stored?.data;
  if (have && stamp && stored.stamp === stamp) return have;

  const since = have?.stories.length
    ? Math.max(...have.stories.map((s) => s.last_seen))
    : 0;
  const fresh = await ask(since);
  if (!since) { writeEntry(WORLD, fresh.stamp, fresh); return fresh; }

  const merged = merge(have!, fresh);
  // A delta naming a body we no longer hold means storage was evicted under
  // us. One full answer is cheaper and simpler than an endpoint per id.
  const wanted = new Set(Object.values(merged.sections).flatMap((x) => x.ids));
  if (merged.stories.length < wanted.size) {
    const whole = await ask(0);
    writeEntry(WORLD, whole.stamp, whole);
    return whole;
  }
  writeEntry(WORLD, merged.stamp, merged);
  return merged;
}

async function ask(since: number): Promise<World> {
  const res = await fetch(since ? `${WORLD}?since=${since}` : WORLD);
  if (!res.ok) throw new Error(String(res.status));
  return await res.json() as World;
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

export function loadSection(cat: string): Promise<SectionData> {
  return loadWorld().then((w) => sectionFrom(w, cat));
}

/**
 * Drop it outright. Saving preferences re-ranks four of the fourteen
 * orderings, and what is held here was built before the save; a TTL would let
 * the old order stand for up to a minute after the reader watched it change.
 */
export function clearSections() { inflight = null; held = null; at = 0; }

/** Warm without rendering — the strip calls this on hover and on touch-down.
 *  There is one answer for every section now, so the category is immaterial. */
export function warmSection(_cat?: string) { void loadWorld().catch(() => {}); }

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

if (typeof document !== 'undefined') {
  setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', refresh);
}

export function SectionFeed({ cat, name }: { cat: string; name: string }) {
  const sub = useSearchParams().get('sub');
  // A cached section renders in the first commit, with no loading state at all.
  const [data, setData] = useState<SectionData | null>(() => peek(cat));
  const [failed, setFailed] = useState(false);

  // Only `cat`. Changing the sub used to re-run this and fetch the same rows
  // back under a different query string; it is now a filter over what is
  // already here, so the strip responds with no request at all.
  useEffect(() => {
    let live = true;
    const cached = peek(cat);
    if (cached) { setData(cached); setFailed(false); return; }

    setData(null);
    setFailed(false);
    loadSection(cat)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [cat]);

  if (failed) {
    return (
      <div className="panel">
        <div className="label">Could not load</div>
        <p>{name} did not come back. Check your connection and try again.</p>
      </div>
    );
  }
  if (!data) return <SectionSkeleton />;

  // An unknown or now-empty ?sub= shows the whole section rather than an empty
  // one: the keyword lists run against live rows, and yesterday's link should
  // still land somewhere useful.
  const active = sub && data.subs.some((s) => s.slug === sub) ? sub : null;
  // A scope section's pills are the ten topics, so its filter is the story's
  // own category; a topic section's are its keyword lists, which each row
  // carries the verdicts for.
  const shown = !active ? data.stories
    : data.kind === 'scope' ? data.stories.filter((s) => s.cslug === active)
    : data.stories.filter((s) => s.subs.includes(active));

  return (
    <>
      <SubcategoryStrip cat={cat} label={name} base={`/c/${cat}`}
                        subs={data.subs} active={active} />
      {shown.length === 0 ? (
        <div className="panel">
          <div className="label">Quiet so far</div>
          <p>
            Nothing has been filed under {data.subs.find((s) => s.slug === active)?.name ?? name}
            {' '}in the last two days. The main feed still carries these stories when they turn up.
          </p>
        </div>
      ) : (
        <div className="feed">
          {shown.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
        </div>
      )}
    </>
  );
}

function peek(cat: string): SectionData | null {
  return held ? sectionFrom(held, cat) : null;
}

export function SectionSkeleton() {
  return (
    <>
      <div className="substrip" aria-hidden><div className="substrip__row" /></div>
      <div className="feed" aria-busy="true" aria-label="Loading stories">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className={`skel ${i === 0 ? 'skel--lead' : i % 3 === 2 ? 'skel--compact' : ''}`} />
        ))}
      </div>
    </>
  );
}
