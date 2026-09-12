import { createFileRoute } from '@tanstack/react-router'
import type { SavedPayload } from '../../shared/types'
import { StoryCard, variantFor } from '../components/StoryCard'
import { TabBar } from '../components/TabBar'
import { fetchJson } from '../lib/api'

export const Route = createFileRoute('/saved')({
  loader: ({ abortController }) =>
    fetchJson<SavedPayload>('/api/saved', abortController.signal),
  pendingComponent: LoadingSaved,
  component: Saved,
})

function Saved() {
  const { stories } = Route.useLoaderData()

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Saved</h1>
          <p>{stories.length ? `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} kept for later.`
                             : 'Nothing saved yet.'}</p>
        </div>

        {stories.length === 0 ? (
          <div className="panel">
            <div className="label">How this fills up</div>
            <p>Open any story and press Save. Saved stories stay here even after
               they drop out of the 48-hour feed window.</p>
          </div>
        ) : (
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        )}
      </main>
      <TabBar active="saved" />
    </>
  )
}

/** What saved/loading.tsx was. */
function LoadingSaved() {
  return (
    <>
      <main className="shell">
        <div className="pagehead"><h1>Saved</h1></div>
        <div className="feed" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skel skel--compact" />)}
        </div>
      </main>
      <TabBar active="saved" />
    </>
  )
}
