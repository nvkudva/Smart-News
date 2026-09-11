import { NextResponse } from 'next/server';
import { effectivePlaceIds, getPrefs, prefsFingerprint } from '@/lib/feed';
import { cacheHeaders, conditional, notModified } from '@/lib/cycle';
import { getPlaces } from '@/lib/places';
import { currentUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => { try { return REGION.of(code) ?? code; } catch { return code; } };

/** The one line of the header that cannot be static. Split out so the rest of
 *  the bar — and every page that carries it — can be. */
export async function GET(request: Request) {
  const prefs = await getPrefs(await currentUserId());

  // Varies by the reader's own prefs, and by the gazetteer underneath them —
  // which only ever changes on a sync, which is what moves the cycle stamp.
  const version = await conditional(request, `place.${prefsFingerprint(prefs)}`);
  const headers = cacheHeaders(version, 60, 600);
  if (version.fresh) return notModified(headers);

  const places = await getPlaces(effectivePlaceIds(prefs).slice(0, 1));
  // A canonical place if there is one — named as the reader would write it,
  // city and two-letter country, not the full administrative label — the
  // reader's own words if that is all they gave us, and the country last.
  const place = places[0];
  const here = place ? `${place.name}, ${place.country}` : prefs.places[0] ?? countryName(prefs.country);
  return NextResponse.json({ stamp: version.stamp, here }, { headers });
}
