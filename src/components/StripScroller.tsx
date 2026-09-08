'use client';

import { useEffect, useRef } from 'react';

/**
 * Module scope on purpose: it survives a client navigation and resets on a hard
 * load. A fresh page should already be in position, but moving between
 * categories should look like the row sliding under a fixed highlight.
 */
let navigated = false;

/**
 * Keeps the selected item pinned to the left edge of a horizontal strip, the
 * way Particle's category rail behaves: what you are reading sits first, and
 * everything further down the taxonomy runs off to the right.
 *
 * The links stay server-rendered children; only the scrolling is client work.
 * activeKey — not a route hook — drives the effect, so neither strip drags a
 * useSearchParams bailout into the pages that render it.
 */
export function StripScroller(
  { className, label, activeKey, children }:
  { className: string; label: string; activeKey: string; children: React.ReactNode },
) {
  const ref = useRef<HTMLElement>(null);
  // What we last added to the row, so its natural width stays derivable without
  // zeroing the padding and re-measuring mid-animation.
  const slack = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const row = el.firstElementChild as HTMLElement | null;
    if (!row) return;

    // data-edge drives the fades. A strip that fades on a side the reader has
    // already reached the end of is claiming there is more when there is not.
    const markEdges = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft < el.scrollWidth - el.clientWidth - 2;
      el.dataset.edge = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
    };

    // Measurements drift by a pixel or two while the strip settles, and every
    // re-issued scrollTo restarts the animation from wherever it had got to —
    // a smooth scroll that never arrives. Once aimed, stay aimed.
    let aim: number | null = null;

    const pin = () => {
      const on = el.querySelector<HTMLElement>('[data-active="true"]');
      if (!on) return;

      // The row is the scroller's only child and is positioned, so offsetLeft is
      // already the scrollLeft that puts this item against the content edge.
      const left = on.offsetLeft;
      if (aim !== null && Math.abs(left - aim) < 12) return markEdges();
      aim = left;

      const style = getComputedStyle(el);
      const padX = (parseFloat(style.paddingInlineStart) || 0)
                 + (parseFloat(style.paddingInlineEnd) || 0);

      // The last few items have nothing behind them to scroll against and would
      // stall mid-row. Give the row exactly the slack they are short of.
      const natural = row.offsetWidth - slack.current;
      const want = Math.max(0, Math.ceil(left + el.clientWidth - (natural + padX)));
      if (want !== slack.current) {
        slack.current = want;
        row.style.paddingInlineEnd = `${want}px`;
        void el.scrollWidth; // flush the new extent before scrolling into it
      }

      el.scrollTo({ left, behavior: navigated ? 'smooth' : 'auto' });
      navigated = true;
      markEdges();
    };

    pin();

    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return; // our own padding, not a resize
      width = el.clientWidth;
      aim = null;
      pin();
    });
    ro.observe(el);
    el.addEventListener('scroll', markEdges, { passive: true });


    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', markEdges);
    };
  }, [activeKey]);

  return (
    <nav ref={ref} className={className} aria-label={label} data-edge="none">
      {children}
    </nav>
  );
}
