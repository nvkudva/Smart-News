'use client';

import { useCallback, useEffect, useState } from 'react';

/** Only while the tab is being looked at; a backgrounded PWA polls nothing. */
const EVERY_MS = 15 * 60_000;

/**
 * Tells the reader a new build is out, and reloads onto it when they say so.
 *
 * The signal is /BUILD_ID rather than the service worker's own update cycle.
 * sw.js is hand-written and byte-identical between deploys, so the browser
 * finds nothing changed and `updatefound` never fires — the worker can sit on
 * an old build indefinitely while reporting itself current. The build id is the
 * one file guaranteed to differ, and it is outside every cache rule in sw.js,
 * so the check always reaches the network.
 *
 * Never nags: this appears once per build, is dismissible, and the next check
 * against the same id stays silent.
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // In development /BUILD_ID is a 404 rendered as the not-found page, so the
    // whole watcher folds away on the first read rather than polling an error.
    if (process.env.NODE_ENV !== 'production') return;

    let live = true;
    let mine: string | null = null;
    let dismissed: string | null = null;

    const read = async () => {
      try {
        const res = await fetch('/BUILD_ID', { cache: 'no-store' });
        if (!res.ok) return null;
        const id = (await res.text()).trim();
        return id && id.length < 128 ? id : null;
      } catch {
        return null; // offline: not an update, and not worth saying anything about
      }
    };

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const id = await read();
      if (!live || !id) return;
      if (mine === null) { mine = id; return; }   // first read is the baseline
      if (id !== mine && id !== dismissed) setStale(true);
    };

    void check();
    const timer = setInterval(check, EVERY_MS);
    // Returning to a PWA that has been in the background for a day is the moment
    // this matters most, and the interval will not have run while it was hidden.
    document.addEventListener('visibilitychange', check);

    const onDismiss = () => { void read().then((id) => { dismissed = id; }); };
    window.addEventListener('sn:update-dismissed', onDismiss);

    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('sn:update-dismissed', onDismiss);
    };
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    // The caches hold the previous build's chunks and its cached documents. A
    // reload that leaves them in place can land back on exactly what it left.
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update().catch(() => {});
    } catch { /* a reload onto the network is still better than staying put */ }
    location.reload();
  }, []);

  if (!stale) return null;

  return (
    <div className="updatebar" role="status" aria-live="polite">
      <span className="updatebar__t">A newer version is ready.</span>
      <button type="button" className="updatebar__go" onClick={refresh} disabled={busy}>
        {busy ? 'Reloading…' : 'Refresh'}
      </button>
      <button
        type="button"
        className="updatebar__x"
        aria-label="Dismiss"
        onClick={() => { setStale(false); window.dispatchEvent(new Event('sn:update-dismissed')); }}
      >
        ✕
      </button>
    </div>
  );
}
