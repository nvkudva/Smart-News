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

/**
 * Each theme's ground, as the browser and standalone chrome need it. Not
 * derivable from the stylesheet here — this runs before any CSS has loaded —
 * so the four values are repeated, and `viewport.themeColor` is deliberately
 * absent from the layout: two sources would race and the loser wins at random.
 */
export const THEME_CHROME: Record<string, string> = {
  frost: '#f7f7fa',
  pastel: '#f8f8fa',
  broadsheet: '#f9f6f0',
  ambient: '#1a120d',
};

export function paintChrome(theme: string) {
  const c = THEME_CHROME[theme] ?? THEME_CHROME.frost;
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) {
    m = document.createElement('meta');
    m.setAttribute('name', 'theme-color');
    document.head.appendChild(m);
  }
  m.setAttribute('content', c);
}

export const BOOT =
  `try{var d=document.documentElement,n=localStorage.getItem('${NAV_KEY}');` +
  `if(n==='bottom'||n==='side')d.dataset.nav=n;` +
  `var t=localStorage.getItem('${THEME_KEY}');` +
  `if(t&&t!=='frost')d.dataset.theme=t;` +
  `var c=${JSON.stringify(THEME_CHROME)}[t||'frost']||'#f7f7fa';` +
  `var m=document.createElement('meta');m.name='theme-color';m.content=c;` +
  `document.head.appendChild(m)}catch(e){}`;
