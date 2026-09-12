
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Pin } from './icons';
import { ModeToggle } from './Mode';
import { sessionStamp } from '../lib/store';

const KEY = 'sn_here';

/** The stored line, against the cycle it was true for. */
type Held = { stamp: string | null; here: string };

/** Saving preferences can move this without moving the cycle stamp, so the
 *  purge that empties the section caches empties this too. */
export function forgetPlace() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}

/**
 * The date and the place are the only part of the header that is not the same
 * for every reader on every day, and keeping them on the server made every page
 * that carries the bar render per request. Both come from the browser now: the
 * date from its own clock, which is more correct than ours anyway, and the
 * place from the last answer we stored, so it paints before the fetch returns.
 */
export function HeaderAside() {
  const [today, setToday] = useState('');
  const [here, setHere] = useState('');

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));

    let live = true;
    let held: Held | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      // Anything stored before this carried the line on its own.
      if (raw) held = raw.startsWith('{') ? JSON.parse(raw) as Held : { stamp: null, here: raw };
      if (held?.here) setHere(held.here);
    } catch { /* first visit, or storage refused */ }

    void (async () => {
      const stamp = await sessionStamp();
      // The line is the reader's own preferences read through the gazetteer,
      // and the gazetteer only changes on a sync — which is what moves the
      // stamp. So an unmoved stamp means the stored answer is still the right
      // one, and the fetch was a Worker invocation spent to be told nothing.
      if (held?.here && stamp && held.stamp === stamp) return;

      try {
        const res = await fetch('/api/place');
        if (!res.ok || !live) return;
        const { here: h } = await res.json() as { here: string };
        if (!live || !h) return;
        setHere(h);
        try { localStorage.setItem(KEY, JSON.stringify({ stamp, here: h } satisfies Held)); }
        catch { /* the label still shows */ }
      } catch { /* the pin keeps whatever it had; it is not the story */ }
    })();

    return () => { live = false; };
  }, []);

  return (
    <div className="appbar__aside">
      <span className="appbar__date">{today}</span>
      {/* The one way into the local surface: no sixth tab, but the pin was
          already naming the reader's place, so make it go there. */}
      <Link to="/local" className="pinchip" aria-label={here ? `Local news for ${here}` : 'Local news'}>
        <span className="pinchip__i"><Pin size={12} /></span>
        <span className="pinchip__t">{here || 'Local'}</span>
      </Link>
      <ModeToggle />
    </div>
  );
}
