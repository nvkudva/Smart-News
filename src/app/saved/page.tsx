import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { getSaved } from '@/lib/library';

export const dynamic = 'force-dynamic';

export default async function Saved() {
  const stories = await getSaved();

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Saved</h1>
          <p>{stories.length ? `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} kept for later.`
                             : 'Nothing saved yet.'}</p>
        </div>

        {stories.length === 0 ? (
          <div className="panel">
            <div className="label">How this fills up</div>
            <p>Open any story and press Save. Saved stories stay here even after
               they drop out of the 48-hour feed window.</p>
          </div>
        ) : (
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        )}
      </main>
      <TabBar active="saved" />
    </>
  );
}
