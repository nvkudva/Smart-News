/**
 * The DOM half of boot.
 *
 * The keys, the theme list and the BOOT snippet itself live in shared/boot.ts:
 * vite.config.ts injects BOOT into index.html, and the config is type-checked
 * under tsconfig.node.json, which has no DOM lib - importing this file from
 * there pulled `document` and `matchMedia` into a compilation that cannot see
 * them.
 *
 * The keys are re-exported because the controls and the BOOT snippet have to
 * agree about them: Theme and NavPlacement each declared their own 'sn_theme'
 * and 'sn_nav' literals, which is two sources for one fact.
 */
export { NAV_KEY, HIDDEN_KEY, THEME_KEY, MODE_KEY } from '../../shared/boot';

import { THEME_CHROME } from '../../shared/boot';

/** 'light' | 'dark' | null, where null means follow the system. */
export type Mode = 'light' | 'dark';

export function resolveMode(stored: string | null): Mode {
  if (stored === 'light' || stored === 'dark') return stored;
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function paintChrome(theme: string, mode: Mode) {
  const c = THEME_CHROME[mode === 'dark' ? `${theme}-dark` : theme] ?? THEME_CHROME.frost;
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) {
    m = document.createElement('meta');
    m.setAttribute('name', 'theme-color');
    document.head.appendChild(m);
  }
  m.setAttribute('content', c);
}
