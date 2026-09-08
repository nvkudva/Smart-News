import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';

/**
 * Scoped to the (feed) route group on purpose. A loading.tsx at the app root
 * would also wrap /story/[id], and its Suspense boundary flushes the shell —
 * and a 200 — before the page runs, so notFound() could no longer set a 404.
 */
export default function LoadingFeed() {
  return (
    <>
      <main className="shell">
        <CategoryStrip active="top" />
        <div className="feed" aria-busy="true" aria-label="Loading stories">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={`skel ${i === 0 ? 'skel--lead' : i % 3 === 2 ? 'skel--compact' : ''}`} />
          ))}
        </div>
      </main>
      <TabBar active="home" />
    </>
  );
}
