import { createFileRoute } from '@tanstack/react-router'
import { TAXONOMY } from '../../shared/taxonomy'
import { CategoryPager } from '../components/CategoryPager'
import { CategoryStrip } from '../components/CategoryStrip'
import { TabBar } from '../components/TabBar'

/**
 * The same shell every category page is, for the section that gets the traffic.
 *
 * Top used to be the one section rendered on the server: force-dynamic, thirty
 * cards off a hundred-and-fifty-row query, on the app's entry point, the PWA's
 * start_url and the page the service worker precaches. Every visit cost a
 * Worker invocation and a hundred and fifty rows, and none of it could be
 * cached, because the ranking is the reader's own.
 *
 * Nothing above the rows needs a reader or a request - the strip is the
 * hardcoded taxonomy - so this is a file in dist/client that Cloudflare serves
 * without invoking the Worker at all, and the rows arrive from /api/world,
 * which the isolate map, the cycle stamp and IndexedDB between them mean is
 * usually not fetched either.
 */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { sub?: string } => ({
    sub: typeof search.sub === 'string' ? search.sub : undefined,
  }),
  component: Home,
})

const SECTIONS = TAXONOMY.map((c) => ({ slug: c.slug, name: c.name }))

function Home() {
  return (
    <>
      <main className="shell">
        <CategoryStrip active="top" />
        <CategoryPager active="top" sections={SECTIONS} />
      </main>
      <TabBar active="home" />
    </>
  )
}
