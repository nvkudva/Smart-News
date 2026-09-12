import { useEffect } from 'react';

/**
 * The event UpdateBanner listens for. Dispatched once a new worker has
 * installed and is waiting, which only happens when one is already in control -
 * a first install is not an update and must not be announced.
 */
export const UPDATE_READY = 'sn:update-ready';

/** Ask the waiting worker to take over. It answers by activating, which fires
 *  controllerchange on every client. */
export const SKIP_WAITING = 'sn:skip-waiting';

/**
 * Registered after the page is interactive, not during it: the worker's whole
 * job is the *next* visit, and competing with the first one for bandwidth would
 * make the thing it exists to speed up slower.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Not in development. The dev server serves unhashed modules under paths a
    // cache-first rule written for content-hashed output will happily keep
    // forever, so the worker would serve yesterday's code.
    //
    // Keyed off the build, not the hostname: a phone on the LAN reaches the dev
    // server at 192.168.x.x, which is neither localhost nor 127.0.0.1, so it
    // registered the worker and then ate its own stale chunks - the exact
    // failure above, on the one device it was hardest to notice from. The
    // caches go too; unregistering alone leaves the stored files to be served
    // to the next registration.
    if (import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations()
        .then((rs) => rs.forEach((r) => void r.unregister())).catch(() => {});
      if ('caches' in window) {
        caches.keys().then((ks) => ks.forEach((k) => void caches.delete(k))).catch(() => {});
      }
      return;
    }

    const announce = () => window.dispatchEvent(new Event(UPDATE_READY));

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');

        // Already waiting when we got here: the reader opened the app on a
        // shell this worker has since superseded, and nothing will fire
        // updatefound for an update that landed before this page loaded.
        if (reg.waiting && navigator.serviceWorker.controller) announce();

        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            // A controller already in place is what distinguishes an update
            // from a first install. Without that check every first-ever visit
            // would be told a newer version is ready.
            if (next.state === 'installed' && navigator.serviceWorker.controller) announce();
          });
        });
      } catch { /* no worker is a slower app, not a broken one */ }
    };

    if (document.readyState === 'complete') {
      void register();
      return;
    }
    const onLoad = () => void register();
    window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
