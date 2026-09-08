import { savePrefsAction } from '@/app/actions';
import { GeoConsent } from '@/components/GeoConsent';
import { PlacePicker, type PickedPlace } from '@/components/PlacePicker';
import { TabBar } from '@/components/TabBar';
import { CATEGORIES } from '@/lib/db';
import { getPrefs } from '@/lib/feed';
import { getStats } from '@/lib/library';
import { getPlaces } from '@/lib/places';
import { ago } from '@/components/StoryCard';

export const dynamic = 'force-dynamic';

export default async function Profile() {
  const [prefs, stats] = await Promise.all([getPrefs(), getStats()]);
  const [resolved, geo] = await Promise.all([
    getPlaces(prefs.placeIds),
    prefs.geoConsent && prefs.geoPlaceId ? getPlaces([prefs.geoPlaceId]) : Promise.resolve([]),
  ]);

  // Anything typed before the gazetteer existed — or typed as plain text since —
  // stays on show as a chip of its own rather than disappearing from the form.
  const named = new Set(resolved.map((p) => p.name.toLowerCase()));
  const picked: PickedPlace[] = [
    ...resolved.map((p) => ({ id: p.id, name: p.name, label: p.label })),
    ...prefs.places.filter((t) => !named.has(t.toLowerCase())).map((t) => ({ id: null, name: t, label: t })),
  ];

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Profile</h1>
          <p>What the feed is tuned to. One slot in four is always kept for
             something outside these interests — a different subject, or a place
             near the ones you follow.</p>
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

            <PlacePicker initial={picked} />

            <button type="submit" className="btn" style={{ alignSelf: 'flex-start' }}>Save preferences</button>
          </form>

          <GeoConsent initialConsent={prefs.geoConsent} initialLabel={geo[0]?.label ?? null} />

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
