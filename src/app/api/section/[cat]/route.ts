import { NextResponse } from 'next/server';
import { SECTION_PAGE, getSection } from '@/lib/sections';
import { categoryBySlug, filterBySub, subCategoriesFor } from '@/lib/taxonomy';
import { currentUserId } from '@/lib/session';
import { getPrefs, prefsFingerprint } from '@/lib/feed';
import { cacheHeaders, conditional, notModified } from '@/lib/cycle';

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
  const userId = await currentUserId();

  // What this answer varies by, beyond the cycle. A topic section is the same
  // rows for every reader, so it is not scoped by one; the four that rank
  // against preferences carry their fingerprint, and reading the prefs row to
  // build it costs nothing the ranking below was not already going to pay —
  // getPrefs is request-scoped.
  const scope = category.kind === 'topic'
    ? `${category.slug}.${sub ?? ''}`
    : `${category.slug}.${sub ?? ''}.${prefsFingerprint(await getPrefs(userId))}`;
  const version = await conditional(request, scope);
  const headers = cacheHeaders(version, 15, 300);
  // The whole point: the pipeline moves every fifteen minutes, so most requests
  // for a section ask about a cycle the reader already has. Answer them with no
  // body and no query rather than two round trips and two hundred rows.
  if (version.fresh) return notModified(headers);

  const section = await getSection(category.slug, undefined, userId);
  const rows = section?.stories ?? [];
  const subs = subCategoriesFor(category.slug, rows);

  // An unknown or now-empty ?sub= falls back to the whole section rather than
  // 404ing: the keyword lists run against live rows, and yesterday's link
  // should still land somewhere useful.
  const active = sub && subs.some((s) => s.slug === sub) ? sub : null;
  const matching = active ? filterBySub(category.slug, active, rows) : rows;

  return NextResponse.json(
    { stamp: version.stamp, name: category.name, subs, active,
      total: matching.length, stories: matching.slice(0, SECTION_PAGE) },
    { headers },
  );
}
