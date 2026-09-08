import { NextResponse } from 'next/server';
import { SECTION_PAGE, getSection } from '@/lib/sections';
import { categoryBySlug, filterBySub, subCategoriesFor } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';

/**
 * The data behind /c/[cat]. The page itself is a static shell now, so this is
 * the only thing a category switch waits on — and it is JSON off a memoised
 * query rather than a server render of the whole document.
 *
 * The sub-category split happens here for the same reason the counts do: the
 * keyword lists live next to the taxonomy, and shipping them to the browser to
 * re-run over rows the server already holds would trade bytes for nothing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ cat: string }> },
) {
  const { cat } = await params;
  const category = categoryBySlug(cat);
  if (!category) return NextResponse.json({ error: 'unknown category' }, { status: 404 });

  const sub = new URL(request.url).searchParams.get('sub');
  const section = await getSection(category.slug);
  const rows = section?.stories ?? [];
  const subs = subCategoriesFor(category.slug, rows);

  // An unknown or now-empty ?sub= falls back to the whole section rather than
  // 404ing: the keyword lists run against live rows, and yesterday's link
  // should still land somewhere useful.
  const active = sub && subs.some((s) => s.slug === sub) ? sub : null;
  const matching = active ? filterBySub(category.slug, active, rows) : rows;

  return NextResponse.json(
    { name: category.name, subs, active, total: matching.length,
      stories: matching.slice(0, SECTION_PAGE) },
    // The pipeline moves every fifteen minutes. A minute of shared cache and
    // five of serving stale while it refreshes costs nobody a stale headline.
    { headers: { 'cache-control': 'public, max-age=15, s-maxage=60, stale-while-revalidate=300' } },
  );
}
