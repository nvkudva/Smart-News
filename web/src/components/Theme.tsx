
import { useState } from 'react';
import { paintChrome, resolveMode, MODE_KEY, THEME_KEY } from '../lib/boot';

export type Theme = 'frost' | 'pastel' | 'broadsheet' | 'fjord';

const OPTIONS: [Theme, string, string][] = [
  ['frost', 'Frosted', 'White glass over a soft wash. The default.'],
  ['pastel', 'Pastel', 'The same glass, each card tinted by its category.'],
  ['broadsheet', 'Broadsheet', 'Paper, serif headlines and hairlines instead of cards.'],
  ['fjord', 'Northlight', 'Cold daylight. Flat surfaces, one petrol accent, serif headlines.'],
];

function read(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY) as Theme | null;
    if (v && OPTIONS.some(([o]) => o === v)) return v;
  } catch { /* storage blocked — the default is the right answer anyway */ }
  return 'frost';
}

export function ThemeControl() {
  // BOOT applied the stored theme to <html> before first paint, so reading it
  // here agrees with what is already on screen. Defaulting and then correcting
  // in an effect was a hydration workaround; there is no server render left to
  // mismatch, and it showed the reader 'frost' selected for one frame.
  const [theme, setTheme] = useState<Theme>(read);

  function choose(v: Theme) {
    setTheme(v);
    if (v === 'frost') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
    let stored: string | null = null;
    try { stored = localStorage.getItem(MODE_KEY); } catch { /* auto is fine */ }
    paintChrome(v, resolveMode(stored));
    try {
      if (v === 'frost') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, v);
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
