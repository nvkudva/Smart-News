import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';
import { SectionFeed, SectionSkeleton } from '@/components/SectionFeed';
import { categoryBySlug } from '@/lib/taxonomy';

/**
 * A static shell. Everything above the rows — the strip, the highlight, the
 * bar — is derivable from the hardcoded taxonomy, so all fourteen categories
 * are built once and a switch is a client navigation with no server render in
 * it. The rows arrive from /api/section/[cat], which the strip warms on hover
 * and SectionFeed keeps for a minute, so a revisit costs nothing at all.
 *
 * Prerendering the fourteen would be better still, but OpenNext writes SSG
 * output to an incremental cache this deployment has no binding for, so the
 * built pages 404 at runtime. The service worker caches the shell instead.
 *
 * The 404 is decided by a pure taxonomy lookup before anything is awaited, so
 * the Suspense boundary below cannot flush a 200 in front of it, which is why
 * this can live in the page when a loading.tsx here could not.
 */

export default async function SectionPage({ params }: { params: Promise<{ cat: string }> }) {
  const { cat } = await params;
  const category = categoryBySlug(cat);
  if (!category) notFound();

  return (
    <>
      <main className="shell">
        <CategoryStrip active={category.slug} />
        {/* useSearchParams reads ?sub= on the client; the boundary is what lets
            the rest of the page stay static rather than opting into a render
            per request just to learn the query string. */}
        <Suspense fallback={<SectionSkeleton />}>
          <SectionFeed cat={category.slug} name={category.name} />
        </Suspense>
      </main>
      <TabBar active="home" />
    </>
  );
}
