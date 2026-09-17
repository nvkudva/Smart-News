
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

/**
 * Every way this can fail is the same answer: null, and the caller fetches.
 *
 * It said so three times - a try/catch inside the promise, an onerror handler,
 * and a trailing .catch on the then-chain outside it - for a store whose whole
 * contract is "the copy on disk, or nothing".
 */
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const d = await db();
    if (!d) return null;
    const req = run(d.transaction(SECTIONS, mode).objectStore(SECTIONS));
    return await new Promise<T | null>((resolve) => {
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function readEntry<T>(key: string): Promise<Entry<T> | null> {
  return tx<Entry<T>>('readonly', (s) => s.get(key));
}

/**
 * Keep the data, drop its claim to be current. Saving preferences re-ranks the
 * orderings without moving the cycle stamp the copy is keyed on; stored with
 * no stamp it can never read as fresh, and the next load re-asks with `since`
 * so the bodies in it are still worth having. Written to disk rather than
 * only remembered, so a reload inside the same cycle cannot read the old
 * ranking straight back.
 */
export function unstampEntry(key: string): Promise<void> {
  return readEntry<unknown>(key).then((e) => { if (e) writeEntry(key, null, e.data); });
}

export function writeEntry<T>(key: string, stamp: string | null, data: T): void {
  void tx('readwrite', (s) => s.put({ key, stamp, at: Date.now(), data } satisfies Entry<T>));
}

/**
 * What a stamp read learnt.
 *
 * Two answers used to arrive as the same `null`, and they mean opposite things
 * to a caller holding a stored copy. `known: true, stamp: null` is the Worker
 * saying there is no cycle to key on - nothing can be fresh, so fetch. `known:
 * false` is not having asked successfully at all, which says nothing about the
 * copy on disk: offline, that copy is the only answer there is, and it is the
 * right one. Collapsing the two threw away a perfectly good stored feed every
 * time the network was down and rendered the error screen instead.
 */
export type StampRead = { stamp: string | null; known: boolean };

/**
 * Is a copy stored against `was` still the right answer?
 *
 * The rule above, as the one expression both callers need - readFresh for a
 * section, HeaderAside for the place line - so the offline case cannot be
 * fixed in one of them and left in the other.
 */
export function stillGood({ stamp, known }: StampRead, was: string | null): boolean {
  return known ? stamp !== null && was === stamp : true;
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
let stamp: Promise<StampRead> | null = null;
// Five minutes, not one. The pipeline runs every thirty and the idle refresh
// every fifteen, so a reader moving between routes was asking for the stamp
// far more often than it could have moved; this is the most the client can
// be behind, and the timer already accepts three times that.
const STAMP_TTL_MS = 5 * 60_000;

export function sessionStamp(): Promise<StampRead> {
  if (stamp && Date.now() - stampAt < STAMP_TTL_MS) return stamp;
  stampAt = Date.now();
  stamp = fetch('/api/stamp')
    .then(async (r): Promise<StampRead> => (r.ok
      ? { stamp: ((await r.json()) as { stamp: string | null }).stamp ?? null, known: true }
      // A 5xx reached the Worker and still did not say what the stamp is, so
      // it is the same non-answer a dropped connection is.
      : { stamp: null, known: false }))
    .catch((): StampRead => ({ stamp: null, known: false }))
    .then((r) => {
      // Not worth a minute of memory: the next call happens after the reader
      // has come back, and coming back is usually the network coming back too.
      if (!r.known) stampAt = 0;
      return r;
    });
  return stamp;
}

/**
 * A reader coming back to a tab left open wants this asked again.
 *
 * Called by the refresh in lib/world.ts, which listens for visibilitychange as
 * part of a cancellable timer the root starts. This module used to register the
 * same listener at import time - the same call on the same event, so one of
 * them was always redundant, and the import-time one could not be stopped.
 */
export function forgetStamp() { stamp = null; stampAt = 0; }
