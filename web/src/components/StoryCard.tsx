import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Story } from '../../shared/types';
import { Photo } from './icons';
import { storyWhen } from '../lib/format';

export type Variant = 'lead' | 'stack' | 'compact';

/**
 * Rank decides how much room a story gets. Only the first card ever spans two
 * columns: with every other card one track wide, the grid can never strand a
 * gap, which is what `grid-auto-flow: dense` would otherwise be needed to fix —
 * and dense reorders the feed, destroying the ranking and the exploration slot.
 */
export function variantFor(story: Story, index: number): Variant {
  if (index === 0) return 'lead';
  // Importance alone decides. How many outlets ran a story no longer makes it
  // a half card: a single-source scoop is often the story worth reading. A 3
  // or above is full size; a half card is only what the model rated 1 or 2,
  // the routine items it was least sure were news.
  if (story.importance >= 3) return 'stack';
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
function Plate({ src, credit, priority = false }: {
  src: string | null; credit?: string | null; priority?: boolean;
}) {
  // A source that refuses the hotlink or has moved leaves the browser's broken
  // image icon; a calm gradient reads as a design choice instead.
  const [failed, setFailed] = useState(false);
  if (src && failed) return <div className="plate plate--hero plate--failed" />;
  return (
    <div className="plate plate--hero">
      {src
        ? <img src={src} alt=""
               loading={priority ? 'eager' : 'lazy'}
               fetchPriority={priority ? 'high' : undefined}
               onError={() => setFailed(true)} />
        : <Photo size={26} />}
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

/**
 * A finer grade than the variant, for themes that set stories by weight rather
 * than by size alone (Newspaper). The others ignore it. Read from the same
 * signals as variantFor, so a story's treatment follows what it is, not where
 * it happens to land in the feed.
 */
function tierFor(story: Story, variant: Variant) {
  if (variant === 'lead') return 'lead';
  // Both, not either: the model rates half the window 5, so importance alone
  // made every other story major. With the crowd beside it, about one in six.
  if (variant === 'stack') return story.importance >= 5 && story.source_count >= 8 ? 'major' : 'feature';
  if (story.importance <= 2) return 'item';
  return 'brief';
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
    <div className="cardwrap" data-tier={tierFor(story, variant)}>
      {/* Prefetching is StoryWarm's job, not this link's. Link's own hover
          prefetch has no dwell and no ceiling, so a pointer crossing a grid
          fetched every card it grazed — and on a hover that was meant, the two
          of them asked for the same page twice. */}
      <Link to="/story/$id" params={{ id: story.id }} className={className}
            preload={false} data-cat={story.category.toLowerCase()}>
        {variant === 'compact' ? (
          /* Text only: a half card is headline, summary and credit. The
             photographs are kept for the cards wide enough to show one. */
          <>
            {head}
            <div className="card__mid">{crux}</div>
            {foot}
          </>
        ) : (
          <>
            {!textOnly && <Plate src={story.image_url} credit={story.image_source}
                                  priority={priority} />}
            {head}{crux}{foot}
          </>
        )}
      </Link>
    </div>
  );
}
