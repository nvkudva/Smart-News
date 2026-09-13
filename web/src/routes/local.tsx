import { Link, createFileRoute } from '@tanstack/react-router'
import type { LocalPayload } from '../../shared/types'
import { StoryCard, variantFor } from '../components/StoryCard'
import { TabBar } from '../components/TabBar'
import { Pin } from '../components/icons'
import { load } from '../lib/load'

export const Route = createFileRoute('/local')({
  loader: ({ abortController }) =>
    load<LocalPayload>('/api/local', { persist: true, signal: abortController.signal }),
  pendingComponent: LoadingLocal,
  component: Local,
})

const linkStyle = {
  alignSelf: 'flex-start', display: 'inline-flex',
  alignItems: 'center', textDecoration: 'none',
} as const

function Local() {
  const { stories, places, typed, geoPlaceId } = Route.useLoaderData()

  // getLocalFeed only falls back to the free-text place match when nothing
  // canonical resolved, so the typed names are named in the header exactly when
  // they are the thing selecting the stories below - a reader whose places never
  // resolved sees a populated page with its sources credited, not 'no places'.
  const nothingNamed = places.length === 0 && typed.length === 0

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <Link to="/" className="kicker" style={{ textDecoration: 'none' }}>← Today</Link>
          <h1 style={{ marginTop: 8 }}>Local</h1>
          <p>
            {nothingNamed
              ? 'Follow a place and its news collects here.'
              : stories.length === 0
                ? 'Nothing filed here in the last two days.'
                : `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} from your places, and from anywhere inside them.`}
          </p>
          {!nothingNamed && (
            <div className="chips localhead">
              {/* The place GPS resolved is filled in rather than outlined: the
                  reader did not type it, so it has to be obvious which one the
                  device is responsible for. */}
              {places.map((p) => (
                <span key={p.id} className="chip" data-on={p.id === geoPlaceId || undefined}
                      title={p.id === geoPlaceId ? 'From your device location' : p.label}>
                  <span className="localhead__pin"><Pin size={11} /></span>
                  {p.label}
                </span>
              ))}
              {typed.map((t) => (
                <span key={`t:${t}`} className="chip" data-unmatched title={`${t} — matched by name only`}>
                  {t}<span className="chip__note">text</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {stories.length === 0 ? (
          <div className="panel">
            <div className="label">{nothingNamed ? 'No places yet' : 'Quiet so far'}</div>
            <p>
              {!nothingNamed
                ? 'Nothing has been filed from your places in the last two days. The main feed still carries them when they turn up.'
                : 'Add the cities, states or countries you care about and this becomes their front page.'}
            </p>
            <Link to="/profile" className="btn" style={linkStyle}>
              {nothingNamed ? 'Choose your places' : 'Edit your places'}
            </Link>
          </div>
        ) : (
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        )}
      </main>
      <TabBar active="local" />
    </>
  )
}

/** What local/loading.tsx was. */
function LoadingLocal() {
  return (
    <>
      <main className="shell">
        <div className="pagehead"><h1>Local</h1></div>
        <div className="feed" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skel skel--compact" />)}
        </div>
      </main>
      <TabBar active="home" />
    </>
  )
}
