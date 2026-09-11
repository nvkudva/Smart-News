import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStory } from '@/lib/feed';
import { CoverageSplit } from '@/components/CoverageSplit';
import { StoryFraming } from '@/components/StoryFraming';
import { StoryCard } from '@/components/StoryCard';
import { isSaved } from '@/lib/library';
import { ago } from '@/components/StoryCard';
import { Back, Photo } from '@/components/icons';
import { SaveButton } from '@/components/SaveButton';
import { TabBar } from '@/components/TabBar';
import { currentUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  // Started together, not one after the other: whether this reader saved the
  // story has nothing to do with what the story is, and awaiting it down in the
  // markup meant it did not even begin until every other query had finished.
  const [story, userId] = await Promise.all([getStory(decoded), currentUserId()]);
  // notFound() still renders the not-found screen; it no longer sets the status,
  // because loading.tsx on this route starts the body before this line runs.
  // That is deliberate — see the note there. The reader sees the right page.
  if (!story) notFound();
  const { cluster, articles, related, coverage } = story;
  const saved = await isSaved(cluster.id, userId);

  const outlets = [...new Map(articles.map((a) => [a.source, a])).values()];
  // Two sentences per paragraph reads better than one wall of prose.
  const paragraphs = cluster.crux.split(/(?<=\.)\s+(?=[A-Z])/)
    .reduce<string[][]>((acc, s, i) => { (acc[Math.floor(i / 2)] ??= []).push(s); return acc; }, []);
  const framing = {
    left: cluster.framing_left,
    centre: cluster.framing_centre,
    right: cluster.framing_right,
  };

  return (
    <>
      <main className="shell">
        {/* Back, dateline and the save control read as one line: the story's
            own metadata sits in the bar rather than repeating under the title. */}
        <header className="story__topbar">
          <Link href="/" className="story__back" aria-label="Back"><Back /></Link>
          <div className="story__meta">
            {cluster.place && <><span>{cluster.place}</span><span className="sep">·</span></>}
            <span>{ago(cluster.first_seen)}</span>
            <span className="sep">·</span>
            <span>{outlets.length} outlet{outlets.length === 1 ? '' : 's'}</span>
          </div>
          <div className="story__save">
            <SaveButton clusterId={cluster.id} initial={saved} iconOnly />
          </div>
        </header>

        <div className="detail">
          <div className="story__head">
            <div className="story__headtext">
              <h1 className="story__title">{cluster.headline}</h1>
            </div>

            <div className="plate plate--detail">
              {cluster.image_url ? <img src={cluster.image_url} alt="" /> : <Photo size={30} />}
              {cluster.image_url && cluster.image_source && <span className="credit">Source : {cluster.image_source}</span>}
            </div>
          </div>

          <div className="detail__main">
            <div className="panel">
              <div className="label">What happened</div>
              {paragraphs.map((group, i) => <p key={i}>{group.join(' ')}</p>)}
            </div>
          </div>

          <div className="detail__side story__rail">
            <h2 className="sectitle">Sources</h2>
            <ul className="sources">
              {outlets.map((a) => (
                <li key={a.url}>
                  <a href={a.url} target="_blank" rel="noreferrer noopener">{a.source}</a>
                </li>
              ))}
            </ul>
          </div>

          <section className="story__coverage">
            {/* The panel keeps the meter and the blindspot note; the framing is
                nulled out of it and rendered beside it at full width instead. */}
            <CoverageSplit
              coverage={coverage}
              articleCount={articles.length}
              framing={{ left: null, centre: null, right: null }}
            />
            <StoryFraming framing={framing} />
          </section>

          {related.length > 0 && (
            <section className="story__related">
              <h2 className="sectitle">Related</h2>
              <div className="story__relgrid">
                {related.map((r) => (
                  <StoryCard key={r.id} story={r} variant="compact" />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
      <TabBar />
    </>
  );
}
