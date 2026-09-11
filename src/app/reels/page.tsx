import Link from 'next/link';
import { Back, Photo } from '@/components/icons';
import { SaveButton } from '@/components/SaveButton';
import { storyWhen } from '@/components/StoryCard';
import { getReels, savedAmong } from '@/lib/library';
import { TabBar } from '@/components/TabBar';
import { ReelKeys } from '@/components/ReelKeys';
import { currentUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Full-screen vertical stack. Scroll-snap pages it for a thumb; ReelKeys does
 *  the same for a keyboard, which snap alone leaves with nothing but Tab. */
export default async function Reels() {
  const stories = await getReels(20);
  const saved = await savedAmong(stories.map((s) => s.id), await currentUserId());

  return (
    <>
    <div className="reels">
      <ReelKeys />
      <Link href="/" className="reels__close" aria-label="Back to feed"><Back /></Link>

      {stories.map((s, i) => (
        <section key={s.id} className="reel">
          <div className="reel__photo">
            {s.image_url ? <img src={s.image_url} alt="" loading={i < 2 ? 'eager' : 'lazy'} /> : <Photo size={34} />}
            {s.image_url && s.image_source && <span className="credit">Source : {s.image_source}</span>}
          </div>
          <div className="reel__scrim" />

          {/* The whole reel opens the story. It is a full screen given over to
              one thing, so anything short of the whole surface being the target
              is a smaller target than the reader expects; the two controls sit
              above it and keep their own jobs. */}
          <Link href={`/story/${encodeURIComponent(s.id)}`} className="reel__open"
                aria-label={`Read: ${s.headline}`} />

          <div className="reel__body">
            <div className="reel__count" aria-hidden><b>{i + 1}</b> / {stories.length}</div>
            <div className="reel__head">
              <h2>{s.headline}</h2>
              <SaveButton clusterId={s.id} initial={saved.has(s.id)} iconOnly />
            </div>
            <p>{s.crux}</p>
            {/* Under the summary, not over the headline: it is what the story
                turned out to be filed as, which is only worth knowing once you
                have read what the story is. */}
            <div className="kicker">
              <span>{s.category}</span>
              {s.place && <><span className="sep">·</span><span>{s.place}</span></>}
              <span className="sep">·</span>
              <span>{storyWhen(s)}</span>
            </div>
            <div className="reel__actions">
              <Link href={`/story/${encodeURIComponent(s.id)}`} className="reel__sources">
                {s.source_count} sources
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
