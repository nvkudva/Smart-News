import { getFeed } from '@/lib/feed';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { CategoryStrip } from '@/components/CategoryStrip';
import { CategoryPager } from '@/components/CategoryPager';
import { SubcategoryStrip } from '@/components/SubcategoryStrip';
import { TAXONOMY, filterBySub, subCategoriesFor } from '@/lib/taxonomy';
import { currentUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: { searchParams: Promise<{ sub?: string }> }) {
  const { sub } = await searchParams;
  const stories = await getFeed(30, await currentUserId());

  // Top's subs are the topic categories its own rows fall under, counted off the
  // array already in hand rather than queried for. Every other section has had
  // this strip since it was written; Top was the one that did not, because it
  // builds its feed here instead of through SectionFeed.
  const subs = subCategoriesFor('top', stories);
  const active = sub && subs.some((s) => s.slug === sub) ? sub : null;
  const shown = active ? filterBySub('top', active, stories) : stories;

  return (
    <>
      <main className="shell">
        <CategoryStrip active="top" />
        {/* See the note in c/[cat]: the strip is the title only where it is set
            at display size, which the desktop column is not. */}
        <h1 className="cattitle">Top</h1>
        {/* Top is the one section rendered on the server, so it is handed to the
            pager as its middle pane rather than fetched again on the client —
            the first paint has to survive the pager being introduced. */}
        <CategoryPager active="top" sections={TAXONOMY.map((c) => ({ slug: c.slug, name: c.name }))}>
          <SubcategoryStrip cat="top" label="Top" base="/" subs={subs} active={active} />

          {shown.length === 0 ? (
            <div className="panel" style={{ marginTop: 8 }}>
              <div className="label">Nothing yet</div>
              <p>Run <code>npm run ingest</code> then <code>npm run pipeline</code> to fill the feed.</p>
            </div>
          ) : (
            <div className="feed">
              {shown.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
            </div>
          )}
        </CategoryPager>
      </main>
      <TabBar active="home" />
    </>
  );
}
