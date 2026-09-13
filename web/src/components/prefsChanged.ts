
import { forgetPlaceLine } from '../lib/placeLine';
import { clearSections } from '../lib/world';

/**
 * What a preference change has to invalidate, and none of it reachable from the
 * server action that writes the change: the world this tab holds and its copy
 * in IndexedDB, the place line in localStorage, and the service worker's cache
 * of /api/*. The isolate map in sections.ts is the exception — it is keyed on a
 * fingerprint of the prefs row and invalidates itself.
 *
 * This used to hang off a form's submit event. The settings save as you tap
 * now and there is no form left on the page, so it was waiting for something
 * that could never fire and every preference change left all of it standing.
 * Each control calls this once its own action has landed.
 */
export function prefsChanged(): void {
  clearSections();
  forgetPlaceLine();
  // Cache names are versioned; the prefix is what stays true.
  void caches?.keys()
    .then((names) => Promise.all(
      names.filter((n) => n.startsWith('data-')).map((n) => caches.delete(n))))
    .catch(() => {});
}
