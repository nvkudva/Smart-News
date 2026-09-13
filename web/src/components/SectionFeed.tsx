import { useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { loadSection, peekSection, type SectionData } from '../lib/world';
import { StoryCard, variantFor } from './StoryCard';
import { SubcategoryStrip } from './SubcategoryStrip';

export function SectionFeed({ cat, name }: { cat: string; name: string }) {
  // strict:false because this renders under several routes; each one declares
  // ?sub= in its own validateSearch.
  const sub = (useSearch({ strict: false }) as { sub?: string }).sub ?? null;
  // A cached section renders in the first commit, with no loading state at all.
  const [data, setData] = useState<SectionData | null>(() => peekSection(cat));
  const [failed, setFailed] = useState(false);

  // Only `cat`. Changing the sub used to re-run this and fetch the same rows
  // back under a different query string; it is now a filter over what is
  // already here, so the strip responds with no request at all.
  useEffect(() => {
    let live = true;
    const cached = peekSection(cat);
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
      {/* Top lives at /, the way CategoryStrip has always sent it. Building
          the base from the slug alone gave the section a second URL at
          /c/top — a real prerendered page showing the same rows, so shared
          links disagreed and both payloads were fetched and held apart. */}
      <SubcategoryStrip cat={cat} label={name} base={cat === 'top' ? '/' : `/c/${cat}`}
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
          {/* The first story carrying an image, which is the one that becomes
              LCP - not simply the first story, which may have none. */}
          {(() => {
            const lcp = shown.find((s) => s.image_url)?.id;
            return shown.map((s, i) => (
              <StoryCard key={s.id} story={s} variant={variantFor(s, i)}
                         priority={s.id === lcp} />
            ));
          })()}
        </div>
      )}
    </>
  );
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
