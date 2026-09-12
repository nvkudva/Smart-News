import { Outlet, createRootRoute } from '@tanstack/react-router'
import { AppHeader } from '../components/AppHeader'

/**
 * What layout.tsx held, minus the parts that were Next's.
 *
 * The metadata, viewport and the BOOT script move to index.html: they belong
 * to the document, and in an SPA the document is written once. StoryWarm,
 * ServiceWorker and UpdateBanner are not here yet - the service worker is
 * keyed on Next's BUILD_ID and gets its own step.
 */
export const Route = createRootRoute({
  component: () => (
    <>
      <div className="wash" aria-hidden><i /><i /><i /></div>
      <AppHeader />
      <Outlet />
    </>
  ),
})
