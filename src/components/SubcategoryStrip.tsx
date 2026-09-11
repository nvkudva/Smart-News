'use client';

import Link from 'next/link';
import type { SubCount } from '@/lib/taxonomy';
import { StripScroller } from './StripScroller';

/**
 * Renders nothing when the non-empty gate left no subs: an "All" pill on its own
 * is a control with one destination, which is noise rather than navigation. The
 * caller has already dropped the zero-count subs; this never re-filters.
 */
export function SubcategoryStrip(
  { cat, label, base, subs, active }:
  { cat: string; label: string; base: string; subs: SubCount[]; active: string | null },
) {
  if (subs.length === 0) return null;
  const all = active === null;

  /**
   * The sub lives in the URL so it can be shared and restored, but changing it
   * is not a navigation: the rows are already here and SectionFeed filters them
   * in place. A <Link> would still fetch the route's RSC payload for the new
   * query string — one request to learn nothing — so the URL is rewritten with
   * history.pushState, which useSearchParams picks up all the same.
   *
   * The href stays real: a middle-click, a copied link and a crawler all still
   * get a page, and this only intercepts the plain left click it can satisfy.
   */
  const swap = (href: string) => (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    window.history.pushState(null, '', href);
  };

  return (
    <StripScroller className="substrip" data-cat={cat} label={`${label} sub-categories`}
                   activeKey={active ?? 'all'}>
      <div className="substrip__row">
        <Link href={base} className="subpill" data-active={all} onClick={swap(base)}
              aria-current={all ? 'page' : undefined}>All</Link>
        {subs.map((s) => {
          const on = s.slug === active;
          const href = `${base}?sub=${encodeURIComponent(s.slug)}`;
          return (
            <Link key={s.slug} href={href} className="subpill" data-active={on}
                  onClick={swap(href)}
                  aria-current={on ? 'page' : undefined}>{s.name}</Link>
          );
        })}
      </div>
    </StripScroller>
  );
}
