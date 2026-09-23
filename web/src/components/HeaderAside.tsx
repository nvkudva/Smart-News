
import { Link } from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pin } from './icons';
import { ModeToggle } from './Mode';
import { readPlaceLine, writePlaceLine, type PlaceLine } from '../lib/placeLine';
import { sessionStamp, stillGood } from '../lib/store';
import { isChecking, watchChecking } from '../lib/world';

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
  const checking = useSyncExternalStore(watchChecking, isChecking, () => false);

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));

    let live = true;
    const held: PlaceLine | null = readPlaceLine();
    if (held?.here) setHere(held.here);

    void (async () => {
      const read = await sessionStamp();
      // The line is the reader's own preferences read through the gazetteer,
      // and the gazetteer only changes on a sync — which is what moves the
      // stamp. So an unmoved stamp means the stored answer is still the right
      // one, and the fetch was a Worker invocation spent to be told nothing.
      // Offline the same rule keeps the pin naming the reader's place rather
      // than blanking it for want of a stamp to compare against.
      if (held?.here && stillGood(read, held.stamp)) return;

      try {
        const res = await fetch('/api/place');
        if (!res.ok || !live) return;
        const { here: h } = await res.json() as { here: string };
        if (!live || !h) return;
        setHere(h);
        writePlaceLine({ stamp: read.stamp, here: h });
      } catch { /* the pin keeps whatever it had; it is not the story */ }
    })();

    return () => { live = false; };
  }, []);

  return (
    <div className="appbar__aside">
      <span className="appbar__when">
        <span className="appbar__date">{today}</span>
        {checking && <span className="appbar__sync" role="status">Getting new stories…</span>}
      </span>
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
