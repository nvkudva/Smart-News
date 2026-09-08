/**
 * Which way the next category is, so the page that arrives can animate as if it
 * came from there. Set on <html> just before the navigation and cleared once
 * the animation has had time to play; CSS reads it, nothing else does.
 *
 * A module, not a hook, because both the swipe and a tap on the strip have to
 * agree — a tap that slid the other way from a swipe to the same place would
 * read as two different gestures.
 */
export type Slide = 'next' | 'prev';

let clear: ReturnType<typeof setTimeout> | undefined;

export function setSlide(dir: Slide) {
  document.documentElement.dataset.slide = dir;
  clearTimeout(clear);
  clear = setTimeout(() => { delete document.documentElement.dataset.slide; }, 600);
}

/** Direction from one slug to another, or null when they are the same. */
export function slideBetween(order: string[], from: string, to: string): Slide | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return null;
  return b > a ? 'next' : 'prev';
}
