
import { useState } from 'react';
import { NAV_KEY } from '../lib/boot';

export type Placement = 'auto' | 'bottom' | 'side';

const OPTIONS: [Placement, string][] = [
  ['auto', 'Automatic'],
  ['bottom', 'Bottom bar'],
  ['side', 'Side rail'],
];

function applyPlacement(v: Placement) {
  if (v === 'auto') delete document.documentElement.dataset.nav;
  else document.documentElement.dataset.nav = v;
}

function read(): Placement {
  try {
    const v = localStorage.getItem(NAV_KEY);
    if (v === 'bottom' || v === 'side') return v;
  } catch { /* storage blocked — 'auto' is the right answer anyway */ }
  return 'auto';
}

export function NavPlacementControl() {
  // BOOT applied the stored placement before first paint; see ThemeControl.
  const [placement, setPlacement] = useState<Placement>(read);

  function choose(v: Placement) {
    setPlacement(v);
    applyPlacement(v);
    try {
      if (v === 'auto') localStorage.removeItem(NAV_KEY);
      else localStorage.setItem(NAV_KEY, v);
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
