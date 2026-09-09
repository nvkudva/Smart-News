'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { setSlide } from '@/lib/slide';

const href = (slug: string) => (slug === 'top' ? '/' : `/c/${slug}`);

/** Past this fraction of the viewport the release commits rather than snaps back. */
const COMMIT = 0.28;
/** …unless the finger was moving fast enough that distance stops mattering. */
const FLICK_PX_PER_MS = 0.45;
/** Pull at a dead end still moves, but a third as far, so the edge is felt. */
const RUBBER = 3;

/**
 * Swipe the feed sideways to move along the strip, in the strip's own order.
 *
 * The content tracks the finger for the whole gesture and either completes or
 * springs back on release — a swipe that only decided at lift-off read as a
 * button with a strange hit area rather than as a page you are holding.
 *
 * The category strip is deliberately not among the elements that move: it is
 * the page's title bar, and it stays fixed while the feed under it travels.
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

    // Everything inside the shell except the title strip. Collected per gesture
    // rather than held: the feed remounts under us on every navigation.
    const surfaces = () => {
      const shell = document.querySelector('.shell');
      if (!shell) return [];
      return Array.from(shell.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains('catstrip'),
      );
    };

    // A page that arrived mid-flight can still be wearing the last gesture's
    // inline transform, so the new one starts by clearing it.
    for (const el of surfaces()) { el.style.transition = ''; el.style.transform = ''; }

    // The enter animation is declared animation-fill-mode: both, and a CSS
    // animation outranks an inline style for as long as data-slide is set.
    // Dropping it is what lets the next drag paint at all.
    const unpin = () => { delete document.documentElement.dataset.slide; };

    let x = 0, y = 0, t = 0;
    let mode: 'off' | 'watching' | 'dragging' = 'off';
    let moved: HTMLElement[] = [];
    let width = 1;

    const paint = (dx: number) => {
      const s = dx ? `translate3d(${dx}px,0,0)` : '';
      for (const el of moved) el.style.transform = s;
    };

    const settle = () => {
      for (const el of moved) {
        el.style.transition = 'transform .3s cubic-bezier(.22,.7,.25,1)';
        el.style.transform = '';
        el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
      }
    };

    const start = (e: TouchEvent) => {
      // One finger only: two is a pinch, and a gesture that begins inside a
      // horizontal scroller belongs to that scroller.
      if (e.touches.length !== 1) { mode = 'off'; return; }
      const el = e.target as Element | null;
      if (el?.closest?.('.catstrip, .substrip, .reel, [data-noswipe]')) { mode = 'off'; return; }
      const p = e.touches[0];
      x = p.clientX; y = p.clientY; t = Date.now();
      mode = 'watching';
      moved = [];
      width = window.innerWidth || 1;
    };

    const move = (e: TouchEvent) => {
      if (mode === 'off' || e.touches.length !== 1) return;
      const p = e.touches[0];
      const dx = p.clientX - x;
      const dy = p.clientY - y;

      if (mode === 'watching') {
        // Wait until the gesture has declared itself. Down the page wins ties,
        // so reading never fights the swipe.
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) { mode = 'off'; return; }
        mode = 'dragging';
        unpin();
        moved = surfaces();
        for (const el of moved) el.style.transition = '';
      }

      // Past the first or last category there is nowhere to go, so the pull is
      // damped instead of refused: the strip's end is something you can feel.
      const blocked = !slugs[at + (dx < 0 ? 1 : -1)];
      paint(blocked ? dx / RUBBER : dx);
      // Once we own the gesture the page must not also scroll under it.
      if (e.cancelable) e.preventDefault();
    };

    const end = (e: TouchEvent) => {
      if (mode !== 'dragging') { mode = 'off'; return; }
      mode = 'off';
      const p = e.changedTouches[0];
      if (!p) { settle(); return; }

      const dx = p.clientX - x;
      const next = slugs[at + (dx < 0 ? 1 : -1)];
      const speed = Math.abs(dx) / Math.max(1, Date.now() - t);
      const commit = next && (Math.abs(dx) > width * COMMIT || speed > FLICK_PX_PER_MS);

      if (!commit) { settle(); return; }

      // Hand straight over to the CSS enter animation: leaving the outgoing
      // content parked at the finger's offset would freeze it there for as long
      // as the navigation takes, and it is about to be replaced anyway.
      paint(0);
      setSlide(dx < 0 ? 'next' : 'prev');
      router.push(href(next));
    };

    const cancel = () => { if (mode === 'dragging') settle(); mode = 'off'; };

    // Capture phase: a swipe has to be recognised before any card, scroller or
    // link in the tree gets a say, and touchmove must be non-passive or the
    // preventDefault that stops the page scrolling under the drag is ignored.
    const opts = { passive: false, capture: true } as const;
    window.addEventListener('touchstart', start, { passive: true, capture: true });
    window.addEventListener('touchmove', move, opts);
    window.addEventListener('touchend', end, { passive: true, capture: true });
    window.addEventListener('touchcancel', cancel, { passive: true, capture: true });
    return () => {
      window.removeEventListener('touchstart', start, true);
      window.removeEventListener('touchmove', move, true);
      window.removeEventListener('touchend', end, true);
      window.removeEventListener('touchcancel', cancel, true);
      paint(0);
    };
  }, [active, key, router]);

  return null;
}
