'use client';

import { useEffect, useState } from 'react';

export type Placement = 'auto' | 'bottom' | 'side';

const KEY = 'sn_nav';

const OPTIONS: [Placement, string][] = [
  ['auto', 'Automatic'],
  ['bottom', 'Bottom bar'],
  ['side', 'Side rail'],
];

/**
 * Runs from <head>, before the first paint. The stored placement has to be on
 * <html> by the time the first frame is composed, or every load shows the media
 * query's answer and then jumps to the reader's — and the whole point of keeping
 * this out of the database is that it applies with no server round trip.
 */
export const NAV_BOOT =
  `try{var v=localStorage.getItem('${KEY}');` +
  `if(v==='bottom'||v==='side')document.documentElement.dataset.nav=v}catch(e){}`;

function applyPlacement(v: Placement) {
  if (v === 'auto') delete document.documentElement.dataset.nav;
  else document.documentElement.dataset.nav = v;
}

export function NavPlacementControl() {
  // 'auto' on the server and on the first client render alike: localStorage is
  // unreadable during SSR, and rendering the stored value straight away would
  // mismatch the markup React is hydrating against.
  const [placement, setPlacement] = useState<Placement>('auto');

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'bottom' || v === 'side') setPlacement(v);
    } catch { /* storage blocked — 'auto' is the right answer anyway */ }
  }, []);

  function choose(v: Placement) {
    setPlacement(v);
    applyPlacement(v);
    try {
      if (v === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, v);
    } catch { /* the placement still applies for this page's lifetime */ }
  }

  return (
    <div className="panel">
      <div className="label">Navigation</div>
      <p>Where the bar sits. Automatic puts it at the bottom on a narrow screen
         and down the left side on a wide one.</p>
      <div className="chips" role="radiogroup" aria-label="Navigation placement">
        {OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={placement === value}
            className="chip"
            data-on={placement === value}
            onClick={() => choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
        This device only — your phone and your laptop each keep their own.
      </p>
    </div>
  );
}
