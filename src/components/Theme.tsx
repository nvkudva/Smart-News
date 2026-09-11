'use client';

import { useEffect, useState } from 'react';
import { paintChrome, resolveMode, MODE_KEY } from '@/lib/boot';

// Repeated rather than imported from lib/boot: the root layout is a server
// component and reads BOOT from there, and pulling the same module into the
// client graph leaves this page's subtree unhydrated.
const KEY = 'sn_theme';

export type Theme = 'frost' | 'pastel' | 'broadsheet' | 'ambient' | 'fjord';

const OPTIONS: [Theme, string, string][] = [
  ['frost', 'Frosted', 'White glass over a soft wash. The default.'],
  ['pastel', 'Pastel', 'The same glass, each card tinted by its category.'],
  ['broadsheet', 'Broadsheet', 'Paper, serif headlines and hairlines instead of cards.'],
  ['ambient', 'Ambient', 'Dark and warm — an ember palette, calm at night.'],
  ['fjord', 'Fjordlight', 'Cold daylight. Flat surfaces, one petrol accent, serif headlines.'],
];

export function ThemeControl() {
  // 'frost' on the server and on the first client render alike: localStorage is
  // unreadable during SSR, and rendering the stored value straight away would
  // mismatch the markup React is hydrating against.
  const [theme, setTheme] = useState<Theme>('frost');

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY) as Theme | null;
      if (v && OPTIONS.some(([o]) => o === v)) setTheme(v);
    } catch { /* storage blocked — the default is the right answer anyway */ }
  }, []);

  function choose(v: Theme) {
    setTheme(v);
    if (v === 'frost') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
    let stored: string | null = null;
    try { stored = localStorage.getItem(MODE_KEY); } catch { /* auto is fine */ }
    paintChrome(v, resolveMode(stored));
    try {
      if (v === 'frost') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, v);
    } catch { /* the theme still applies for this page's lifetime */ }
  }

  return (
    <div className="panel">
      <div className="label">Theme</div>
      <p>{OPTIONS.find(([v]) => v === theme)?.[2]}</p>
      {/* Five options where the other tracks have three: it is given the room
          five need, and below 420px it becomes two rows rather than wrapping
          one option onto a line of its own. */}
      <div className="chips" data-track="theme" role="radiogroup" aria-label="Theme">
        {OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            className="chip"
            data-on={theme === value}
            onClick={() => choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
