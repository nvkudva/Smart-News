import Link from 'next/link';
import type { SubCount } from '@/lib/taxonomy';
import { StripScroller } from './StripScroller';

/**
 * Renders nothing when the non-empty gate left no subs: an "All" pill on its own
 * is a control with one destination, which is noise rather than navigation. The
 * caller has already dropped the zero-count subs; this never re-filters.
 */
export function SubcategoryStrip(
  { label, base, subs, active }:
  { label: string; base: string; subs: SubCount[]; active: string | null },
) {
  if (subs.length === 0) return null;
  const all = active === null;

  return (
    <StripScroller className="substrip" label={`${label} sub-categories`}
                   activeKey={active ?? 'all'}>
      <div className="substrip__row">
        <Link href={base} className="subpill" data-active={all}
              aria-current={all ? 'page' : undefined}>All</Link>
        {subs.map((s) => {
          const on = s.slug === active;
          return (
            <Link key={s.slug} href={`${base}?sub=${encodeURIComponent(s.slug)}`}
                  className="subpill" data-active={on}
                  aria-current={on ? 'page' : undefined}>{s.name}</Link>
          );
        })}
      </div>
    </StripScroller>
  );
}
