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
    // The pipeline moves every fifteen minutes, so a minute of caching and five
    // of serving stale while it refreshes costs nobody a stale headline.
    //
    // private, not public: four of the fourteen slugs — top, local, national,
    // international — are ranked against the reader's prefs, so the body is
    // reader-specific. That is harmless while there is one identity and no
    // shared cache to honour it, which is exactly why it would be easy to leave
    // wrong until the day identity is added and it becomes a cross-reader leak.
    // s-maxage is gone with it: on workers.dev there is no shared cache, so it
    // read as working edge caching and was not.
    { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=300' } },
  );
}
