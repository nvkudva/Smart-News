'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Story } from '@/lib/feed';
import type { SubCount } from '@/lib/taxonomy';
import { StoryCard, variantFor } from './StoryCard';
import { SubcategoryStrip } from './SubcategoryStrip';
import { readEntry, sessionStamp, writeEntry } from '@/lib/store';

/** What one category answers with. `active` is gone: the sub-filter is the
 *  client's business now, and the rows carry the verdicts to do it with. */
export type SectionStory = Story & { subs: string[] };
export type SectionData = {
  stamp: string | null; name: string; subs: SubCount[];
  total: number; ids: string[]; stories: SectionStory[];
};

/**
 * Module scope, so it survives every navigation inside the app and dies with
 * the tab. A section the reader has already opened — or hovered — comes back
 * with no request at all, which is the whole point of moving this off the
 * server: the page shell is static and this is the only thing that can wait.
 */
const cache = new Map<string, { at: number; data: Promise<SectionData> }>();
const TTL_MS = 60_000;

/** Synchronously resolved cache entries only — used to skip the skeleton. */
const settled = new Map<string, SectionData>();

/** One URL per category, with no sub in it — that is the point. */
export function sectionUrl(cat: string) {
  return `/api/section/${encodeURIComponent(cat)}`;
}

export function loadSection(cat: string): Promise<SectionData> {
  const key = sectionUrl(cat);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const data = resolve(cat, key);
  cache.set(key, { at: Date.now(), data });
  data.catch(() => { if (cache.get(key)?.data === data) cache.delete(key); });
  data.then((d) => settled.set(key, d)).catch(() => {});
  return data;
}

/**
 * Stored copy first, and no request at all when it is still current.
 *
 * The stamp is one small answer for the whole app, so asking it and finding it
 * unchanged settles every section this browser holds at once. Only when it has
 * moved — at most every fifteen minutes, usually less — does a section cost
 * anything, and then only the one being looked at.
 */
async function resolve(cat: string, key: string): Promise<SectionData> {
  const [stamp, stored] = await Promise.all([
    sessionStamp(),
    readEntry<SectionData>(key),
  ]);
  const held = stored?.data;
  if (held && stamp && stored.stamp === stamp) return held;

  // When we hold a copy, ask only for what has changed since the newest thing
  // in it. A cycle usually moves a handful of stories, not forty-eight.
  const since = held?.stories.length
    ? Math.max(...held.stories.map((s) => s.last_seen))
    : 0;
  const res = await fetch(since ? `${key}?since=${since}` : key);
  if (!res.ok) {
    // A section we hold is a better answer than an error, even a stale one.
    if (held) return held;
    throw new Error(String(res.status));
  }

  const fresh = await res.json() as SectionData;
  const merged = since ? await merge(held!, fresh) : fresh;
  writeEntry(key, merged.stamp, merged);
  return merged;
}

/**
 * The delta's ordered ids, filled from whatever body we can find for each —
 * the changed ones the server just sent, then the ones already here. An id in
 * neither was evicted from storage, and only those are asked for.
 */
async function merge(held: SectionData, delta: SectionData): Promise<SectionData> {
  const bodies = new Map<string, SectionStory>();
  for (const s of held.stories) bodies.set(s.id, s);
  for (const s of delta.stories) bodies.set(s.id, s);

  const gaps = delta.ids.filter((id) => !bodies.has(id));
  if (gaps.length) {
    try {
      const res = await fetch(`/api/stories?ids=${gaps.map(encodeURIComponent).join(',')}`);
      if (res.ok) {
        const { stories } = await res.json() as { stories: SectionStory[] };
        // Backfilled rows carry no sub verdicts — that endpoint does not know
        // which section asked. The strip still counts them; only the sub filter
        // cannot place them, which is the right way round for a rare gap.
        for (const s of stories) bodies.set(s.id, { ...s, subs: s.subs ?? [] });
      }
    } catch { /* an id with no body is simply dropped below */ }
  }

  return {
    ...delta,
    stories: delta.ids.map((id) => bodies.get(id)).filter((s): s is SectionStory => !!s),
  };
}

/**
 * Empty the map outright. Saving preferences re-ranks four of the fourteen
 * sections, and the entries here were filled before the save; a TTL would let
 * the old order stand for up to a minute after the reader watched it change.
 */
export function clearSections() { cache.clear(); }

/** Warm without rendering — the strip calls this on hover and on touch-down. */
export function warmSection(cat: string) {
  void loadSection(cat).catch(() => {});
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
  const shown = active ? data.stories.filter((s) => s.subs.includes(active)) : data.stories;

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
  const key = sectionUrl(cat);
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at >= TTL_MS) { settled.delete(key); return null; }
  hit.data.then((d) => settled.set(key, d)).catch(() => {});
  return settled.get(key) ?? null;
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
