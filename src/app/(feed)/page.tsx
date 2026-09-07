import Link from 'next/link';
import { effectivePlaceIds, getFeed, getPrefs } from '@/lib/feed';
import { getPlaces } from '@/lib/places';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { Pin } from '@/components/icons';
import { Logo } from '@/components/Logo';

export const dynamic = 'force-dynamic';

const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => { try { return REGION.of(code) ?? code; } catch { return code; } };

export default async function Home() {
  const [stories, prefs] = await Promise.all([getFeed(30), getPrefs()]);
  const places = await getPlaces(effectivePlaceIds(prefs).slice(0, 1));
  // A canonical place if there is one, the reader's own words if that is all
  // they gave us, and the country as the last resort.
  const here = places[0]?.label ?? prefs.places[0] ?? countryName(prefs.country);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <main className="shell">
        <header style={{ padding: '28px 4px 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--kicker)' }}>
              <span className="masthead-mark"><Logo size={18} tone="ink" tight /></span>
              {today}
            </div>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.05, fontWeight: 700, letterSpacing: '-0.028em' }}>Today</h1>
          </div>
          {/* The one way into the local surface: no sixth tab, but the pin was
              already naming the reader's place, so make it go there. */}
          <Link href="/local" className="pinchip" aria-label={`Local news for ${here}`}>
            <span className="pinchip__i"><Pin size={12} /></span>
            <span className="pinchip__t">{here}</span>
          </Link>
        </header>

        {stories.length === 0 ? (
          <div className="panel" style={{ marginTop: 8 }}>
            <div className="label">Nothing yet</div>
            <p>Run <code>npm run ingest</code> then <code>npm run pipeline</code> to fill the feed.</p>
          </div>
        ) : (
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        )}
      </main>
      <TabBar active="home" />
    </>
  );
}
