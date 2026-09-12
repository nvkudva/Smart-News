import type { ActionName, Actions } from '../shared/actions';
import { getPrefs, savePrefs } from './lib/feed';
import { toggleSaved } from './lib/library';
import { nearestPlace, searchPlaces } from './lib/places';

/**
 * The write side, ported from src/app/actions.ts.
 *
 * Bodies are unchanged. The only difference is where the reader comes from:
 * each of these called `await currentUserId()` to reach into the request's
 * cookie jar, and now takes the id as its first argument because fetch()
 * resolves it once per request.
 *
 * revalidatePrefs() is gone rather than ported. It was already empty — every
 * route it would have named was force-dynamic, so there was no cached render
 * to invalidate — and in an SPA there is not even a render on this side to
 * speak of. The three caches that actually delay a preference change still
 * invalidate themselves: the isolate map in sections.ts is keyed on a
 * fingerprint of the prefs row, and the client empties its own on submit.
 */

/** Each action, with the reader threaded in front of its declared arguments. */
type Impl = {
  [K in ActionName]: (
    userId: string,
    ...args: Parameters<Actions[K]>
  ) => ReturnType<Actions[K]>;
};

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

export const ACTIONS: Impl = {
  toggleSaved: (userId, clusterId) => toggleSaved(clusterId, userId),

  /**
   * One toggle, one write.
   *
   * The form these used to live in had a Save button because a form does, not
   * because anything here needs a transaction: each of these settings is
   * independent and takes effect on its own. Returning the new list lets the
   * control render from the answer rather than from a guess about it.
   */
  toggleInterest: async (userId, category) => {
    const prefs = await getPrefs(userId);
    const on = prefs.categories.includes(category);
    const categories = on
      ? prefs.categories.filter((c) => c !== category)
      : [...prefs.categories, category];
    // An empty set leaves the ranker and the exploration reserve with nothing
    // to work against, so the last interest cannot be removed.
    if (categories.length === 0) return { hidden: prefs.hidden, categories: prefs.categories };
    // The mirror of hiding un-picking: you cannot be interested in a subject
    // you have hidden, so saying you are takes it back off the hidden list.
    const hidden = on ? prefs.hidden : prefs.hidden.filter((c) => c !== category);
    await savePrefs({ ...prefs, categories, hidden }, userId);
    return { hidden, categories };
  },

  /** Hiding a category also stops it being an interest: it cannot be both. */
  toggleHidden: async (userId, category) => {
    const prefs = await getPrefs(userId);
    const off = prefs.hidden.includes(category);
    const hidden = off
      ? prefs.hidden.filter((c) => c !== category)
      : [...prefs.hidden, category];
    const categories = off ? prefs.categories : prefs.categories.filter((c) => c !== category);
    await savePrefs(
      { ...prefs, hidden, categories: categories.length ? categories : prefs.categories },
      userId);
    return { hidden, categories };
  },

  setCountry: async (userId, code) => {
    const prefs = await getPrefs(userId);
    const country = code.toUpperCase().slice(0, 2);
    if (!/^[A-Z]{2}$/.test(country)) return prefs.country;
    await savePrefs({ ...prefs, country }, userId);
    return country;
  },

  /** The picker owns both arrays: everything typed, and what the gazetteer knew. */
  setPlaces: async (userId, labels, ids) => {
    const prefs = await getPrefs(userId);
    const places = labels.map((p) => p.trim()).filter(Boolean).slice(0, 12);
    await savePrefs({ ...prefs, places, placeIds: await resolveLabels(places, ids) }, userId);
  },

  searchPlaces: async (_userId, q) => {
    const query = q.trim();
    if (query.length < 2) return [];
    return searchPlaces(query, 8);
  },

  /**
   * Step one of the consent pair, and the only thing that can raise the flag.
   * Lowering it drops the derived place too: consent withdrawn has to mean the
   * place stops being used, not merely that it stops being refreshed.
   */
  setGeoConsent: async (userId, on) => {
    const current = await getPrefs(userId);
    await savePrefs({
      ...current,
      geoConsent: on,
      geoPlaceId: on ? current.geoPlaceId : null,
    }, userId);
  },

  /**
   * The only place in the app that sees coordinates. They are arguments,
   * nothing more: resolved to a gazetteer place here and dropped when this
   * call returns. Nothing writes them — not prefs, not events, not a log line.
   *
   * Consent is re-read from the row rather than trusted from the caller, so a
   * stale tab or a hand-made request cannot turn location on by using it.
   */
  setGeoPlace: async (userId, lat, lon) => {
    const current = await getPrefs(userId);
    if (!current.geoConsent) return { ok: false, label: null };
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
        || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, label: null };
    }
    const place = await nearestPlace(lat, lon);
    if (!place) return { ok: false, label: null };

    await savePrefs({ ...current, geoPlaceId: place.id }, userId);
    return { ok: true, label: place.label };
  },

  /** Forget the resolved place but leave the switch where the reader put it, so
   *  'Use my location' can be pressed again without re-consenting. */
  clearGeo: async (userId) => {
    const current = await getPrefs(userId);
    await savePrefs({ ...current, geoPlaceId: null }, userId);
  },
};

/**
 * Dispatch one call.
 *
 * The name is checked against ACTIONS rather than trusted, and the arguments
 * are spread positionally exactly as the contract declares them — so a request
 * naming something that is not an action, or a body that is not an array, is a
 * 400 and never reaches an implementation.
 */
export async function runAction(
  userId: string, name: unknown, args: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  if (typeof name !== 'string' || !Object.hasOwn(ACTIONS, name)) {
    return { ok: false, status: 400, error: `No such action: ${String(name)}` };
  }
  if (!Array.isArray(args)) {
    return { ok: false, status: 400, error: 'args must be an array' };
  }
  const fn = ACTIONS[name as ActionName] as (u: string, ...a: unknown[]) => Promise<unknown>;
  return { ok: true, value: await fn(userId, ...args) };
}
