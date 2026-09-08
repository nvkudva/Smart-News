import Link from 'next/link';
import { TAXONOMY } from '@/lib/taxonomy';

/**
 * The top-level rail. TAXONOMY already orders the scope categories ahead of the
 * ten topics, so the reader sees the taxonomy's own order and this never sorts.
 */
export function CategoryStrip({ active }: { active: string }) {
  return (
    <nav className="catstrip" aria-label="Categories">
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
    </nav>
  );
}
