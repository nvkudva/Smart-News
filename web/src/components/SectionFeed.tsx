import { Fragment } from 'react';
import { useLoaderData, useSearch } from '@tanstack/react-router';
import { SCOPE_SUBS } from '../../shared/taxonomy';
import { label } from '../../shared/categories';
import { sectionFrom, type World } from '../lib/world';
import { StoryCard, variantFor } from './StoryCard';
import { SubcategoryStrip } from './SubcategoryStrip';
import { useTheme } from './Theme';

const SCOPE_SLUGS = new Set(SCOPE_SUBS.map((s) => s.slug));

type Band<T> = { name: string; id: string; stories: T[] };

/**
 * A paper groups its inside pages by section. Sections take their place in the
 * order of their best story, and keep rank order within. A section with one
 * story would be a heading over a single brief, so those share a closing band.
 */
function bandsOf<T extends { category: string }>(stories: T[]): Band<T>[] {
  const by = new Map<string, T[]>();
  for (const s of stories) by.set(s.category, [...(by.get(s.category) ?? []), s]);
  const bands: Band<T>[] = [];
  const loose: T[] = [];
  for (const [category, list] of by) {
    const name = label(category);
    if (list.length < 2) loose.push(...list);
    else bands.push({ name, id: `band-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, stories: list });
  }
  if (loose.length) bands.push({ name: 'Also today', id: 'band-also-today', stories: loose });
  return bands;
}

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
  // A scope section's subject pills filter on the story's own section; its
  // place pills (Trending only), like a topic's keyword pills, on the verdicts
  // each row carries.
  const shown = !active ? data.stories
    : data.kind === 'scope' && !SCOPE_SLUGS.has(active) ? data.stories.filter((s) => s.cslug === active)
    : data.stories.filter((s) => s.subs.includes(active));

  // Only Newspaper sets the mixed feed as sections; every other theme, and any
  // single section's own page, keeps the plain rank order.
  const theme = useTheme();
  const bands = theme === 'newspaper' && cat === 'top' && !active ? bandsOf(shown.slice(3)) : null;

  return (
    <>
      {/* Top lives at /, the way CategoryStrip has always sent it. Building
          the base from the slug alone gave the section a second URL at
          /c/top — a real prerendered page showing the same rows, so shared
          links disagreed and both payloads were fetched and held apart. */}
      <SubcategoryStrip cat={cat} label={name} base={cat === 'top' ? '/' : `/c/${cat}`}
                        subs={data.subs} active={active} />
      {shown.length === 0 ? (
        <div className="panel panel--quiet">
          <div className="label">Quiet so far</div>
          <p>
            Nothing has been filed under {data.subs.find((s) => s.slug === active)?.name ?? name}
            {' '}in the last two days. The main feed still carries these stories when they turn up.
          </p>
        </div>
      ) : (
        <>
        {bands && bands.length > 1 && (
          <nav className="paperindex" aria-label="Inside today">
            <span className="paperindex__label">Inside</span>
            {bands.map((b) => (
              <a key={b.id} href={`#${b.id}`} className="paperindex__item">
                <b>{b.name}</b><span>{b.stories[0].headline}</span>
              </a>
            ))}
          </nav>
        )}
        <div className="feed">
          {/* The first story carrying an image, which is the one that becomes
              LCP - not simply the first story, which may have none. */}
          {(() => {
            const lcp = shown.find((s) => s.image_url)?.id;
            const rank = new Map(shown.map((s, i) => [s.id, i]));
            const card = (s: (typeof shown)[number], i = rank.get(s.id) ?? 0) => (
              <StoryCard key={s.id} story={s} variant={variantFor(s, i)}
                         priority={s.id === lcp} />
            );
            // The first three are the front page proper. The wrapper is
            // display:contents everywhere but Newspaper, so the grid sees the
            // same cards in the same order it always did.
            return (
              <>
                <div className="feed__front">{shown.slice(0, 3).map((s, i) => card(s, i))}</div>
                {bands ? bands.map((b) => (
                  <Fragment key={b.id}>
                    <h3 className="feed__band" id={b.id}>{b.name}</h3>
                    {b.stories.map((s) => card(s))}
                  </Fragment>
                )) : shown.slice(3).map((s, i) => card(s, i + 3))}
              </>
            );
          })()}
        </div>
        </>
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
