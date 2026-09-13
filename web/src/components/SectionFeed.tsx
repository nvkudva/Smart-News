import { Fragment } from 'react';
import { useLoaderData, useSearch } from '@tanstack/react-router';
import { sectionFrom, type World } from '../lib/world';
import { StoryCard, variantFor } from './StoryCard';
import { SubcategoryStrip } from './SubcategoryStrip';

export function SectionFeed({ cat, name }: { cat: string; name: string }) {
  // strict:false because this renders under several routes; each one declares
  // ?sub= in its own validateSearch.
  const sub = (useSearch({ strict: false }) as { sub?: string }).sub ?? null;
  // strict:false again because both feed routes load the same world, so either
  // match answers with it. This component used to fetch it a second time and
  // hold its own loading and error states beside the route's; the loader has
  // awaited it before this renders, which is why there is nothing to wait for
  // and nothing to fail here. A pane the pager builds for a neighbouring
  // category is another read of the same object, not another request.
  const world = useLoaderData({ strict: false }) as World;
  const data = sectionFrom(world, cat);

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
            // Recency is a divider rather than a pill: every pill in the strip
            // above narrows the set, and a sort sitting among them would be the
            // one control in the row that does something else.
            const stale = Date.now() - 24 * 3_600_000;
            const firstOld = shown.findIndex((s) => s.last_seen < stale);
            return shown.map((s, i) => (
              <Fragment key={s.id}>
                {i === firstOld && <p className="feed__divider">Stories older than 24 hours</p>}
                <StoryCard story={s} variant={variantFor(s, i)} priority={s.id === lcp} />
              </Fragment>
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
