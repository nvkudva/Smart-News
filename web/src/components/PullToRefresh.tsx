import { useEffect, useRef, useState } from 'react';
import { refresh } from '../lib/world';

const TRIGGER = 70;

/**
 * The document does not scroll (#root does, so the fixed bars stay put), and
 * the browser's own pull-to-refresh only fires on document scroll - nor at all
 * in an installed app. So the gesture is ours, and it re-checks the world
 * rather than reloading the page.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    let startY: number | null = null;
    const set = (v: number) => { pullRef.current = v; setPull(v); };

    const onStart = (e: TouchEvent) => { startY = root.scrollTop <= 0 ? e.touches[0].clientY : null; };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0 || root.scrollTop > 0) { set(0); return; }
      set(Math.min(d * 0.5, TRIGGER * 1.4));
    };
    const onEnd = () => {
      if (pullRef.current >= TRIGGER) refresh();
      startY = null; set(0);
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: true });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  if (!pull) return null;
  return (
    <div className="ptr" aria-hidden style={{ transform: `translate(-50%, ${pull}px) rotate(${pull * 4}deg)`,
                                             opacity: Math.min(pull / TRIGGER, 1) }}>
      ↻
    </div>
  );
}
