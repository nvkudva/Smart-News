import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStory } from '@/lib/feed';
import { ago } from '@/components/StoryCard';
import { Back, Photo } from '@/components/icons';
import { TabBar } from '@/components/TabBar';

export const dynamic = 'force-dynamic';

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(decodeURIComponent(id));
  if (!story) notFound();
  const { cluster, articles, related } = story;

  const outlets = [...new Map(articles.map((a) => [a.source, a])).values()];

  return (
    <>
      <main className="shell">
        <header style={{ padding: '24px 0 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/" style={{ width: 44, height: 44, marginLeft: -12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'oklch(0.48 0.11 252)' }} aria-label="Back">
            <Back />
          </Link>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'oklch(0.42 0.02 258)' }}>{cluster.category}</span>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div className="kicker">
              {cluster.place && <><span>{cluster.place}</span><span className="sep">·</span></>}
              <span>{ago(cluster.last_seen)}</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 27, lineHeight: 1.16, fontWeight: 700, letterSpacing: '-0.026em', textWrap: 'pretty' }}>
              {cluster.headline}
            </h1>
          </div>

          <div className="plate" style={{ height: 208, borderRadius: 22 }}>
            {cluster.image_url ? <img src={cluster.image_url} alt="" /> : <Photo size={30} />}
          </div>

          <div className="panel">
            <div className="label">What happened</div>
            {cluster.crux.split(/(?<=\.)\s+(?=[A-Z])/).reduce<string[][]>((acc, s, i) => {
              const g = Math.floor(i / 2);
              (acc[g] ??= []).push(s);
              return acc;
            }, []).map((group, i) => <p key={i}>{group.join(' ')}</p>)}
          </div>

          <div className="panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="label">How it&rsquo;s covered</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'oklch(0.60 0.014 258)' }}>
                {articles.length} article{articles.length === 1 ? '' : 's'}
              </div>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.5, color: 'oklch(0.42 0.014 258)' }}>
              {cluster.source_count} independent outlet{cluster.source_count === 1 ? '' : 's'} ran this story.
              Left/centre/right breakdown arrives with the source-ratings table in v2.
            </p>
          </div>

          {related.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="label" style={{ paddingLeft: 2 }}>Related</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {related.map((r) => (
                  <Link key={r.id} href={`/story/${encodeURIComponent(r.id)}`} style={{
                    borderRadius: 17, padding: '13px 15px', textDecoration: 'none', color: 'inherit',
                    background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.72)',
                    backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <div style={{ fontSize: 14.5, fontWeight: 620, lineHeight: 1.3, letterSpacing: '-0.012em' }}>{r.headline}</div>
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
      </main>
      <TabBar />
    </>
  );
}
