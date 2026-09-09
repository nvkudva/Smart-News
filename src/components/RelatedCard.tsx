import Link from 'next/link';
import { ago } from './StoryCard';

/** What the related query actually selects — four columns, not a whole Story. */
export type RelatedRow = { id: string; headline: string; source_count: number; last_seen: number };

/**
 * `.card--compact` with the halves it can fill. The related query reads four
 * columns off neighbouring clusters and carries neither crux nor image, so the
 * thumbnail and summary row are absent rather than faked; widening the query to
 * feed a 76px square would cost a second full read of every sibling cluster.
 */
export function RelatedCard({ row, category }: { row: RelatedRow; category: string }) {
  return (
    <Link href={`/story/${encodeURIComponent(row.id)}`}
          className="card card--compact story__rel"
          data-cat={category.toLowerCase()}>
      <h2>{row.headline}</h2>
      <div className="foot">
        <div className="meta">
          {row.source_count} source{row.source_count === 1 ? '' : 's'} · {ago(row.last_seen)}
        </div>
      </div>
    </Link>
  );
}
