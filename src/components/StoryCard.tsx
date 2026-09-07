import Link from 'next/link';
import type { Story } from '@/lib/feed';
import { Photo, Pin, Spark } from './icons';

export function ago(ts: number): string {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
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

export function StoryCard({ story, lead = false }: { story: Story; lead?: boolean }) {
  const meta = `${story.source_count} source${story.source_count === 1 ? '' : 's'} · ${ago(story.last_seen)}`;
  const cls = `card ${story.exploration ? 'card--explore' : ''} ${lead ? '' : 'card--row'}`;

  const body = (
    <>
      <h2>{story.headline}</h2>
      <p>{story.crux}</p>
      <div className="foot"><Kicker story={story} /><div className="meta">{meta}</div></div>
    </>
  );

  return (
    <Link href={`/story/${encodeURIComponent(story.id)}`} className={cls}>
      {lead ? (
        <>
          <Plate kind="hero" src={story.image_url} />
          {body}
        </>
      ) : (
        <>
          <div className="card__body">{body}</div>
          <Plate kind="thumb" src={story.image_url} />
        </>
      )}
    </Link>
  );
}
