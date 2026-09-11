import { savePrefsAction } from '@/app/actions';
import { PrefsPurge } from '@/components/PrefsPurge';
import { GeoConsent } from '@/components/GeoConsent';
import { ThemeControl } from '@/components/Theme';
import { ModeControl } from '@/components/Mode';
import { NavPlacementControl } from '@/components/NavPlacement';
import { PlacePicker, type PickedPlace } from '@/components/PlacePicker';
import { TabBar } from '@/components/TabBar';
import { CATEGORIES } from '@/lib/db';
import { getPrefs } from '@/lib/feed';
import { getStats } from '@/lib/library';
import { getPlaces } from '@/lib/places';
import { ago } from '@/components/StoryCard';
import { currentUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Profile() {
  const [prefs, stats] = await Promise.all([getPrefs(await currentUserId()), getStats()]);
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

  const counts = [
    ['Articles', stats.articles],
    ['Clusters', stats.clusters],
    ['Summarised', stats.summarised],
    ['Sources', stats.sources],
    ['Saved', stats.saved],
  ] as const;

  return (
    <>
      <main className="shell setpage">
        <div className="pagehead">
          <h1>Profile</h1>
          <p>What the feed is tuned to.</p>
        </div>

        <section className="setsection">
          <h2 className="sethead">Feed</h2>

          <form action={savePrefsAction} className="setgroup">
            <div className="setrow setrow--stack">
              <span className="setrow__title">Interests</span>
              <div className="setchips">
                {CATEGORIES.map((c) => (
                  <label key={c} className="chip" data-on={prefs.categories.includes(c)}>
                    <input type="checkbox" name={`cat:${c}`} defaultChecked={prefs.categories.includes(c)} />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            <div className="setrow">
              <label className="setrow__title" htmlFor="country">Home country</label>
              <input id="country" name="country" type="text" defaultValue={prefs.country}
                     maxLength={2} className="setinput setinput--code" />
            </div>

            <div className="setrow setrow--stack">
              <PlacePicker initial={picked} />
            </div>

            <PrefsPurge />
            <button type="submit" className="btn setsave">Save preferences</button>
          </form>

          <p className="setnote">
            Home country news is always represented, and one slot in four is kept
            for something outside these interests — a different subject, or a
            place near the ones you follow.
          </p>

          <div className="setgroup">
            <GeoConsent initialConsent={prefs.geoConsent} initialLabel={geo[0]?.label ?? null} />
          </div>
        </section>

        <section className="setsection">
          <h2 className="sethead">Appearance</h2>
          <div className="setgroup">
            <ThemeControl />
            <ModeControl />
            <NavPlacementControl />
          </div>
        </section>

        <section className="setsection">
          <h2 className="sethead">Library</h2>
          <div className="setgroup">
            <div className="setstats">
              {counts.map(([label, n]) => (
                <div key={label} className="setstat">
                  <b>{n.toLocaleString()}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="setnote">
            Newest story {stats.newest ? ago(stats.newest) : '—'}.
            Run <code>npm run cycle</code> to pull the latest.
          </p>
        </section>
      </main>
      <TabBar active="profile" />
    </>
  );
}
