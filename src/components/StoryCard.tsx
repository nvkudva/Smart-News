import Link from 'next/link';
import type { Story } from '@/lib/feed';
import { Photo } from './icons';
import { ExplorationDot } from './ExplorationDot';

export function ago(ts: number): string {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export type Variant = 'lead' | 'stack' | 'compact';

/**
 * Rank decides how much room a story gets. Only the first card ever spans two
 * columns: with every other card one track wide, the grid can never strand a
 * gap, which is what `grid-auto-flow: dense` would otherwise be needed to fix —
 * and dense reorders the feed, destroying the ranking and the exploration slot.
 */
export function variantFor(story: Story, index: number): Variant {
  if (index === 0) return 'lead';
  // Both signals, not either: the model rates almost everything 4-5, so
  // importance alone makes every card full size. Corroboration is what
  // actually separates a big story from a routine one.
  if (story.importance >= 4 && story.source_count >= 3) return 'stack';
  return 'compact';
}

function Plate({ kind, src }: { kind: 'hero' | 'thumb'; src: string | null }) {
  return (
    <div className={`plate plate--${kind}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Photo size={kind === 'hero' ? 26 : 19} />}
    </div>
  );
}

function Kicker({ story }: { story: Story }) {
  return (
    <div className="kicker">
      <span>{story.category}</span>
      {story.place && <><span className="sep">·</span><span className="kicker__place">{story.place}</span></>}
    </div>
  );
}

export function StoryCard({ story, variant = 'compact' }: { story: Story; variant?: Variant }) {
  const meta = `${story.source_count} source${story.source_count === 1 ? '' : 's'} · ${ago(story.last_seen)}`;
  // A grey placeholder is fine at 76px and dreadful at 350px, so wide cards
  // without a photo drop the plate and take the room back as text.
  const textOnly = !story.image_url && variant !== 'compact';

  const body = (
    <>
      <h2>{story.headline}</h2>
      <p>{story.crux}</p>
      <div className="foot"><Kicker story={story} /><div className="meta">{meta}</div></div>
    </>
  );

  const className = [
    'card',
    `card--${variant}`,

    textOnly ? 'card--text' : '',
    story.exploration ? 'card--explore' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="cardwrap">
      <Link href={`/story/${encodeURIComponent(story.id)}`} className={className}>
        {variant === 'compact' ? (
          <>
            <div className="card__body">{body}</div>
            {story.image_url && <Plate kind="thumb" src={story.image_url} />}
          </>
        ) : (
          <>
            {!textOnly && <Plate kind="hero" src={story.image_url} />}
            {body}
          </>
        )}
      </Link>
      {/* Outside the Link on purpose: a button nested in an anchor is invalid,
          and tapping the marker must explain rather than navigate. */}
      {story.exploration === 1 && <ExplorationDot />}
    </div>
  );
}
