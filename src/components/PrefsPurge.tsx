'use client';

import { useEffect, useRef } from 'react';
import { forgetPlace } from './HeaderAside';
import { clearSections } from './SectionFeed';

/**
 * Two of the three caches that stand between a preference change and the feed
 * the reader sees live in this tab, and neither of them is reachable from the
 * server action that writes the change. The third — the isolate map in
 * sections.ts — is keyed on a fingerprint of the prefs row and invalidates
 * itself.
 *
 * Rendered inside the form so it can listen for the submit that starts the
 * action, rather than having the page thread a callback through it.
 */
export function PrefsPurge() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;

    const purge = () => {
      clearSections();
      // The pin names a place the reader may have just changed, and that change
      // does not move the cycle stamp the stored line is keyed on.
      forgetPlace();
      // The service worker answers /api/* stale-while-revalidate for a minute,
      // so the old ranking would come back from its cache even with both maps
      // emptied. Names are versioned; the prefix is what stays true.
      void caches?.keys()
        .then((names) => Promise.all(
          names.filter((n) => n.startsWith('data-')).map((n) => caches.delete(n))))
        .catch(() => {});
    };

    form.addEventListener('submit', purge);
    return () => form.removeEventListener('submit', purge);
  }, []);

  return <span ref={anchor} hidden />;
}
