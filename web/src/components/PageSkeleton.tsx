import { TabBar, type Tab } from './TabBar';

/**
 * The pending state for a page that is not the feed.
 *
 * /local, /explore, /profile and /saved each carried a copy of this that
 * differed only in the heading and the lit tab, and /local's copy lit Home -
 * so the bar jumped from Home to Local when the rows landed.
 */
export function PageSkeleton({ title, tab }: { title: string; tab: Tab }) {
  return (
    <>
      <main className="shell">
        <div className="pagehead"><h1>{title}</h1></div>
        <div className="feed" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skel skel--compact" />)}
        </div>
      </main>
      <TabBar active={tab} />
    </>
  );
}
