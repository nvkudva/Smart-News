import { getFeed, getPrefs } from '@/lib/feed';
import { StoryCard } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { Pin } from '@/components/icons';

export const dynamic = 'force-dynamic';

export default function Home() {
  const stories = getFeed(30);
  const prefs = getPrefs();
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <main className="shell">
        <header style={{ padding: '28px 4px 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--kicker)' }}>{today}</div>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.05, fontWeight: 700, letterSpacing: '-0.028em' }}>Today</h1>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 11px', borderRadius: 15,
            background: 'rgba(255,255,255,0.6)', border: '1px solid var(--glass-edge)',
            backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          }}>
            <span style={{ color: 'var(--kicker-near)', display: 'flex' }}><Pin size={12} /></span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'oklch(0.42 0.02 258)' }}>
              {prefs.places[0] ?? prefs.country}
            </span>
          </div>
        </header>

        {stories.length === 0 ? (
          <div className="panel" style={{ marginTop: 8 }}>
            <div className="label">Nothing yet</div>
            <p>Run <code>npm run ingest</code> then <code>npm run pipeline</code> to fill the feed.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {stories.map((s, i) => <StoryCard key={s.id} story={s} lead={i === 0} />)}
          </div>
        )}
      </main>
      <TabBar active="home" />
    </>
  );
}
