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
