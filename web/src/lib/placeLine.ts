/**
 * The place line in the masthead, as this browser last knew it.
 *
 * Its own module rather than three functions inside HeaderAside, because
 * prefsChanged has to forget it: a preference change moves the line without
 * moving the cycle stamp it is stored against. A utility reaching into a
 * component to clear storage was the dependency pointing the wrong way.
 */
const KEY = 'sn_here';

/** The stored line, against the cycle it was true for. */
export type PlaceLine = { stamp: string | null; here: string };

export function readPlaceLine(): PlaceLine | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // A value written before this carried a stamp is a bare string.
    return raw.startsWith('{') ? JSON.parse(raw) as PlaceLine : { stamp: null, here: raw };
  } catch {
    return null;   // first visit, or storage refused
  }
}

export function writePlaceLine(line: PlaceLine): void {
  try { localStorage.setItem(KEY, JSON.stringify(line)); } catch { /* the label still shows */ }
}

export function forgetPlaceLine(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
