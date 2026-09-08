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

export const BOOT =
  `try{var d=document.documentElement,n=localStorage.getItem('${NAV_KEY}');` +
  `if(n==='bottom'||n==='side')d.dataset.nav=n;` +
  `var t=localStorage.getItem('${THEME_KEY}');` +
  `if(t&&t!=='frost')d.dataset.theme=t}catch(e){}`;
