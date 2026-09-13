import { notFound } from '@tanstack/react-router';
import { readEntry, sessionStamp, writeEntry } from './store';

/**
 * What every route loader calls, and the one place that decides whether an
 * answer is worth keeping.
 *
 * There used to be two helpers. api.ts was a plain fetch behind six loaders;
 * world.ts checked the cycle stamp against IndexedDB behind the other two. Both
 * were right for what they served and neither knew about the other, so which
 * behaviour a route got depended on which file its loader happened to import.
 *
 * `persist` is the whole difference now, and what decides it is not a
 * preference - it is the same rule the Worker already applies to itself in
 * worker/read.ts:
 *
 *   The cycle stamp moves when the pipeline runs. An answer derived only from
 *   clusters is therefore still true while the stamp is unchanged, which is
 *   what lets the Worker answer 304 and what lets this keep a copy. That is
 *   /api/world, /api/local and /api/explore.
 *
 *   A save or a preference change does NOT move the stamp. An answer carrying
 *   the reader's own state - /api/saved, /api/reels, /api/profile,
 *   /api/story/:id - would therefore be stored against a stamp that cannot
 *   expire it, and the reader would be handed the list they had before they
 *   saved. Those are no-store on the Worker and unpersisted here, for one
 *   reason stated once.
 *
 * So the client's policy mirrors the server's rather than being a second
 * decision somebody has to rediscover.
 */

export type LoadOptions = {
  /** Keep the answer against the cycle stamp. See the rule above. */
  persist?: boolean;
  signal?: AbortSignal;
};

/**
 * One GET.
 *
 * Same-origin and credentialed by default, so sn_uid rides along and the
 * Worker resolves the reader exactly as it does for /api/world.
 */
export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  // 404 is the router's, not an error: the Worker answers it for a story id
  // that is not in the feed, and notFound() renders the route's own screen.
  if (res.status === 404) throw notFound();
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The stored copy, if the cycle it was true for is still the current one.
 *
 * Exported because world.ts needs the stamp and the stored value together to
 * work out what to ask for - it sends `since` and merges a delta rather than
 * re-fetching three hundred stories. That is the one specialisation on top of
 * this; everything else wants the two lines in `load` below.
 */
export async function readFresh<T>(key: string): Promise<{ stamp: string | null; data: T | null }> {
  const [stamp, stored] = await Promise.all([sessionStamp(), readEntry<T>(key)]);
  const fresh = stored && stamp && stored.stamp === stamp;
  return { stamp, data: fresh ? stored.data : null };
}

/** Store an answer against the cycle it was true for. */
export function keep<T>(key: string, stamp: string | null, data: T): void {
  writeEntry(key, stamp, data);
}

export async function load<T>(path: string, opts: LoadOptions = {}): Promise<T> {
  if (!opts.persist) return fetchJson<T>(path, opts.signal);

  const { stamp, data } = await readFresh<T>(path);
  // A stamp read settles the whole app, so an unmoved one means the copy on
  // disk is still the right answer and there is nothing to ask for.
  if (data) return data;

  const fresh = await fetchJson<T>(path, opts.signal);
  keep(path, stamp, fresh);
  return fresh;
}
