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
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);
  return null;
}
