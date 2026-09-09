import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStory } from '@/lib/feed';
import { CoverageSplit } from '@/components/CoverageSplit';
import { StoryFraming } from '@/components/StoryFraming';
import { StoryCard } from '@/components/StoryCard';
import { isSaved } from '@/lib/library';
import { storyAge } from '@/components/StoryCard';
import { Back, Photo } from '@/components/icons';
import { SaveButton } from '@/components/SaveButton';
import { TabBar } from '@/components/TabBar';

export const dynamic = 'force-dynamic';

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const story = await getStory(decoded);
  // A dead story link has to answer 404, not 200. Next commits the status the
  // moment the body starts streaming, and a Suspense fallback anywhere above
  // this call starts it first -- so no loading.tsx may sit on this route or any
  // of its ancestors, root included.
  if (!story) notFound();
  const { cluster, articles, related, coverage } = story;

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
        <header className="story__topbar">
          <Link href="/" className="story__back" aria-label="Back"><Back /></Link>
          <span className="story__cat">{cluster.category}</span>
          {/* Top right, opposite the way out. Saving is the one thing you can do
              to this story, and at the foot of the summary it sat below the fold
              on every story long enough to be worth keeping. */}
          <div className="story__save">
            <SaveButton clusterId={cluster.id} initial={await isSaved(cluster.id)} />
          </div>
        </header>

        <div className="detail">
          <div className="story__head">
            <div className="story__headtext">
              <div className="kicker">
                {cluster.place && <><span>{cluster.place}</span><span className="sep">·</span></>}
                <span>{storyAge(cluster)}</span>
              </div>
              <h1 className="story__title">{cluster.headline}</h1>
              <div className="story__stats">
                <span>{outlets.length} outlet{outlets.length === 1 ? '' : 's'}</span>
                <span>{articles.length} article{articles.length === 1 ? '' : 's'}</span>
              </div>
            </div>

            <div className="plate plate--detail">
              {cluster.image_url ? <img src={cluster.image_url} alt="" /> : <Photo size={30} />}
            </div>
          </div>

          <div className="detail__main">
            <div className="panel">
              <div className="label">What happened</div>
              {paragraphs.map((group, i) => <p key={i}>{group.join(' ')}</p>)}
            </div>
          </div>

          <div className="detail__side story__rail">
            <h2 className="sectitle">Summarised from</h2>
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
