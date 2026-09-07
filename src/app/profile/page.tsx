import { savePrefsAction } from '@/app/actions';
import { TabBar } from '@/components/TabBar';
import { CATEGORIES } from '@/lib/db';
import { getPrefs } from '@/lib/feed';
import { getStats } from '@/lib/library';
import { ago } from '@/components/StoryCard';

export const dynamic = 'force-dynamic';

export default async function Profile() {
  const [prefs, stats] = await Promise.all([getPrefs(), getStats()]);

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Profile</h1>
          <p>What the feed is tuned to. One slot in four is always kept for
             something outside these interests.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <form action={savePrefsAction} className="panel">
            <div className="label">Interests</div>
            <div className="chips">
              {CATEGORIES.map((c) => (
                <label key={c} className="chip" data-on={prefs.categories.includes(c)}>
                  <input type="checkbox" name={`cat:${c}`} defaultChecked={prefs.categories.includes(c)}
                         style={{ margin: 0, accentColor: 'var(--accent)' }} />
                  {c}
                </label>
              ))}
            </div>

            <div className="field">
              <label htmlFor="country">Home country — its news is always represented</label>
              <input id="country" name="country" type="text" defaultValue={prefs.country}
                     maxLength={2} style={{ width: 90, textTransform: 'uppercase' }} />
            </div>

            <div className="field">
              <label htmlFor="places">Places you care about — comma separated</label>
              <input id="places" name="places" type="text" defaultValue={prefs.places.join(', ')}
                     placeholder="Bengaluru, Kerala, London" />
            </div>

            <button type="submit" className="btn" style={{ alignSelf: 'flex-start' }}>Save preferences</button>
          </form>

          <div className="panel">
            <div className="label">Library</div>
            <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {([
                ['Articles', stats.articles],
                ['Clusters', stats.clusters],
                ['Summarised', stats.summarised],
                ['Sources', stats.sources],
                ['Saved', stats.saved],
              ] as const).map(([label, n]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.028em' }}>{n.toLocaleString()}</div>
                  <div className="tile__n">{label}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              Newest story {stats.newest ? ago(stats.newest) : '—'}.
              Run <code>npm run cycle</code> to pull the latest.
            </p>
          </div>
        </div>
      </main>
      <TabBar active="profile" />
    </>
  );
}
