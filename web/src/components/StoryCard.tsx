import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Story } from '../../shared/types';
import { Photo } from './icons';
import { storyWhen } from '../lib/format';
import { ExplorationDot } from './ExplorationDot';

export type Variant = 'lead' | 'stack' | 'compact';

/**
 * Rank decides how much room a story gets. Only the first card ever spans two
 * columns: with every other card one track wide, the grid can never strand a
 * gap, which is what `grid-auto-flow: dense` would otherwise be needed to fix —
 * and dense reorders the feed, destroying the ranking and the exploration slot.
 */
export function variantFor(story: Story, index: number): Variant {
  if (index === 0) return 'lead';
  // Two ways in, because the two signals fail in opposite directions. The model
  // rates almost everything 4-5, so importance alone makes every card full size
  // — hence the corroboration floor beside it. But importance is also one guess
  // from a dozen article bodies, and it reads a scheduled product launch as
  // routine: the last clause is the crowd overruling it, because a story many
  // outlets independently run is the stronger claim that it matters.
  //
  // The floor used to sit at three sources, and measured against a live window
  // that left 78% of the feed compact — 57% of clusters carry exactly two
  // sources, so the commonest story in the store could never be full size. At
  // two it is 30%, and what stays compact is what the floor was always meant to
  // catch: routine news one or two outlets bothered with.
  if (story.importance >= 4 && story.source_count >= 2) return 'stack';
  if (story.importance >= 3 && story.source_count >= 3) return 'stack';
  if (story.source_count >= 8) return 'stack';
  return 'compact';
}

/**
 * `priority` is the one image worth fetching before layout says to.
 *
 * Lazy-loading the largest image above the fold defers its fetch until layout
 * has run, which Lighthouse measured as 1.7-2.1s of Load Delay inside a 2.8-3.8s
 * LCP - the wait was most of the number and was self-inflicted. Everything
 * below it stays lazy, which is what lazy is for.
 *
 * Chosen by the caller, not by the variant. Tying it to 'lead' looked
 * equivalent and was not: a lead story with no image renders no hero at all,
 * and then the largest image on the page is some later card that is still
 * lazy - which is exactly what Lighthouse kept pointing at.
 */
function Plate({ kind, src, credit, priority = false }: {
  kind: 'hero' | 'thumb'; src: string | null; credit?: string | null; priority?: boolean;
}) {
  // A source that refuses the hotlink or has moved leaves the browser's broken
  // image icon; a calm gradient reads as a design choice instead.
  const [failed, setFailed] = useState(false);
  if (src && failed) return <div className={`plate plate--${kind} plate--failed`} />;
  return (
    <div className={`plate plate--${kind}`}>
      {src
        ? <img src={src} alt=""
               loading={priority ? 'eager' : 'lazy'}
               fetchPriority={priority ? 'high' : undefined}
               onError={() => setFailed(true)} />
        : <Photo size={kind === 'hero' ? 26 : 19} />}
      {src && credit && <span className="credit">Source : {credit}</span>}
    </div>
  );
}

function Kicker({ story }: { story: Story }) {
  // The canonical label says which Delhi and which Hyderabad; the raw string is
  // all an unresolved cluster has, and it still reads exactly as it did before.
  // Cards show the city alone: "Hyderabad, Telangana, India" wrapped the footer
  // to two lines and cost the summary its last line.
  const place = (story.place_id ? (story.place_label ?? story.place) : story.place)?.split(',')[0].trim();
  // No category: on a section page it repeats the title overhead, and on Top it
  // was the half of the line that got ellipsed to a single letter.
  return <div className="kicker">{place && <span className="kicker__place">{place}</span>}</div>;
}

export function StoryCard({ story, variant = 'compact', priority = false }: {
  story: Story; variant?: Variant; priority?: boolean;
}) {
  const meta = `${story.source_count} source${story.source_count === 1 ? '' : 's'} · ${storyWhen(story)}`;
  // A grey placeholder is fine at 76px and dreadful at 350px, so wide cards
  // without a photo drop the plate and take the room back as text.
  const textOnly = !story.image_url && variant !== 'compact';

  const head = <h2>{story.headline}</h2>;
  const crux = <p>{story.crux}</p>;
  const foot = <div className="foot"><Kicker story={story} /><div className="meta">{meta}</div></div>;

  const className = [
    'card',
    `card--${variant}`,

    textOnly ? 'card--text' : '',
    story.exploration ? 'card--explore' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="cardwrap">
      {/* Prefetching is StoryWarm's job, not this link's. Link's own hover
          prefetch has no dwell and no ceiling, so a pointer crossing a grid
          fetched every card it grazed — and on a hover that was meant, the two
          of them asked for the same page twice. */}
      <Link to="/story/$id" params={{ id: story.id }} className={className}
            preload={false} data-cat={story.category.toLowerCase()}>
        {variant === 'compact' ? (
          /* Headline runs the full width; the thumbnail sits beside the summary,
             which is the only block that can afford to be narrower. */
          <>
            {head}
            <div className="card__mid">
              {crux}
              {story.image_url && <Plate kind="thumb" src={story.image_url} />}
            </div>
            {foot}
          </>
        ) : (
          <>
            {!textOnly && <Plate kind="hero" src={story.image_url} credit={story.image_source}
                                  priority={priority} />}
            {head}{crux}{foot}
          </>
        )}
      </Link>
      {/* Outside the Link on purpose: a button nested in an anchor is invalid,
          and tapping the marker must explain rather than navigate. */}
      {story.exploration === 1 && <ExplorationDot kind={story.exploration_kind ?? 'category'} />}
    </div>
  );
}
