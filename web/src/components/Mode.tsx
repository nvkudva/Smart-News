
import { useCallback, useEffect, useState } from 'react';
import { MODE_KEY, paintChrome, resolveMode, type Mode } from '../lib/boot';

type Stored = Mode | 'auto';

/**
 * Light and dark are a second axis over the four themes, not a fifth theme: a
 * reader picks a palette and, separately, whether it is read off paper or off a
 * lit screen. BOOT resolves the pair before first paint; everything here is for
 * changing it afterwards.
 */
function read(): Stored {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch { return 'auto'; }
}

function apply(stored: Stored) {
  const mode = resolveMode(stored === 'auto' ? null : stored);
  document.documentElement.dataset.mode = mode;
  paintChrome(document.documentElement.dataset.theme ?? 'frost', mode);
  try {
    if (stored === 'auto') localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, stored);
  } catch { /* the mode still applies for this page's lifetime */ }
}

/** Shared so the header toggle and the settings control cannot disagree. */
export function useMode() {
  // BOOT resolved the pair before first paint, so the stored value is what is
  // already on screen; defaulting to 'auto' and correcting in the effect was a
  // hydration workaround with no server render left to protect.
  const [stored, setStored] = useState<Stored>(read);

  useEffect(() => {
    // Following the system means following it as it changes, not only as it was
    // at boot — a phone that dims itself at sunset should take the app with it.
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => { if (read() === 'auto') apply('auto'); };
    mq.addEventListener('change', onSystem);
    // Another tab is the same reader making the same choice.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== MODE_KEY) return;
      const v = read();
      setStored(v);
      apply(v);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onSystem);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const choose = useCallback((v: Stored) => { setStored(v); apply(v); }, []);
  return { stored, choose };
}

function Sun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
    </svg>
  );
}

function Moon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
    </svg>
  );
}

/**
 * The header switch. Two states, not three: a control this small has to be
 * legible at a glance, and 'auto' is not a thing a reader can see the icon for.
 * The three-way choice lives in the settings panel, and picking either side
 * here is a deliberate answer that overrides it.
 */
export function ModeToggle() {
  const { stored, choose } = useMode();

  // Derived, not stored. This was a piece of state, an effect reading
  // document.documentElement.dataset.mode to fill it, and a second setter in
  // the click handler to keep it honest before the effect caught up - three
  // ways to say what resolveMode already answers, and the reason the icon was
  // briefly wrong on first paint. 'auto' has to go through resolveMode because
  // the stored value alone does not say which way it resolved.
  const dark = resolveMode(stored === 'auto' ? null : stored) === 'dark';

  return (
    <button
      type="button"
      className="modetoggle"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      onClick={() => choose(dark ? 'light' : 'dark')}
    >
      {dark ? <Moon /> : <Sun />}
    </button>
  );
}

const OPTIONS: [Stored, string][] = [
  ['auto', 'Automatic'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/** The full three-way choice, for the settings page. */
export function ModeControl() {
  const { stored, choose } = useMode();

  return (
    <div className="panel">
      <div className="label">Appearance</div>
      <p>Every theme reads both ways. Automatic follows the device.</p>
      <div className="chips" role="radiogroup" aria-label="Appearance">
        {OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={stored === value}
            className="chip"
            data-on={stored === value}
            onClick={() => choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
