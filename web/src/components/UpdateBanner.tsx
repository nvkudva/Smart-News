import { useCallback, useEffect, useState } from 'react';
import { SKIP_WAITING, UPDATE_READY } from './ServiceWorker';

/**
 * Tells the reader a new build is out, and reloads onto it when they say so.
 *
 * In the Next tree this polled /BUILD_ID every fifteen minutes, because sw.js
 * was byte-identical between deploys: the browser found nothing changed,
 * updatefound never fired, and the worker could sit on an old build
 * indefinitely while reporting itself current. The build id was the one file
 * guaranteed to differ.
 *
 * vite.config.ts now stamps a version derived from the built asset hashes into
 * sw.js, so the worker itself differs whenever the app does and the browser's
 * own update cycle is the signal. No polling, no /BUILD_ID, and the banner
 * appears the moment the new worker finishes installing rather than up to
 * fifteen minutes later.
 *
 * Never nags: dismissing hides it until the next worker installs.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onReady = () => setReady(true);
    window.addEventListener(UPDATE_READY, onReady);
    return () => window.removeEventListener(UPDATE_READY, onReady);
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const waiting = reg?.waiting;

      if (waiting) {
        // Reload when the new worker takes control, not on a timer: activating
        // is what swaps the shell, and reloading before it lands would serve
        // the old one again. `once` because a worker that calls clients.claim()
        // can fire this more than once.
        navigator.serviceWorker.addEventListener(
          'controllerchange', () => location.reload(), { once: true });
        waiting.postMessage(SKIP_WAITING);
        return;
      }

      // No waiting worker - the announcement is stale, or there is no worker at
      // all. A plain reload onto the network is the honest answer.
      location.reload();
    } catch {
      location.reload();
    }
  }, []);

  if (!ready) return null;

  return (
    <div className="updatebar" role="status" aria-live="polite">
      <span className="updatebar__t">A newer version is ready.</span>
      <button type="button" className="updatebar__go" onClick={() => void refresh()} disabled={busy}>
        {busy ? 'Reloading…' : 'Refresh'}
      </button>
      <button
        type="button"
        className="updatebar__x"
        aria-label="Dismiss"
        onClick={() => setReady(false)}
      >
        ✕
      </button>
    </div>
  );
}
