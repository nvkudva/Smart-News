/**
 * What has to be true before the first frame.
 *
 * Nav placement, theme and mode are read from localStorage and stamped onto
 * <html> by the BOOT snippet at the bottom of this file, which vite.config.ts
 * injects at the top of <head>. Anything later - a component effect, a module
 * import - shows the default first and then jumps.
 *
 * Kept out of the database deliberately: these apply with no round trip, and a
 * phone and a laptop are allowed to disagree about them.
 *
 * Environment-free on purpose. The snippet is a string, the keys are strings
 * and the theme list is data, so this compiles for the client, the Worker and
 * the Vite config alike. The DOM helpers that use these live in
 * src/lib/boot.ts.
 */
export const NAV_KEY = 'sn_nav';
/**
 * Categories the reader switched off, mirrored out of prefs so the strip can
 * honour them.
 *
 * The rail is part of fifteen prerendered shells — that is what makes a
 * category switch cost no invocation — so the server that builds it cannot
 * know who is reading. Written here on save and applied before first paint,
 * the same bargain theme, mode and nav placement already take. Prefs remain
 * the record; this is a copy the shell can read.
 */
export const HIDDEN_KEY = 'sn_hidden';
export const THEME_KEY = 'sn_theme';
export const MODE_KEY = 'sn_mode';

/**
 * Each theme's ground, as the browser and standalone chrome need it. Not
 * derivable from the stylesheet here — this runs before any CSS has loaded —
 * so the values are repeated. The layout declares one static theme-color so the
 * status bar of an installed app has a value at parse time; this overwrites that
 * one tag rather than appending a second, which the browser would ignore.
 */
export const THEME_CHROME: Record<string, string> = {
  frost: '#f7f7fa',
  pastel: '#f8f8fa',
  broadsheet: '#f9f6f0',
  fjord: '#e9efef',
  'frost-dark': '#15171c',
  'pastel-dark': '#16161f',
  'broadsheet-dark': '#141310',
  'fjord-dark': '#0d1618',
};

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
  // A theme that has since been removed would otherwise be stamped onto <html>
  // with no stylesheet behind it. Checked against the one list that knows.
  `if(!${JSON.stringify(THEME_CHROME)}[t])t='frost';` +
  `if(t!=='frost')d.dataset.theme=t;` +
  `var s=localStorage.getItem('${MODE_KEY}');` +
  `var k=(s==='light'||s==='dark')?s:` +
  `(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');` +
  `d.dataset.mode=k;` +
  `var h=localStorage.getItem('${HIDDEN_KEY}');if(h)d.dataset.hidden=h;` +
  `var c=${JSON.stringify(THEME_CHROME)}[k==='dark'?t+'-dark':t]||'#f7f7fa';` +
  `var m=document.querySelector('meta[name="theme-color"]');` +
  `if(!m){m=document.createElement('meta');m.name='theme-color';` +
  `document.head.appendChild(m)}m.content=c}catch(e){}`;
