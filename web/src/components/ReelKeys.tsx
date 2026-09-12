
import { useEffect } from 'react';

/**
 * Arrow and page keys move the reels stack. Scroll-snap pages it for a thumb
 * but leaves a keyboard with nothing but Tab, which walks every save button in
 * the stack before it reaches the bar — twenty stops to get past one screen.
 *
 * The stack is scrolled rather than focused: focus would fight the snap, and
 * scrollIntoView on the neighbouring section is what the snap points already
 * describe.
 */
export function ReelKeys() {
  useEffect(() => {
    const stack = document.querySelector<HTMLElement>('.reels');
    if (!stack) return;
    stack.tabIndex = -1;

    const keys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End']);

    const onKey = (e: KeyboardEvent) => {
      if (!keys.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      // A key aimed at a control inside the stack belongs to that control.
      if (el && el !== document.body && el !== stack && el.closest('button, a, input, textarea')) return;

      const reels = Array.from(stack.querySelectorAll<HTMLElement>('.reel'));
      if (!reels.length) return;

      // Whichever reel owns the middle of the viewport is the one being read.
      const mid = stack.scrollTop + stack.clientHeight / 2;
      const at = reels.findIndex((r) => r.offsetTop + r.offsetHeight > mid);
      const from = at < 0 ? reels.length - 1 : at;

      const to =
        e.key === 'Home' ? 0
        : e.key === 'End' ? reels.length - 1
        : e.key === 'ArrowUp' || e.key === 'PageUp' ? from - 1
        : from + 1;

      const target = reels[Math.max(0, Math.min(reels.length - 1, to))];
      if (!target) return;
      e.preventDefault();
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
