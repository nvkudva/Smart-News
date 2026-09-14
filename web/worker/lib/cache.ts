import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * React's `cache()`, for a Worker.
 *
 * feed.ts memoises getPrefs so the several sections rendered for one reader
 * share a single D1 round trip. React scopes that memo to the request; a
 * module-level Map would scope it to the isolate instead, and an isolate
 * outlives the request — a reader who changed their country would keep being
 * served the old one until Cloudflare recycled the isolate.
 *
 * So the store is per-request, held in AsyncLocalStorage and entered once in
 * the Worker's fetch handler. Outside a request there is no store and every
 * call goes straight through, which is what a script wants.
 */
const store = new AsyncLocalStorage<Map<string, unknown>>();

/**
 * Module-level, not per-`cache()` call: two memoised functions given the same
 * arguments must not collide on one key.
 */
let seq = 0;

/** Runs `fn` with a fresh memo. Everything a request does belongs inside it. */
export function withRequestCache<T>(fn: () => T): T {
  return store.run(new Map(), fn);
}

export function cache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const id = `fn${seq++}:`;
  return (...args: A): R => {
    const map = store.getStore();
    if (!map) return fn(...args);
    // Arguments here are ids and slugs. JSON.stringify is enough of a key for
    // those and wrong for anything holding a function or a cycle, so callers
    // that memoise richer arguments need their own key.
    const key = id + JSON.stringify(args);
    if (map.has(key)) return map.get(key) as R;
    const value = fn(...args);
    map.set(key, value);
    return value;
  };
}

/**
 * Stamp-keyed memo, shared by every answer that is the same for all readers.
 *
 * The feed's sections have been cached this way for a while; Explore, Reels and
 * the profile's place list were not, and each of them sorts or groups over the
 * whole live window, which D1 bills by the row. One reader opening Explore was
 * three scans of every summarised cluster in 48 hours, again on the next view.
 *
 * Keyed on the cycle stamp rather than a clock: the answer is dead the moment
 * the pipeline publishes, and until then it cannot have changed.
 *
 * Promises, not results, are cached — two readers landing together share one
 * query instead of racing. A failed query is forgotten rather than remembered
 * as this cycle's answer.
 */
const NO_STAMP_TTL_MS = 60_000;
const warmed = new Map<string, { stamp: string; at: number; value: Promise<unknown> }>();

export function warm<T>(key: string, stamp: string | null, run: () => Promise<T>): Promise<T> {
  const version = stamp ?? 'none';
  const hit = warmed.get(key);
  if (hit && hit.stamp === version && (stamp !== null || Date.now() - hit.at < NO_STAMP_TTL_MS)) {
    return hit.value as Promise<T>;
  }

  const value = run();
  warmed.set(key, { stamp: version, at: Date.now(), value });
  value.catch(() => { if (warmed.get(key)?.value === value) warmed.delete(key); });

  // Everything from an older cycle is dead the moment the stamp moves, so the
  // map never carries more than this isolate served this cycle.
  for (const [k, v] of warmed) if (v.stamp !== version) warmed.delete(k);
  return value;
}
