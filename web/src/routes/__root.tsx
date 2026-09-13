import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppHeader } from '../components/AppHeader'
import { ServiceWorker } from '../components/ServiceWorker'
import { StoryWarm } from '../components/StoryWarm'
import { UpdateBanner } from '../components/UpdateBanner'
import { startWorldRefresh } from '../lib/world'
import { TabBar } from '../components/TabBar'

/**
 * What layout.tsx held, minus the parts that were Next's.
 *
 * The metadata, viewport and the BOOT script move to index.html: they belong
 * to the document, and in an SPA the document is written once.
 */
export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
})

function Root() {
  // The pipeline moves every fifteen minutes and the world follows it on the
  // same clock. This used to arm itself when SectionFeed was imported, which
  // meant a timer nothing had asked for and nothing could stop; it is the
  // app's clock, so the app's root starts it.
  useEffect(startWorldRefresh, [])

  return (
    <>
      <div className="wash" aria-hidden><i /><i /><i /></div>
      <AppHeader />
      <Outlet />
      <StoryWarm />
      <ServiceWorker />
      <UpdateBanner />
    </>
  )
}

/** What not-found.tsx was. */
function NotFound() {
  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Not here</h1>
          <p>That page or story is not in the feed.</p>
        </div>
        <div className="panel">
          <div className="label">404</div>
          <p>Stories drop out of the feed once their coverage stops updating, so a link
            from a while back may already have gone.</p>
          <Link className="btn" to="/"
                style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
            Back to the feed
          </Link>
        </div>
      </main>
      <TabBar />
    </>
  )
}
