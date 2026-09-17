
import { Link } from '@tanstack/react-router';
import type { SubCount } from '../../shared/taxonomy';
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
   * Plain router Links, and the sub arrives as `search` rather than as a query
   * string glued onto the path.
   *
   * These used to call history.pushState from an onClick that preventDefaulted
   * the Link, to avoid the RSC payload a Next <Link> fetched for a query string
   * that changed nothing. That reasoning left with Next, and what remained was
   * a bug: pushState writes the address bar without telling the router, so the
   * useSearch() in SectionFeed never saw the new sub. `active` stayed null, so
   * All stayed lit however many times you picked something else, and the rows
   * never filtered.
   *
   * Nothing is fetched now either, and for a better reason than interception:
   * ?sub= is declared in validateSearch and the route's loader does not depend
   * on it, so changing it re-renders and does not re-load.
   */
  return (
    <StripScroller className="substrip" data-cat={cat} label={`${label} sub-categories`}
                   activeKey={active ?? 'all'}>
      <div className="substrip__row">
        <Link to={base} search={{}} preload={false} className="subpill" data-active={all}
              aria-current={all ? 'page' : undefined}>All</Link>
        {subs.map((s) => {
          const on = s.slug === active;
          return (
            <Link key={s.slug} to={base} search={{ sub: s.slug }} preload={false}
                  className="subpill" data-active={on}
                  aria-current={on ? 'page' : undefined}>{s.name}</Link>
          );
        })}
      </div>
    </StripScroller>
  );
}
