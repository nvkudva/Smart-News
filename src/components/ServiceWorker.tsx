'use client';

import { useEffect } from 'react';

/**
 * Registered after the page is interactive, not during it: the worker's whole
 * job is the *next* visit, and competing with the first one for bandwidth would
 * make the thing it exists to speed up slower.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Not in development. Turbopack reuses chunk names, so a cache-first rule
    // written for content-hashed production output serves yesterday's CSS.
    //
    // Keyed off the build, not the hostname: a phone on the LAN reaches the dev
    // server at 192.168.x.x, which is neither localhost nor 127.0.0.1, so it
    // registered the worker and then ate its own stale chunks — the exact
    // failure the paragraph above describes, on the one device it was hardest
    // to notice from. The caches go too; unregistering alone leaves the stored
    // chunks to be served to the next registration.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      if ('caches' in window) {
        caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);
  return null;
}
