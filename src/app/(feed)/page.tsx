import { getFeed } from '@/lib/feed';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const stories = await getFeed(30);

  return (
    <>
      <main className="shell">
        <CategoryStrip active="top" />

        {stories.length === 0 ? (
          <div className="panel" style={{ marginTop: 8 }}>
            <div className="label">Nothing yet</div>
            <p>Run <code>npm run ingest</code> then <code>npm run pipeline</code> to fill the feed.</p>
          </div>
        ) : (
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        )}
      </main>
      <TabBar active="home" />
    </>
  );
}
