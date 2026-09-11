import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';
import { CategoryPager } from '@/components/CategoryPager';
import { SectionSkeleton } from '@/components/SectionFeed';
import { TAXONOMY, categoryBySlug } from '@/lib/taxonomy';

/**
 * A static shell. Everything above the rows — the strip, the highlight, the
 * bar — is derivable from the hardcoded taxonomy, so all fourteen categories
 * are built once and a switch is a client navigation with no server render in
 * it. The rows arrive from /api/section/[cat], which the strip warms on hover
 * and SectionFeed keeps for a minute, so a revisit costs nothing at all.
 *
 * The fourteen are prerendered. Nothing above the rows is awaited, so each one
 * is a file in .open-next/assets that Cloudflare serves without invoking the
 * Worker at all — and asset requests are free and uncounted, which is the whole
 * reason to reach for a shell rather than an ISR page: a page in an incremental
 * cache still costs a Worker invocation to read.
 *
 * The 404 is decided by a pure taxonomy lookup before anything is awaited, so
 * the Suspense boundary below cannot flush a 200 in front of it, which is why
 * this can live in the page when a loading.tsx here could not.
 */

export function generateStaticParams() {
  return TAXONOMY.map((c) => ({ cat: c.slug }));
}

export default async function SectionPage({ params }: { params: Promise<{ cat: string }> }) {
  const { cat } = await params;
  const category = categoryBySlug(cat);
  if (!category) notFound();

  return (
    <>
      <main className="shell">
        <CategoryStrip active={category.slug} />
        {/* The strip is the page's title on a phone, where it is set at display
            size. In the desktop column it is set small, so the title has to be
            said again — outside the pager, which swaps its children mid-swipe. */}
        <h1 className="cattitle">{category.name}</h1>
        {/* useSearchParams reads ?sub= on the client; the boundary is what lets
            the rest of the page stay static rather than opting into a render
            per request just to learn the query string. */}
        <Suspense fallback={<SectionSkeleton />}>
          <CategoryPager active={category.slug}
                         sections={TAXONOMY.map((c) => ({ slug: c.slug, name: c.name }))} />
        </Suspense>
      </main>
      <TabBar active="home" />
    </>
  );
}
