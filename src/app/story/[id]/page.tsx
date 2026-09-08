import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStory } from '@/lib/feed';
import { CoverageSplit } from '@/components/CoverageSplit';
import { isSaved } from '@/lib/library';
import { ago, storyAge } from '@/components/StoryCard';
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

  return (
    <>
      <main className="shell">
        <header style={{ padding: '8px 0 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Link href="/" style={{ width: 34, height: 34, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'oklch(0.48 0.11 252)' }} aria-label="Back">
            <Back />
          </Link>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'oklch(0.42 0.02 258)' }}>{cluster.category}</span>
        </header>

        <div className="detail">
          <div className="detail__main">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div className="kicker">
                {cluster.place && <><span>{cluster.place}</span><span className="sep">·</span></>}
                <span>{storyAge(cluster)}</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 27, lineHeight: 1.16, fontWeight: 700, letterSpacing: '-0.026em', textWrap: 'pretty' }}>
                {cluster.headline}
              </h1>
            </div>

            <div className="plate plate--detail">
              {cluster.image_url ? <img src={cluster.image_url} alt="" /> : <Photo size={30} />}
            </div>

            <div className="panel">
              <div className="label">What happened</div>
              {paragraphs.map((group, i) => <p key={i}>{group.join(' ')}</p>)}
            </div>

            <SaveButton clusterId={cluster.id} initial={await isSaved(cluster.id)} />
          </div>

          <div className="detail__side">
            <CoverageSplit
              coverage={coverage}
              articleCount={articles.length}
              framing={{
                left: cluster.framing_left,
                centre: cluster.framing_centre,
                right: cluster.framing_right,
              }}
            />

            {related.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                <div className="label" style={{ paddingLeft: 2 }}>Related</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {related.map((r) => (
                    <Link key={r.id} href={`/story/${encodeURIComponent(r.id)}`} className="relrow">
                      <div className="relrow__t">{r.headline}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r.source_count} sources · {ago(r.last_seen)}</div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 2px' }}>
              <div className="label">Summarised from</div>
              <p className="sources">
                {outlets.map((a, i) => (
                  <span key={a.url}>
                    {i > 0 && ' · '}
                    <a href={a.url} target="_blank" rel="noreferrer noopener">{a.source}</a>
                  </span>
                ))}
              </p>
            </div>
          </div>
        </div>
      </main>
      <TabBar />
    </>
  );
}
