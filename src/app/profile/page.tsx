import { PrefChips } from '@/components/PrefChips';
import { CountryPicker, type CountryOption } from '@/components/CountryPicker';
import { GeoConsent } from '@/components/GeoConsent';
import { ThemeControl } from '@/components/Theme';
import { ModeControl } from '@/components/Mode';
import { NavPlacementControl } from '@/components/NavPlacement';
import { PlacePicker, type PickedPlace } from '@/components/PlacePicker';
import { TabBar } from '@/components/TabBar';
import { CATEGORIES } from '@/lib/db';
import { getPrefs } from '@/lib/feed';
import { getStats } from '@/lib/library';
import { countriesWithNews } from '@/lib/sections';
import { getPlaces } from '@/lib/places';
import { ago } from '@/components/StoryCard';
import { currentUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Profile() {
  const [prefs, stats, countries] = await Promise.all([
    getPrefs(await currentUserId()), getStats(), countriesWithNews(),
  ]);
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

  // Named here, not in the control: Intl.DisplayNames reads the runtime's own
  // ICU, and Node's and the browser's disagree often enough to cause a
  // hydration mismatch — which takes every handler on the page down with it.
  const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
  const nameOf = (c: string) => { try { return REGION.of(c) ?? c; } catch { return c; } };
  // The stored country belongs in the list even if we hold nothing filed to it
  // today, or choosing it back would be impossible.
  const options: CountryOption[] = [...new Set([prefs.country, ...countries])]
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));

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

          <div className="setgroup">
            <PrefChips categories={CATEGORIES} initialPicked={[...prefs.categories]}
                       initialHidden={[...prefs.hidden]} />
          </div>

          <p className="setnote">
            Everything saves as you tap it. Interests weight the feed rather than
            filter it — hiding is what removes a subject, from the feed and from
            the strip alike.
          </p>
        </section>

        {/* One section, because they are one question: where you are reading
            from. The country is not a profile field — National is the stories
            filed to it and International is everything else — so it belongs
            beside the places rather than above the interests. */}
        <section className="setsection">
          <h2 className="sethead">Location</h2>

          <div className="setgroup">
            <div className="setrow">
              <span className="setrow__title">Home country</span>
              <CountryPicker country={prefs.country} options={options} />
            </div>

            {/* The picker heads itself; a second title above it said the same
                words twice. */}
            <div className="setrow setrow--stack">
              <PlacePicker initial={picked} />
            </div>

            <GeoConsent initialConsent={prefs.geoConsent} initialLabel={geo[0]?.label ?? null} />
          </div>

          <p className="setnote">
            National and International are this country and everything else. The
            list holds only countries we currently carry stories for.
          </p>
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
