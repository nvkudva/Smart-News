import { TAXONOMY } from '../../shared/taxonomy';
import { CategoryPager } from './CategoryPager';
import { CategoryStrip } from './CategoryStrip';
import { TabBar } from './TabBar';

/**
 * The feed, for whichever category is centred.
 *
 * / and /c/$cat are one page under two addresses - Top is the index route
 * because it is the app's entry point, every other slug is a param - and their
 * two components had drifted into copies of each other differing only in the
 * slug they passed down three times.
 *
 * The order is built here rather than in CategoryPager because that component
 * must not import the taxonomy: the node half of it reaches node:sqlite through
 * the category list, and pulling the module in drags the store into the bundle.
 */
const SECTIONS = TAXONOMY.map((c) => ({ slug: c.slug, name: c.name }));

export function FeedPage({ active }: { active: string }) {
  return (
    <>
      <main className="shell">
        <CategoryStrip active={active} />
        <CategoryPager active={active} sections={SECTIONS} />
      </main>
      <TabBar active="home" />
    </>
  );
}
