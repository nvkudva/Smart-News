import Link from 'next/link';
import { TAXONOMY } from '@/lib/taxonomy';
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
            <Link key={c.slug} href={c.slug === 'top' ? '/' : `/c/${c.slug}`}
                  className="catlink" data-active={on}
                  aria-current={on ? 'page' : undefined}>{c.name}</Link>
          );
        })}
      </div>
    </StripScroller>
  );
}
