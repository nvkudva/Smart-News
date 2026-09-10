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

/** A cluster gathering coverage six hours after it broke is still running. */
const running = (s: { first_seen: number; last_seen: number }) =>
  s.last_seen - s.first_seen > 6 * 3_600_000;

/**
 * The full account, for the one page with room for it. first_seen is when the
 * story broke; last_seen moves every time another article joins the cluster, so
 * on its own it dates a three-day-old running story as breaking.
 */
export function storyAge(s: { first_seen: number; last_seen: number }): string {
  return running(s) ? `${ago(s.first_seen)} · updated ${ago(s.last_seen)}` : ago(s.first_seen);
}

/**
 * One time value, for a card foot that has to survive on a single line beside
 * a place name. A running story reports its latest movement and says so — the
 * word is what stops `3h ago` on a three-day-old story reading as breaking —
 * and everything else reports when it broke. The detail page carries both.
 */
export function storyWhen(s: { first_seen: number; last_seen: number }): string {
  return running(s) ? `updated ${ago(s.last_seen)}` : ago(s.first_seen);
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
  // Two ways in, because the two signals fail in opposite directions. The model
  // rates almost everything 4-5, so importance alone makes every card full size
  // — hence the corroboration floor beside it. But importance is also one guess
  // from a dozen article bodies, and it reads a scheduled product launch as
  // routine: the second clause is the crowd overruling it, because sixty
  // outlets independently running a story is the stronger claim that it matters.
  if (story.importance >= 4 && story.source_count >= 3) return 'stack';
  if (story.source_count >= 12) return 'stack';
  return 'compact';
}

function Plate({ kind, src, credit }: { kind: 'hero' | 'thumb'; src: string | null; credit?: string | null }) {
  return (
    <div className={`plate plate--${kind}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Photo size={kind === 'hero' ? 26 : 19} />}
      {src && credit && <span className="credit">Source : {credit}</span>}
    </div>
  );
}

function Kicker({ story }: { story: Story }) {
  // The canonical label says which Delhi and which Hyderabad; the raw string is
  // all an unresolved cluster has, and it still reads exactly as it did before.
  const place = story.place_id ? (story.place_label ?? story.place) : story.place;
  // No category: on a section page it repeats the title overhead, and on Top it
  // was the half of the line that got ellipsed to a single letter.
  return <div className="kicker">{place && <span className="kicker__place">{place}</span>}</div>;
}

export function StoryCard({ story, variant = 'compact' }: { story: Story; variant?: Variant }) {
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
      <Link href={`/story/${encodeURIComponent(story.id)}`} className={className}
            data-cat={story.category.toLowerCase()}>
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
            {!textOnly && <Plate kind="hero" src={story.image_url} credit={story.image_source} />}
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
