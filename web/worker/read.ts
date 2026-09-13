import type {
  ExplorePayload, LocalPayload, ProfilePayload, ReelsPayload, SavedPayload, Story, StoryPayload,
} from '../shared/types';
import { slug } from '../shared/taxonomy';
import { cacheHeaders, conditional, notModified } from './lib/cycle';
import { effectivePlaceIds, getLocalFeed, getPrefs, getStory, prefsFingerprint } from './lib/feed';
import {
  getByColumn, getByPlace, getCategoryFacets, getPlaceFacets,
  getReels, getSaved, getStats, isSaved, savedAmong,
} from './lib/library';
import { getPlaces } from './lib/places';
import { countriesWithNews } from './lib/sections';
import { getWorld } from './lib/world';

/**
 * The read side.
 *
 * One handler per page, each answering what that page's loader needs in a
 * single round trip - the same bargain /api/world makes for the feed. The
 * pages these replace were force-dynamic server renders that called four or
 * five lib functions apiece; the calls are unchanged, only their caller is.
 *
 * Which of these can be conditional is decided by what moves the answer:
 *
 *   The cycle stamp moves when the pipeline runs, so anything derived purely
 *   from clusters can be answered with a 304 against it - /api/explore has no
 *   reader in it at all, and /api/local varies only by the reader's prefs,
 *   which prefsFingerprint puts in the scope.
 *
 *   A save or a preference change does NOT move the stamp. So /api/saved,
 *   /api/reels, /api/story and /api/profile - every one of which embeds this
 *   reader's own save state or settings - are no-store. A validator keyed on
 *   the stamp would hand a reader back the list they had before they saved.
 */

const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  try { return REGION.of(code) ?? code } catch { return code }
};

/** Never cached: the answer carries this reader's save state or settings. */
const PRIVATE = { 'cache-control': 'no-store' } as const;

/**
 * The version of the readable world, on its own.
 *
 * One memoised row read, and the only call a returning reader has to make: if
 * the stamp it answers with is the one they already hold, everything in their
 * IndexedDB is current and nothing else needs asking for. Public and unscoped —
 * it is the same fact for everyone, with no reader in it.
 */
export async function stamp(request: Request): Promise<Response> {
  const version = await conditional(request, 'stamp');
  const headers = cacheHeaders(version, 15, 300, 'public');
  if (version.fresh) return notModified(headers);
  return Response.json({ stamp: version.stamp }, { headers });
}

/**
 * The one request a reader makes per cycle.
 *
 * The bodies are the same pool under every heading, so fourteen answers that
 * overlap become one that does not. A returning reader sends `since` and gets
 * back the three or four stories the last pipeline run produced.
 */
export async function world(request: Request, url: URL, userId: string): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? 0) || 0;

  // The bodies are the same for everyone; the fourteen orderings are not, and
  // three of them rank against the reader's preferences. The fingerprint is
  // what keeps two readers' answers off each other's validator.
  const scope = `world.${since}.${prefsFingerprint(await getPrefs(userId))}`;
  const version = await conditional(request, scope);
  const headers = cacheHeaders(version, 15, 300);
  if (version.fresh) return notModified(headers);

  return Response.json(await getWorld(userId, since), { headers });
}

/** The one line of the header that cannot be static. */
export async function place(request: Request, userId: string): Promise<Response> {
  const prefs = await getPrefs(userId);

  // Varies by the reader's own prefs, and by the gazetteer underneath them —
  // which only ever changes on a sync, which is what moves the cycle stamp.
  const version = await conditional(request, `place.${prefsFingerprint(prefs)}`);
  const headers = cacheHeaders(version, 60, 600);
  if (version.fresh) return notModified(headers);

  const places = await getPlaces(effectivePlaceIds(prefs).slice(0, 1));
  // A canonical place if there is one — named as the reader would write it,
  // city and two-letter country, not the full administrative label — the
  // reader's own words if that is all they gave us, and the country last.
  const found = places[0];
  const here = found
    ? `${found.name}, ${found.country}`
    : prefs.places[0] ?? countryName(prefs.country);
  return Response.json({ stamp: version.stamp, here }, { headers });
}

