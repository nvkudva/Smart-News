import { Outlet, createRootRoute } from '@tanstack/react-router'

/**
 * What layout.tsx held, minus the parts that were Next's.
 *
 * The metadata, viewport and the BOOT script move to index.html: they belong
 * to the document, and in an SPA the document is written once. AppHeader,
 * StoryWarm, ServiceWorker and UpdateBanner are not here yet — the header
 * needs the write side, and the service worker is its own step.
 */
export const Route = createRootRoute({
  component: () => (
    <>
      <div className="wash" aria-hidden><i /><i /><i /></div>
      <Outlet />
    </>
  ),
})
