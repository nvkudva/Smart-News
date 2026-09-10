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