export async function local(request: Request, userId: string): Promise<Response> {
  const prefs = await getPrefs(userId);
  const version = await conditional(request, `local.${prefsFingerprint(prefs)}`);
  const headers = cacheHeaders(version, 15, 300);
  if (version.fresh) return notModified(headers);

  const [stories, places] = await Promise.all([
    getLocalFeed(30, userId),
    getPlaces(effectivePlaceIds(prefs)),
  ]);

  // getLocalFeed only falls back to the free-text place match when nothing
  // canonical resolved, so the typed names are named in the header exactly
  // when they are the thing selecting the stories below — a reader whose
  // places never resolved sees a populated page with its sources credited,
  // not 'no places'.
  const payload: LocalPayload = {
    stamp: version.stamp,
    stories,
    places,
    typed: places.length === 0 ? prefs.places : [],
    geoPlaceId: prefs.geoConsent ? prefs.geoPlaceId : null,
  };
  return Response.json(payload, { headers });
}

export async function saved(_request: Request, userId: string): Promise<Response> {
  const payload: SavedPayload = { stories: await getSaved(userId) };
  return Response.json(payload, { headers: PRIVATE });
}

export async function reels(_request: Request, userId: string): Promise<Response> {
  const stories = await getReels(20);
  const marked = await savedAmong(stories.map((s) => s.id), userId);
  // A Set does not survive JSON, so it crosses as an array and the page builds
  // its own.
  const payload: ReelsPayload = { stories, saved: [...marked] };
  return Response.json(payload, { headers: PRIVATE });
}

export async function explore(request: Request, url: URL): Promise<Response> {
  const category = url.searchParams.get('category');
  const country = url.searchParams.get('country');
  const place = url.searchParams.get('place');

  const scope = `explore.${category ?? ''}.${country ?? ''}.${place ?? ''}`;
  const version = await conditional(request, scope);
  // No reader in any of these answers, so the browser cache may hold them as
  // public - the only one of the read routes that can.
  const headers = cacheHeaders(version, 60, 600, 'public');
  if (version.fresh) return notModified(headers);

  if (category || country || place) {
    // Place ids are opaque, so the heading comes from the gazetteer's own
    // label rather than from anything read out of the id.
    let stories: Story[];
    let title: string;
    if (category) {
      stories = await getByColumn('category', category);
      title = category;
    } else if (place) {
      stories = await getByPlace(place);
      title = (await getPlaces([place]))[0]?.label ?? 'Place';
    } else {
      stories = await getByColumn('country', country!);
      title = countryName(country!);
    }

    const payload: ExplorePayload = {
      stamp: version.stamp,
      title,
      category: category ? slug(category) : null,
      stories,
    };
    return Response.json(payload, { headers });
  }

  const [categories, places] = await Promise.all([getCategoryFacets(), getPlaceFacets()]);
  const payload: ExplorePayload = { stamp: version.stamp, categories, places };
  return Response.json(payload, { headers });
}

export async function profile(_request: Request, userId: string): Promise<Response> {
  const [prefs, stats, countries] = await Promise.all([
    getPrefs(userId), getStats(), countriesWithNews(),
  ]);
  const [resolved, geo] = await Promise.all([
    getPlaces(prefs.placeIds),
    prefs.geoConsent && prefs.geoPlaceId ? getPlaces([prefs.geoPlaceId]) : Promise.resolve([]),
  ]);

  const payload: ProfilePayload = { prefs, stats, countries, resolved, geo };
  return Response.json(payload, { headers: PRIVATE });
}

export async function story(
  _request: Request, url: URL, userId: string,
): Promise<Response> {
  // /api/story/<id>, and the id may hold anything a cluster id can.
  const id = decodeURIComponent(url.pathname.slice('/api/story/'.length));
  if (!id) return Response.json({ error: 'No story id' }, { status: 400, headers: PRIVATE });

  // Started together, not one after the other: whether this reader saved the
  // story has nothing to do with what the story is.
  const [found, marked] = await Promise.all([getStory(id), isSaved(id, userId)]);
  // A 404 here is the real thing, not a rendered not-found screen: the route's
  // loader turns it into one. That is what the Next version could not do,
  // because loading.tsx had already flushed a 200 before notFound() ran.
  if (!found) return new Response(null, { status: 404, headers: PRIVATE });

  const payload: StoryPayload = { ...found, saved: marked };
  return Response.json(payload, { headers: PRIVATE });
}
