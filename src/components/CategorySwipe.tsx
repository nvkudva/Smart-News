'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { setSlide } from '@/lib/slide';

const href = (slug: string) => (slug === 'top' ? '/' : `/c/${slug}`);

/**
 * Swipe the feed sideways to move along the strip, in the strip's own order.
 *
 * Deliberately touch-only. A trackpad's horizontal scroll is continuous and
 * arrives as wheel events that the strip itself wants, so binding this to the
 * pointer would make a desktop reader change section while trying to nudge the
 * category row.
 *
 * The order arrives as a prop rather than from the taxonomy directly: that
 * module reaches node:sqlite through the category list, and importing it here
 * drags the whole store into the browser bundle.
 */
export function CategorySwipe({ active, order }: { active: string; order: string[] }) {
  const router = useRouter();

  // The array arrives new on every render, and depending on its identity tore
  // the listeners down and rebuilt them mid-gesture — which lost the touch that
  // had already started. A string is stable enough to compare.
  const key = order.join('|');

  useEffect(() => {
    const slugs = key.split('|');
    const at = slugs.indexOf(active);
    if (at < 0) return;

    let x = 0, y = 0, t = 0, live = false;

    const start = (e: TouchEvent) => {
      // One finger only: two is a pinch, and a gesture that begins inside a
      // horizontal scroller belongs to that scroller.
      if (e.touches.length !== 1) { live = false; return; }
      const el = e.target as Element | null;
      if (el?.closest?.('.catstrip, .substrip, .reel, [data-noswipe]')) { live = false; return; }
      const p = e.touches[0];
      x = p.clientX; y = p.clientY; t = Date.now(); live = true;
    };

    const end = (e: TouchEvent) => {
      if (!live) return;
      live = false;
      const p = e.changedTouches[0];
      if (!p) return;
      const dx = p.clientX - x;
      const dy = p.clientY - y;
      // Sideways, decisive, and not a slow drag: 1.6x is enough to let a
      // diagonal flick down the page stay a scroll.
      if (Date.now() - t > 700) return;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;

      const next = slugs[at + (dx < 0 ? 1 : -1)];
      if (!next) return;
      setSlide(dx < 0 ? 'next' : 'prev');
      router.push(href(next));
    };

    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchend', end);
    };
  }, [active, key, router]);

  return null;
}
