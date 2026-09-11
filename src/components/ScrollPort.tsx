'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The document itself does not scroll: the header and the dock are fixed, and a
 * scrolling document lets a phone browser collapse and re-expand its own
 * toolbar under them, which moves both bars and closes the gap below the dock.
 * Scrolling one element inside a viewport-sized box keeps the toolbar out of it.
 *
 * The cost is that Next's own scroll reset targets the window, so a route change
 * would otherwise land on the previous page's offset. Hence the effect.
 */
export function ScrollPort({ children }: { children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const path = usePathname();

  useEffect(() => { el.current?.scrollTo({ top: 0 }); }, [path]);

  return <div className="scrollport" ref={el}>{children}</div>;
}
