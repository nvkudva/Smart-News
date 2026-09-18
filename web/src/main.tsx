import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import { routeTree } from './routeTree.gen'

// #root is the scroller, not the document, so both halves of scroll handling
// have to be pointed at it: reset-to-top on a new entry, or a story opens
// wherever the feed was, and restoration on back, or the feed comes back at
// the top instead of where the reader left it. The element opts in with
// data-scroll-restoration-id in index.html.
const router = createRouter({ routeTree, scrollRestoration: true, scrollToTopSelectors: ['#root'] })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
