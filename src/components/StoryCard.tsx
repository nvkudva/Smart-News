import Link from 'next/link';
import type { Story } from '@/lib/feed';
import { Photo, Pin, Spark } from './icons';

export function ago(ts: number): string {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export type Variant = 'lead' | 'stack' | 'row';

/**
 * Rank decides how much room a story gets. Only the first card ever spans two
 * columns: with every other card one track wide, the grid can never strand a
 * gap, which is what `grid-auto-flow: dense` would otherwise be needed to fix —
 * and dense reorders the feed, destroying the ranking and the exploration slot.
 */
export function variantFor(story: Story, index: number): Variant {
  if (index === 0) return 'lead';
  if (story.importance >= 4 || story.source_count >= 6) return 'stack';
  return 'row';
}

function Plate({ kind, src }: { kind: 'hero' | 'thumb'; src: string | null }) {
  return (
    <div className={`plate plate--${kind}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Photo size={kind === 'hero' ? 26 : 19} />}
    </div>
  );
}

function Kicker({ story }: { story: Story }) {
  const explore = story.exploration === 1;
  return (
    <div className={`kicker ${explore ? 'kicker--new' : ''}`}>
      {explore && <Spark />}
      <span>{explore ? 'New to you' : story.category}</span>
      {story.place && <><span className="sep">·</span><span>{story.place}</span></>}
    </div>
  );
}

export function StoryCard({ story, variant = 'row' }: { story: Story; variant?: Variant }) {
  const meta = `${story.source_count} source${story.source_count === 1 ? '' : 's'} · ${ago(story.last_seen)}`;
  // A grey placeholder is fine at 76px and dreadful at 350px, so wide cards
  // without a photo drop the plate and take the room back as text.
  const textOnly = !story.image_url && variant !== 'row';

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
    variant === 'row' ? 'card--row' : '',
    textOnly ? 'card--text' : '',
    story.exploration ? 'card--explore' : '',
  ].filter(Boolean).join(' ');

  return (
    <Link href={`/story/${encodeURIComponent(story.id)}`} className={className}>
      {variant === 'row' ? (
        <>
          <div className="card__body">{body}</div>
          <Plate kind="thumb" src={story.image_url} />
        </>
      ) : (
        <>
          {!textOnly && <Plate kind="hero" src={story.image_url} />}
          {body}
        </>
      )}
    </Link>
  );
}
