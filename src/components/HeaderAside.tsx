'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Pin } from './icons';

const KEY = 'sn_here';

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
    setToday(new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' }));
    try { setHere(localStorage.getItem(KEY) ?? ''); } catch { /* first visit */ }

    let live = true;
    fetch('/api/place')
      .then((r) => r.json() as Promise<{ here: string }>)
      .then(({ here: h }) => {
        if (!live || !h) return;
        setHere(h);
        try { localStorage.setItem(KEY, h); } catch { /* the label still shows */ }
      })
      .catch(() => { /* the pin keeps whatever it had; it is not the story */ });
    return () => { live = false; };
  }, []);

  return (
    <div className="appbar__aside">
      <span className="appbar__date">{today}</span>
      {/* The one way into the local surface: no sixth tab, but the pin was
          already naming the reader's place, so make it go there. */}
      <Link href="/local" className="pinchip" aria-label={here ? `Local news for ${here}` : 'Local news'}>
        <span className="pinchip__i"><Pin size={12} /></span>
        <span className="pinchip__t">{here || 'Local'}</span>
      </Link>
    </div>
  );
}
