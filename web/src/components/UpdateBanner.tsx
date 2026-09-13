import { useEffect, useState } from 'react';
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
  // Never cleared, and it does not need to be: every path out of `refresh`
  // ends in a reload, so this page is on its way out from the moment it is set.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onReady = () => setReady(true);
    window.addEventListener(UPDATE_READY, onReady);
    return () => window.removeEventListener(UPDATE_READY, onReady);
  }, []);

  async function refresh() {
    setBusy(true);
    // A waiting worker is asked to take over and the reload happens when it
    // does - activating is what swaps the shell, and reloading first would
    // serve the old one again. `once` because a worker calling clients.claim()
    // can fire controllerchange more than once.
    //
    // Everything else - no waiting worker, no service worker at all, a
    // registration lookup that threw - is the same answer: reload onto the
    // network. So it is the fallthrough rather than a branch and a catch
    // holding the same line twice.
    try {
      const waiting = (await navigator.serviceWorker?.getRegistration())?.waiting;
      if (waiting) {
        navigator.serviceWorker.addEventListener(
          'controllerchange', () => location.reload(), { once: true });
        waiting.postMessage(SKIP_WAITING);
        return;
      }
    } catch { /* falls through to the reload below */ }
    location.reload();
  }

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
