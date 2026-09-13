import { Link } from '@tanstack/react-router';
import { CategoryStrip } from './CategoryStrip';
import { SectionSkeleton } from './SectionFeed';
import { TabBar } from './TabBar';

/**
 * The pending and error faces of the two routes that show the feed.
 *
 * The feed's data is loaded by src/lib/world.ts, which the router could not
 * see: / and /c/$cat had no pendingComponent and no errorComponent, so a slow
 * world showed SectionFeed's own skeleton and a failed one showed its own
 * panel, both nested inside a page that had already committed. Wrapping the
 * load in a route loader hands those two states back to the router - which is
 * also what makes preloadRoute warm the data rather than only the chunk.
 *
 * Both keep the strip and the bar, because both are derivable from the
 * hardcoded taxonomy and neither depends on the answer being in yet. Only the
 * rows are missing.
 */

export function FeedPending({ active }: { active: string }) {
  return (
    <>
      <main className="shell">
        <CategoryStrip active={active} />
        <SectionSkeleton />
      </main>
      <TabBar active="home" />
    </>
  );
}

export function FeedError({ active }: { active: string }) {
  return (
    <>
      <main className="shell">
        <CategoryStrip active={active} />
        <div className="panel">
          <div className="label">Could not load</div>
          <p>The feed did not come back. Check your connection and try again.</p>
          {/* reloadDocument, because the router's own retry would re-run a
              loader against the same failed state; this starts over. */}
          <Link to="/" reloadDocument className="btn"
                style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
            Try again
          </Link>
        </div>
      </main>
      <TabBar active="home" />
    </>
  );
}
