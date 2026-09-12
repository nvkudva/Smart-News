/**
 * The DOM half of boot.
 *
 * The keys, the theme list and the BOOT snippet itself live in shared/boot.ts:
 * vite.config.ts injects BOOT into index.html, and the config is type-checked
 * under tsconfig.node.json, which has no DOM lib - importing this file from
 * there pulled `document` and `matchMedia` into a compilation that cannot see
 * them.
 *
 * Re-exported so the components keep importing every boot symbol from one
 * place, as they did when this file held all of them.
 */
export {
  NAV_KEY, HIDDEN_KEY, THEME_KEY, MODE_KEY, THEME_CHROME, BOOT,
} from '../../shared/boot';

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
