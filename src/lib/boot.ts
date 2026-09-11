/**
 * Deliberately not a 'use client' module. A string exported from one is a
 * client reference by the time a server component reads it, so the layout was
 * inlining a stub that throws rather than the snippet — which is why the nav
 * placement never applied before the first paint.
 *
 * Runs from <head>: both values have to be on <html> by the time the first
 * frame is composed, or every load shows the default and then jumps to the
 * reader's choice. Keeping them out of the database is the point — they apply
 * with no server round trip, and a phone and a laptop can disagree.
 */
export const NAV_KEY = 'sn_nav';
export const THEME_KEY = 'sn_theme';
export const MODE_KEY = 'sn_mode';

/**
 * Each theme's ground, as the browser and standalone chrome need it. Not
 * derivable from the stylesheet here — this runs before any CSS has loaded —
 * so the values are repeated, and `viewport.themeColor` is deliberately
 * absent from the layout: two sources would race and the loser wins at random.
 */
export const THEME_CHROME: Record<string, string> = {
  frost: '#f7f7fa',
  pastel: '#f8f8fa',
  broadsheet: '#f9f6f0',
  ambient: '#fdf8ef',
  fjord: '#e9efef',
  'frost-dark': '#15171c',
  'pastel-dark': '#16161f',
  'broadsheet-dark': '#141310',
  'ambient-dark': '#1a120d',
  'fjord-dark': '#0d1618',
};

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

/**
 * The mode is resolved to a literal 'light' or 'dark' here rather than left to
 * a media query in the stylesheet. Four themes times two modes would otherwise
 * need every dark token set written twice — once under [data-mode="dark"] and
 * again under the auto case's @media — and the two copies would drift.
 */
export const BOOT =
  `try{var d=document.documentElement,n=localStorage.getItem('${NAV_KEY}');` +
  `if(n==='bottom'||n==='side')d.dataset.nav=n;` +
  `var t=localStorage.getItem('${THEME_KEY}')||'frost';` +
  `if(t!=='frost')d.dataset.theme=t;` +
  `var s=localStorage.getItem('${MODE_KEY}');` +
  `var k=(s==='light'||s==='dark')?s:` +
  `(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');` +
  `d.dataset.mode=k;` +
  `var c=${JSON.stringify(THEME_CHROME)}[k==='dark'?t+'-dark':t]||'#f7f7fa';` +
  `var m=document.createElement('meta');m.name='theme-color';m.content=c;` +
  `document.head.appendChild(m)}catch(e){}`;
