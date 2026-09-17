import { fetchJson } from './load';
import type { SavedIdsPayload } from '../../shared/types';

/**
 * Which stories this reader has saved, asked once a session.
 *
 * A save does not move the cycle stamp, so the world cannot carry this set: a
 * 304 against the stamp would hand back the set from before the save. It used
 * to travel inside /api/reels and /api/story instead, which made both of them
 * no-store and cost a Worker invocation and four D1 reads on every story open
 * and every hover. Now it is one small no-store answer, kept here and moved
 * locally from what the toggle action returns, and the two pages read the
 * stamp-keyed world for everything else.
 *
 * A read that fails resolves to an empty set rather than throwing: a bookmark
 * that fails to light is not a reason to fail the page.
 */
let ids: Promise<Set<string>> | null = null;

export function savedIds(): Promise<Set<string>> {
  if (!ids) {
    ids = fetchJson<SavedIdsPayload>('/api/saved-ids')
      .then((r) => new Set(r.ids))
      .catch(() => { ids = null; return new Set<string>(); });
  }
  return ids;
}

/** What the toggle action answered, applied to the copy held here. */
export function markSaved(id: string, on: boolean): void {
  void savedIds().then((set) => { if (on) set.add(id); else set.delete(id); });
}
