'use client';

import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const pin = () => {
      const on = el.querySelector<HTMLElement>('[data-active="true"]');
      const row = el.firstElementChild as HTMLElement | null;
      if (!on || !row) return;

      row.style.paddingInlineEnd = '0px';

      // offsetLeft answers to the nearest positioned ancestor, which the strip
      // is not; measuring both rects against the live scroll offset does not.
      const pad = parseFloat(getComputedStyle(el).paddingInlineStart) || 0;
      const left = el.scrollLeft + on.getBoundingClientRect().left
                 - el.getBoundingClientRect().left - pad;

      // The last few items have nothing behind them to scroll against, so they
      // would stall mid-row. Give the row exactly the slack they are short of.
      const short = left - (el.scrollWidth - el.clientWidth);
      if (short > 0) {
        row.style.paddingInlineEnd = `${Math.ceil(short)}px`;
        void el.scrollWidth; // flush the new extent before scrolling into it
      }

      el.scrollLeft = left;
    };

    pin();
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeKey]);

  return (
    <nav ref={ref} className={className} aria-label={label}>
      {children}
    </nav>
  );
}
