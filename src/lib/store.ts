'use client';

/**
 * What this browser already has.
 *
 * The pipeline moves every fifteen minutes and usually changes nothing a given
 * reader would notice, so the expensive habit was not fetching too slowly — it
 * was fetching at all. A section held here stays good until the cycle stamp
 * moves, across reloads and across days, and the only call a returning reader
 * has to make is the one that asks what the stamp is now.
 *
 * IndexedDB rather than localStorage: a section is forty-eight stories with
 * their summaries, which is comfortably past what a synchronous 5MB string
 * store should be asked to hold, and every read here is off the main thread.
 *
 * Everything is best-effort. A private window, a browser with storage disabled
 * and a quota refusal all land in the same place: no cache, fetch as before.
 */

const DB = 'smartnews';
const VERSION = 1;
const SECTIONS = 'sections';

type Entry<T> = { key: string; stamp: string | null; at: number; data: T };

let open: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (open) return open;
  open = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(SECTIONS)) d.createObjectStore(SECTIONS, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // Safari in a private window resolves neither, so do not wait forever.
      setTimeout(() => resolve(null), 2_000);
    } catch { resolve(null); }
  });
  return open;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return db().then((d) => {
    if (!d) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const req = run(d.transaction(SECTIONS, mode).objectStore(SECTIONS));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }).catch(() => null);
}

export function readEntry<T>(key: string): Promise<Entry<T> | null> {
  return tx<Entry<T>>('readonly', (s) => s.get(key));
}

export function writeEntry<T>(key: string, stamp: string | null, data: T): void {
  void tx('readwrite', (s) => s.put({ key, stamp, at: Date.now(), data } satisfies Entry<T>));
}

/**
 * The version of the world, asked once per session.
 *
 * One row read on the server, one small response, and every section this
 * browser already holds is then either current or known to be stale without a
 * single further request. Re-asked when the tab comes back to the foreground,
 * because that is when a reader who left it open for an hour looks again.
 */
let stampAt = 0;
let stamp: Promise<string | null> | null = null;
const STAMP_TTL_MS = 60_000;

export function sessionStamp(): Promise<string | null> {
  if (stamp && Date.now() - stampAt < STAMP_TTL_MS) return stamp;
  stampAt = Date.now();
  stamp = fetch('/api/stamp')
    .then((r) => (r.ok ? r.json() as Promise<{ stamp: string | null }> : null))
    .then((j) => j?.stamp ?? null)
    // No stamp is not an error: it only means nothing can be trusted to be
    // unchanged, so callers fall back to fetching.
    .catch(() => null);
  return stamp;
}

/** A reader coming back to a tab left open wants this asked again. */
export function forgetStamp() { stamp = null; stampAt = 0; }

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') forgetStamp();
  });
}
