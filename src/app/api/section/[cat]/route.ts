import { NextResponse } from 'next/server';
import { SECTION_PAGE, getSection } from '@/lib/sections';
import { categoryBySlug, subSlugsFor, subCategoriesFor } from '@/lib/taxonomy';
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

  const userId = await currentUserId();
  // The newest last_seen the caller already holds. Everything at or below it is
  // a body they have; everything above it either appeared or grew, which is the
  // same thing as far as a reader is concerned and the same comparison here.
  const since = Number(new URL(request.url).searchParams.get('since') ?? 0) || 0;

  // What this answer varies by, beyond the cycle. A topic section is the same
  // rows for every reader, so it is not scoped by one; the four that rank
  // against preferences carry their fingerprint, and reading the prefs row to
  // build it costs nothing the ranking below was not already going to pay —
  // getPrefs is request-scoped.
  const scope = category.kind === 'topic'
    ? `${category.slug}.${since}`
    : `${category.slug}.${since}.${prefsFingerprint(await getPrefs(userId))}`;
  const version = await conditional(request, scope);
  const headers = cacheHeaders(version, 15, 300);
  // The whole point: the pipeline moves every fifteen minutes, so most requests
  // for a section ask about a cycle the reader already has. Answer them with no
  // body and no query rather than two round trips and two hundred rows.
  if (version.fresh) return notModified(headers);

  const section = await getSection(category.slug, undefined, userId);
  const rows = section?.stories ?? [];
  const subs = subCategoriesFor(category.slug, rows);

  // One answer per category, not one per sub. The sub-strip is a refinement of
  // a list the reader is already looking at, so refining it must not cost a
  // request: every story carries the sub slugs it matches and the client filters
  // on them. The keyword lists stay here, where they live next to the taxonomy —
  // what ships is the verdict, not the rules.
  const tagged = rows.slice(0, SECTION_PAGE)
    .map((s) => ({ ...s, subs: subSlugsFor(category.slug, s) }));

  // The order always ships in full; the bodies do not.
  //
  // A section is ranked against the reader, not sorted by time, so a delta of
  // bare rows could not be merged without shipping the scorer to the browser.
  // Forty-eight ids is a couple of KB and the bodies are what cost — and an id
  // that stops appearing in this list is how the client learns that reap or the
  // prune has removed a story, which a `since` alone could never say.
  const ids = tagged.map((s) => s.id);
  const stories = since > 0 ? tagged.filter((s) => s.last_seen > since) : tagged;

  return NextResponse.json(
    { stamp: version.stamp, name: category.name, subs, total: ids.length, ids, stories },
    { headers },
  );
}
