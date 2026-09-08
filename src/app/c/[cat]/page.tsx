/*
 * Deliberately NO loading.tsx in this directory. A loading file opens a Suspense
 * boundary around the whole segment, which flushes the shell — and HTTP 200 —
 * before this component runs, so the notFound() below could no longer set the
 * status and /c/<unknown> would answer 200 with a not-found body.
 *
 * The boundary inside the page is safe for the same reason it is useful: the
 * slug is checked against the taxonomy first, with no I/O and nothing streamed,
 * so an unknown one still 404s. Only the query is deferred, which is what makes
 * switching categories feel immediate — the strip and the highlight are already
 * on screen while the rows are still coming.
 */
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';
import { SubcategoryStrip } from '@/components/SubcategoryStrip';
import { SECTION_PAGE, getSection } from '@/lib/sections';
import { categoryBySlug, filterBySub, subCategoriesFor, type Section } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';

export default async function SectionPage({
  params, searchParams,
}: {
  params: Promise<{ cat: string }>;
  searchParams: Promise<{ sub?: string }>;
}) {
  const { cat } = await params;
  const { sub } = await searchParams;

  // Pure lookup against the hardcoded taxonomy: no store, nothing to await, so
  // the 404 is decided before a single byte of the shell can be flushed.
  const category = categoryBySlug(cat);
  if (!category) notFound();

  return (
    <>
      <main className="shell">
        <CategoryStrip active={category.slug} />
        {/* Keyed so switching sub-category re-suspends rather than holding the
            previous list on screen while the new one loads. */}
        <Suspense key={`${category.slug}:${sub ?? ''}`} fallback={<SectionSkeleton />}>
          <SectionBody category={category} sub={sub} />
        </Suspense>
      </main>
      <TabBar active="home" />
    </>
  );
}

function SectionSkeleton() {
  return (
    <>
      <div className="substrip" aria-hidden><div className="substrip__row" /></div>
      <div className="feed" aria-busy="true" aria-label="Loading stories">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className={`skel ${i === 0 ? 'skel--lead' : i % 3 === 2 ? 'skel--compact' : ''}`} />
        ))}
      </div>
    </>
  );
}

async function SectionBody({ category, sub }: { category: Section; sub?: string }) {
  // One query for the section; every sub-category count below comes out of the
  // same array, so a strip of eight pills still costs one round trip.
  const section = await getSection(category.slug);
  const rows = section?.stories ?? [];
  const subs = subCategoriesFor(category.slug, rows);

  // An unknown or now-empty ?sub= falls back to the whole section rather than
  // 404ing: the keyword lists run against live rows, and yesterday's link
  // should still land somewhere useful.
  const active = sub && subs.some((s) => s.slug === sub) ? sub : null;
  const matching = active ? filterBySub(category.slug, active, rows) : rows;
  const stories = matching.slice(0, SECTION_PAGE);
  const activeName = subs.find((s) => s.slug === active)?.name;

  return (
    <>
      <SubcategoryStrip label={category.name} base={`/c/${category.slug}`}
                        subs={subs} active={active} />

      {matching.length === 0 ? (
        <div className="panel">
          <div className="label">Quiet so far</div>
          <p>
            Nothing has been filed under {activeName ?? category.name} in the
            last two days. The main feed still carries these stories when they
            turn up.
          </p>
        </div>
      ) : (
        <div className="feed">
          {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
        </div>
      )}
    </>
  );
}
