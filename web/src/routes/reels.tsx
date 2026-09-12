import { Link, createFileRoute } from '@tanstack/react-router'
import type { ReelsPayload } from '../../shared/types'
import { ReelKeys } from '../components/ReelKeys'
import { SaveButton } from '../components/SaveButton'
import { storyWhen } from '../components/StoryCard'
import { TabBar } from '../components/TabBar'
import { Back, Photo } from '../components/icons'
import { fetchJson } from '../lib/api'

/** Full-screen vertical stack. Scroll-snap pages it for a thumb; ReelKeys does
 *  the same for a keyboard, which snap alone leaves with nothing but Tab. */
export const Route = createFileRoute('/reels')({
  loader: ({ abortController }) =>
    fetchJson<ReelsPayload>('/api/reels', abortController.signal),
  pendingComponent: LoadingReels,
  component: Reels,
})

function Reels() {
  const { stories, saved: savedIds } = Route.useLoaderData()
  // A Set does not survive JSON, so the payload carries an array and the
  // lookup below is rebuilt here.
  const saved = new Set(savedIds)

  return (
    <>
    <div className="reels">
      <ReelKeys />
      <Link to="/" className="reels__close" aria-label="Back to feed"><Back /></Link>

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
          <Link to="/story/$id" params={{ id: s.id }} className="reel__open"
                aria-label={`Read: ${s.headline}`} />

          <div className="reel__body">
            <div className="reel__count" aria-hidden><b>{i + 1}</b> / {stories.length}</div>
            <div className="reel__head">
              <h2>{s.headline}</h2>
            </div>
            <p>{s.crux}</p>
            {/* Under the summary, not over the headline: it is what the story
                turned out to be filed as, which is only worth knowing once you
                have read what the story is. */}
            {/* One line, not two: category, place, age and source count are all
                the same kind of fact about the story, and stacking the count on
                its own right-aligned row read as a separate control. */}
            <div className="reel__foot">
              <div className="kicker kicker--reel">
                <span>{s.category}</span>
                {s.place && <><span className="sep">·</span><span className="kicker__place">{s.place}</span></>}
                <span className="sep">·</span>
                <span>{storyWhen(s)}</span>
                <span className="sep">·</span>
                <Link to="/story/$id" params={{ id: s.id }} className="reel__sources">
                  {s.source_count} sources
                </Link>
              </div>
              <SaveButton clusterId={s.id} initial={saved.has(s.id)} iconOnly />
            </div>
          </div>
        </section>
      ))}
    </div>
    <TabBar active="reels" />
    </>
  )
}

/** reels/page.tsx had no loading.tsx - it was force-dynamic with nothing above
 *  the fold to show - so this is the reels surface with nothing in it yet. */
function LoadingReels() {
  return (
    <>
      <div className="reels" aria-busy="true" aria-label="Loading">
        <Link to="/" className="reels__close" aria-label="Back to feed"><Back /></Link>
      </div>
      <TabBar active="reels" />
    </>
  )
}
