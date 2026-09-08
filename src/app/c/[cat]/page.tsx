/*
 * Deliberately NO loading.tsx in this directory. A loading file opens a Suspense
 * boundary that flushes the shell — and HTTP 200 — before this component runs,
 * so the notFound() below can no longer set the status and /c/<unknown> answers
 * 200 with a not-found body. Skeletons for this route would have to live above
 * it in a group that excludes the 404-able segment.
 */
import { notFound } from 'next/navigation';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';
import { SubcategoryStrip } from '@/components/SubcategoryStrip';
import { getSection } from '@/lib/sections';
import { filterBySub, subCategoriesFor } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';

export default async function Section({
  params, searchParams,
}: {
  params: Promise<{ cat: string }>;
  searchParams: Promise<{ sub?: string }>;
}) {
  const { cat } = await params;
  const { sub } = await searchParams;

  // One query for the section; every sub-category count below comes out of the
  // same array, so a strip of eight pills still costs one round trip.
  const section = await getSection(cat);
  if (!section) notFound();

  const { category, stories: rows } = section;
  const subs = subCategoriesFor(category.slug, rows);

  // An unknown or now-empty ?sub= falls back to the whole section rather than
  // 404ing: the keyword lists run against live rows, and yesterday's link
  // should still land somewhere useful.
  const active = sub && subs.some((s) => s.slug === sub) ? sub : null;
  const stories = active ? filterBySub(category.slug, active, rows) : rows;
  const activeName = subs.find((s) => s.slug === active)?.name;

  const n = stories.length;
  const count = `${n} ${n === 1 ? 'story' : 'stories'}`;
  const meta = activeName
    ? `${count} in ${activeName}`
    : category.slug === 'local'
      ? `${count} from your places`
      : `${count} in the last 48 hours`;

  return (
    <>
      <main className="shell">
        <CategoryStrip active={category.slug} />

        <SubcategoryStrip label={category.name} base={`/c/${category.slug}`}
                          subs={subs} active={active} />

        {n === 0 ? (
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
      </main>
      <TabBar active="home" />
    </>
  );
}
