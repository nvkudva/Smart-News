import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { AppHeader } from '../components/AppHeader'
import { StoryWarm } from '../components/StoryWarm'
import { TabBar } from '../components/TabBar'

/**
 * What layout.tsx held, minus the parts that were Next's.
 *
 * The metadata, viewport and the BOOT script move to index.html: they belong
 * to the document, and in an SPA the document is written once.
 *
 * ServiceWorker and UpdateBanner are still missing. Both depend on
 * public/sw.js, which is keyed on Next's BUILD_ID and caches paths this app
 * does not serve - shipping it would have a service worker holding the old
 * app's shells. That is its own step.
 */
export const Route = createRootRoute({
  component: () => (
    <>
      <div className="wash" aria-hidden><i /><i /><i /></div>
      <AppHeader />
      <Outlet />
      <StoryWarm />
    </>
  ),
  notFoundComponent: NotFound,
})

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
