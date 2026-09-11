'use server';

import { getPrefs, savePrefs, type Prefs } from '@/lib/feed';
import { toggleSaved } from '@/lib/library';
import { CATEGORIES } from '@/lib/db';
import { nearestPlace, searchPlaces, type Place } from '@/lib/places';

/**
 * Kept as the one place that knows a preference change has to reach the reader,
 * but it no longer calls revalidatePath. Those calls did nothing: every route
 * they named is force-dynamic, so there was no cached render to invalidate, and
 * the incremental cache is the read-only static-assets one, which cannot be
 * written at runtime.
 *
 * What actually delays the change is three 60-second caches the save does not
 * touch, and they compose: the per-isolate map in sections.ts, the per-tab map
 * in SectionFeed, and the service worker's stale-while-revalidate on /api/*.
 * Worst case is close to three minutes. Fixing that means keying those maps on
 * a stamp the save can bump, which is a change to all three and not this one.
 */
function revalidatePrefs() {
  // Intentionally empty — see above.
}

export async function toggleSavedAction(clusterId: string): Promise<boolean> {
  // /saved is force-dynamic too, so revalidating it was the same no-op; the
  // button already reflects the new state from this function's return value.
  return toggleSaved(clusterId);
}

/** The picker posts JSON; a hand-edited or stale field must not lose the form. */
function parsePlaceIds(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((v): v is string => typeof v === 'string' && v !== ''))].slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * Second chance for anything the picker sent as plain text: an exact name hit
 * in the gazetteer becomes a canonical id here. It is what heals a row saved
 * before the gazetteer existed — the reader re-saves and their 'Bengaluru'
 * gains an id — without ever guessing at a string that only nearly matches.
 */
async function resolveLabels(labels: string[], have: string[]): Promise<string[]> {
  const ids = [...have];
  const seen = new Set(have);
  for (const label of labels) {
    const key = label.trim().toLowerCase();
    if (key.length < 2 || ids.length >= 12) continue;
    const hit = (await searchPlaces(key, 4))
      .find((p) => p.name.toLowerCase() === key || p.label.toLowerCase() === key);
    if (hit && !seen.has(hit.id)) { ids.push(hit.id); seen.add(hit.id); }
  }
  return ids;
}

export async function savePrefsAction(formData: FormData) {
  const picked = CATEGORIES.filter((c) => formData.get(`cat:${c}`) === 'on');
  const current = await getPrefs();
  const places = String(formData.get('places') ?? '')
    .split(',').map((p) => p.trim()).filter(Boolean).slice(0, 12);
  const prefs: Prefs = {
    ...current,
    country: String(formData.get('country') ?? 'IN').toUpperCase().slice(0, 2),
    // An empty set leaves the ranker and the exploration reserve with nothing to
    // work against, so keep the last real selection instead of storing [].
    categories: picked.length > 0 ? picked : current.categories,
    places,
    // The two arrays are not index-aligned: `places` keeps everything the reader
    // typed, `placeIds` only the entries that mean something to the gazetteer.
    placeIds: await resolveLabels(places, parsePlaceIds(formData.get('place_ids'))),
    // geoConsent and geoPlaceId are not the form's to change: the consent block
    // owns them, and a plain save must never silently re-enable or drop them.
  };
  await savePrefs(prefs);
  revalidatePrefs();
}

export async function searchPlacesAction(q: string): Promise<Place[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  return searchPlaces(query, 8);
}

/**
 * Step one of the consent pair, and the only thing that can raise the flag.
 * Lowering it drops the derived place too: consent withdrawn has to mean the
 * place stops being used, not merely that it stops being refreshed.
 */
export async function setGeoConsentAction(on: boolean): Promise<void> {
  const current = await getPrefs();
  await savePrefs({
    ...current,
    geoConsent: on,
    geoPlaceId: on ? current.geoPlaceId : null,
  });
  revalidatePrefs();
}

/**
 * The only place in the app that sees coordinates. They are arguments, nothing
 * more: resolved to a gazetteer place here and dropped when this call returns.
 * Nothing writes them — not prefs, not events, not a log line.
 *
 * Consent is re-read from the row rather than trusted from the caller, so a
 * stale tab or a hand-made request cannot turn location on by using it.
 */
export async function setGeoPlaceAction(lat: number, lon: number): Promise<{ ok: boolean; label: string | null }> {
  const current = await getPrefs();
  if (!current.geoConsent) return { ok: false, label: null };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, label: null };
  }
  const place = await nearestPlace(lat, lon);
  if (!place) return { ok: false, label: null };

  await savePrefs({ ...current, geoPlaceId: place.id });
  revalidatePrefs();
  return { ok: true, label: place.label };
}

/** Forget the resolved place but leave the switch where the reader put it, so
 *  'Use my location' can be pressed again without re-consenting. */
export async function clearGeoAction(): Promise<void> {
  const current = await getPrefs();
  await savePrefs({ ...current, geoPlaceId: null });
  revalidatePrefs();
}
