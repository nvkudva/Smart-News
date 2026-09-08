import Link from 'next/link';
import { effectivePlaceIds, getPrefs } from '@/lib/feed';
import { getPlaces } from '@/lib/places';
import { Pin } from './icons';
import { Logo } from './Logo';

const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => { try { return REGION.of(code) ?? code; } catch { return code; } };

/**
 * The wordmark used to live in the desktop rail. With the rail gone and the bar
 * at the bottom at every width, the top of the page is the only place branding
 * can sit without competing with the category strip.
 *
 * The date and the place pin came up from the feed's own header: they were true
 * of every page, and the bar had the room on its right.
 */
export async function AppHeader() {
  const prefs = await getPrefs();
  const places = await getPlaces(effectivePlaceIds(prefs).slice(0, 1));
  // A canonical place if there is one, the reader's own words if that is all
  // they gave us, and the country as the last resort.
  const here = places[0]?.label ?? prefs.places[0] ?? countryName(prefs.country);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <header className="appbar">
      <Link href="/" className="appbar__brand" aria-label="smartnews home">
        <Logo size={31} tone="ink" />
        <span>smartnews</span>
      </Link>
      <div className="appbar__aside">
        <span className="appbar__date">{today}</span>
        {/* The one way into the local surface: no sixth tab, but the pin was
            already naming the reader's place, so make it go there. */}
        <Link href="/local" className="pinchip" aria-label={`Local news for ${here}`}>
          <span className="pinchip__i"><Pin size={12} /></span>
          <span className="pinchip__t">{here}</span>
        </Link>
      </div>
    </header>
  );
}
