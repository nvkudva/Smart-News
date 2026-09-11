import { Suspense } from 'react';
import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';
import { CategoryPager } from '@/components/CategoryPager';
import { SectionSkeleton } from '@/components/SectionFeed';
import { TAXONOMY } from '@/lib/taxonomy';

/**
 * The same shell every category page is, for the section that gets the traffic.
 *
 * Top used to be the one section rendered on the server: force-dynamic, thirty
 * cards off a hundred-and-fifty-row query, on the app's entry point, the PWA's
 * start_url and the page the service worker precaches. Every visit cost a
 * Worker invocation and a hundred and fifty rows, and none of it could be
 * cached, because the ranking is the reader's own.
 *
 * Nothing above the rows needs a reader or a request — the strip is the
 * hardcoded taxonomy — so this is now a file in .open-next/assets that
 * Cloudflare serves without invoking the Worker at all, and the rows arrive
 * from /api/section/top, which the isolate map, the cycle stamp and IndexedDB
 * between them mean is usually not fetched either.
 */
export default function Home() {
  return (
    <>
      <main className="shell">
        <CategoryStrip active="top" />
        {/* useSearchParams reads ?sub= on the client; the boundary is what lets
            the rest of the page stay static rather than opting into a render
            per request just to learn the query string. */}
        <Suspense fallback={<SectionSkeleton />}>
          <CategoryPager active="top"
                         sections={TAXONOMY.map((c) => ({ slug: c.slug, name: c.name }))} />
        </Suspense>
      </main>
      <TabBar active="home" />
    </>
  );
}
