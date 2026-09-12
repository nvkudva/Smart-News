import { Link } from '@tanstack/react-router';
import { TAXONOMY } from '../../shared/taxonomy';
import { StripScroller } from './StripScroller';

/**
 * The top-level rail, and the page's title in one: the selected category is
 * rendered at heading size and held at the left edge, the rest trail off to
 * the right. TAXONOMY already orders the scope categories ahead of the ten
 * topics, so the reader sees the taxonomy's own order and this never sorts.
 */
export function CategoryStrip({ active }: { active: string }) {
  return (
    <StripScroller className="catstrip" label="Categories" activeKey={active}>
      <div className="catstrip__row">
        {TAXONOMY.map((c) => {
          const on = c.slug === active;
          return (
            // preload={false}: a static route's auto-prefetch pulls the whole
            // RSC payload and re-pulls it every time the link re-enters the
            // viewport, which in a strip that scrolls itself on every
            // navigation is continuous. Fourteen of them ran the account into
            // its daily Worker limit. StripScroller warms on intent instead.
            // to/params rather than an interpolated path: the router types
            // `to` against the route tree, and /c/$cat takes its slug as a
            // param it encodes itself.
            c.slug === 'top' ? (
              <Link key={c.slug} to="/" preload={false}
                    className="catlink" data-cat={c.slug} data-active={on}
                    aria-current={on ? 'page' : undefined}>{c.name}</Link>
            ) : (
              <Link key={c.slug} to="/c/$cat" params={{ cat: c.slug }} preload={false}
                    className="catlink" data-cat={c.slug} data-active={on}
                    aria-current={on ? 'page' : undefined}>{c.name}</Link>
            )
          );
        })}
      </div>
    </StripScroller>
  );
}
