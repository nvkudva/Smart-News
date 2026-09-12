import { d1 } from './d1';

/**
 * The version of the readable world, as one string.
 *
 * sync-d1.ts writes it at the end of every pipeline run, derived from the data
 * rather than the clock, so it moves only when the feed could actually have
 * changed. The pipeline runs every fifteen minutes and usually adds nothing a
 * given reader would notice, which is what makes it worth asking: a client
 * holding this stamp can be answered with 304 and no body, for one row read
 * instead of the hundred and fifty a feed render costs.
 *
 * Memoised per isolate for a minute. An isolate serving a burst asks D1 once;
 * a stamp at most a minute stale only delays a refresh by that much, and the
 * pipeline's own cadence is fifteen times longer.
 */
const TTL_MS = 60_000;
let cached: { value: string; at: number } | null = null;

export async function cycleStamp(): Promise<string | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const row = await (await d1()).get<{ value: string }>(
      'SELECT value FROM sync_meta WHERE key = ?', ['cycle']);
    if (!row?.value) return null;
    cached = { value: row.value, at: Date.now() };
    return row.value;
  } catch {
    return null;   // no stamp is not an error; it only means no 304s
  }
}

/**
 * The conditional-request half. Weak, because the body is a render of the same
 * data and not a byte-for-byte artefact — two renders of one cycle are
 * equivalent, which is exactly what a weak validator asserts.
 */
export function etagFor(stamp: string, scope = ''): string {
  return `W/"${stamp}${scope ? `.${scope}` : ''}"`;
}

/** True when the client already holds this exact version. */
export function matches(request: Request, etag: string): boolean {
  const header = request.headers.get('if-none-match');
  if (!header) return false;
  return header.split(',').some((t) => t.trim() === etag);
}

/**
 * The header every /api response carries. A client that keeps the last value it
 * saw can tell whether anything it holds is stale without asking a second time,
 * and the delta endpoints take it back as `If-None-Match`.
 */
export const STAMP_HEADER = 'x-cycle';

/**
 * The three things a conditional route needs, resolved in one place: the stamp
 * for this cycle, the validator for this particular answer, and whether the
 * caller already holds it.
 *
 * `scope` names what varies beyond the cycle — the category, the sub-filter,
 * the fingerprint of the preferences an answer was ranked against. Two answers
 * that differ must never share a validator, which is what the scope prevents.
 */
export async function conditional(request: Request, scope: string) {
  const stamp = await cycleStamp();
  const etag = stamp ? etagFor(stamp, scope) : null;
  return { stamp, etag, fresh: !!etag && matches(request, etag) };
}

/**
 * Headers for a cacheable JSON answer. `private` because every body here is
 * either the reader's own or ranked against their preferences; the browser may
 * still hold it, which is the only cache that matters on workers.dev.
 */
export function cacheHeaders(
  { stamp, etag }: { stamp: string | null; etag: string | null },
  maxAge: number, swr: number,
): Record<string, string> {
  const h: Record<string, string> = {
    'cache-control': `private, max-age=${maxAge}, stale-while-revalidate=${swr}`,
  };
  if (etag) h.etag = etag;
  if (stamp) h[STAMP_HEADER] = stamp;
  return h;
}

/** A 304 keeps the validator: without it the next request has nothing to send. */
export function notModified(headers: Record<string, string>): Response {
  return new Response(null, { status: 304, headers });
}
