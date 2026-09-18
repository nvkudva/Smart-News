import { useEffect, useRef, useState } from 'react';

/**
 * Arrow and page keys move the reels stack. Scroll-snap pages it for a thumb
 * but leaves a keyboard with nothing but Tab, which walks every save button in
 * the stack before it reaches the bar — twenty stops to get past one screen.
 *
 * A mouse wheel gets the same treatment: one tick is a few pixels, which
 * mandatory snap yanks straight back, so a wheel gesture is read as a single
 * step instead. Desktop also gets previous/next buttons for the same reason.
 *
 * The stack is scrolled rather than focused: focus would fight the snap, and
 * scrollIntoView on the neighbouring section is what the snap points already
 * describe.
 */
export function ReelKeys() {
  const [at, setAt] = useState({ i: 0, n: 0 });
  const busy = useRef(0);
  const goRef = useRef<(to: (from: number, last: number) => number) => boolean>(() => false);

  useEffect(() => {
    const stack = document.querySelector<HTMLElement>('.reels');
    if (!stack) return;
    stack.tabIndex = -1;

    const reels = () => Array.from(stack.querySelectorAll<HTMLElement>('.reel'));

    // Whichever reel owns the middle of the viewport is the one being read.
    const current = (list: HTMLElement[]) => {
      const mid = stack.scrollTop + stack.clientHeight / 2;
      const i = list.findIndex((r) => r.offsetTop + r.offsetHeight > mid);
      return i < 0 ? list.length - 1 : i;
    };

    const go = (to: number | ((from: number, last: number) => number)) => {
      const list = reels();
      if (!list.length) return false;
      const from = current(list);
      const want = typeof to === 'function' ? to(from, list.length - 1) : to;
      const target = list[Math.max(0, Math.min(list.length - 1, want))];
      if (!target || target === list[from]) return false;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
      return true;
    };

    const keys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End']);
    const onKey = (e: KeyboardEvent) => {
      if (!keys.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      // A key aimed at a control inside the stack belongs to that control.
      if (el && el !== document.body && el !== stack && el.closest('button, a, input, textarea')) return;
      e.preventDefault();
      go((from, last) =>
        e.key === 'Home' ? 0
        : e.key === 'End' ? last
        : e.key === 'ArrowUp' || e.key === 'PageUp' ? from - 1
        : from + 1);
    };

    // Pointer-driven wheels only. A trackpad already scrolls the snap well and
    // reports a fine pointer too, so the gate is the event's own shape: a mouse
    // wheel arrives in large, sparse ticks; a trackpad in a dense stream.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      const now = performance.now();
      if (now < busy.current) { e.preventDefault(); return; }
      if (Math.abs(e.deltaY) < 20) return;
      e.preventDefault();
      busy.current = now + 650;
      go((from) => from + (e.deltaY > 0 ? 1 : -1));
    };

    const onScroll = () => {
      const list = reels();
      setAt({ i: current(list), n: list.length });
    };
    onScroll();

    window.addEventListener('keydown', onKey);
    stack.addEventListener('wheel', onWheel, { passive: false });
    stack.addEventListener('scroll', onScroll, { passive: true });
    goRef.current = go;
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.removeEventListener('wheel', onWheel);
      stack.removeEventListener('scroll', onScroll);
    };
  }, []);

  const step = (d: -1 | 1) => goRef.current((from) => from + d);

  return (
    <div className="reelnav" aria-label="Story navigation">
      <button type="button" className="reelnav__btn" onClick={() => step(-1)}
              disabled={at.i <= 0} aria-label="Previous story">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 14.5 7-7 7 7" /></svg>
      </button>
      <button type="button" className="reelnav__btn" onClick={() => step(1)}
              disabled={at.n > 0 && at.i >= at.n - 1} aria-label="Next story">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 9.5 7 7 7-7" /></svg>
      </button>
    </div>
  );
}
