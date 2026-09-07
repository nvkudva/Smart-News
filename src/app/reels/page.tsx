import Link from 'next/link';
import { Back, Photo } from '@/components/icons';
import { SaveButton } from '@/components/SaveButton';
import { ago } from '@/components/StoryCard';
import { getReels, isSaved } from '@/lib/library';
import { TabBar } from '@/components/TabBar';

export const dynamic = 'force-dynamic';

/** Full-screen vertical stack. CSS scroll-snap does the paging — no JS needed. */
export default function Reels() {
  const stories = getReels(20);

  return (
    <>
    <div className="reels">
      <Link href="/" className="reels__close" aria-label="Back to feed"><Back /></Link>

      {stories.map((s, i) => (
        <section key={s.id} className="reel">
          <div className="reel__photo">
            {s.image_url ? <img src={s.image_url} alt="" loading={i < 2 ? 'eager' : 'lazy'} /> : <Photo size={34} />}
          </div>
          <div className="reel__scrim" />

          <div className="reel__body">
            <div className="kicker" style={{ color: 'rgba(255,255,255,0.82)' }}>
              <span>{s.category}</span>
              {s.place && <><span className="sep">·</span><span>{s.place}</span></>}
              <span className="sep">·</span><span>{ago(s.last_seen)}</span>
            </div>
            <h2>{s.headline}</h2>
            <p>{s.crux}</p>
            <div className="reel__actions">
              <SaveButton clusterId={s.id} initial={isSaved(s.id)} />
              <Link href={`/story/${encodeURIComponent(s.id)}`} className="savebtn">
                {s.source_count} sources · Read
              </Link>
            </div>
          </div>
        </section>
      ))}
    </div>
    <TabBar active="reels" />
    </>
  );
}
