/**
 * The gazetteer, as the web app sees it.
 *
 * Places are a fixed three-level tree — country -> admin1 -> city — stored in
 * one table under an opaque readable id ('n:in', 'a:in.karnataka',
 * 'c:in.karnataka.bengaluru'). Because the depth is fixed, every hierarchy
 * question is a flat IN-list rather than a recursive CTE, which matters when
 * the store is D1 and each statement is a network round trip.
 *
 * Sub-city text ("Whitefield", "Satya Niketan, Delhi") is deliberately NOT a
 * fourth level. It is an alias onto the city row, which is what makes "a story
 * in Whitefield counts as Bengaluru" true without any extra query.
 *
 * This module runs inside the deployed Worker, so it may import only ./d1 and
 * standard web globals — no Node builtins, and nothing out of db.ts. The
 * pipeline's synchronous equivalent lives in places-local.ts.
 *
 * None of the gazetteer reads touch D1 any more. The 338 places and their
 * aliases are compiled into gazetteer.gen.ts and indexed here at module load,
 * because they answered the same questions on every request from rows that only
 * change when someone edits the seed and redeploys. What is left of d1 here is
 * placesReady, which asks about columns on OTHER tables.
 */

import { d1 } from './d1';
import { ALIASES, PLACES, type PlaceRow } from './gazetteer.gen';

export type PlaceKind = 'city' | 'admin1' | 'country';

export type Place = {
  id: string; kind: PlaceKind; name: string; label: string; country: string;
  admin1_id: string | null; parent_id: string | null;
  lat: number | null; lon: number | null; population: number | null;
};

const fromRow = (r: PlaceRow): Place => ({
  id: r[0], kind: r[1], name: r[2], label: r[3], country: r[4],
  admin1_id: r[5], parent_id: r[6], lat: r[7], lon: r[8], population: r[9],
});

/** Built once per isolate, then shared by every request it serves. */
const ALL: Place[] = PLACES.map(fromRow);
const BY_ID = new Map(ALL.map((p) => [p.id, p]));
const BY_ADMIN1 = new Map<string, Place[]>();
const BY_COUNTRY = new Map<string, Place[]>();
for (const p of ALL) {
  if (p.admin1_id) (BY_ADMIN1.get(p.admin1_id) ?? BY_ADMIN1.set(p.admin1_id, []).get(p.admin1_id)!).push(p);
  (BY_COUNTRY.get(p.country) ?? BY_COUNTRY.set(p.country, []).get(p.country)!).push(p);
}
// The SQL keyed on (alias, country) with '' as the global scope; so does this.
const BY_ALIAS = new Map<string, string>(ALIASES.map((a) => [`${a[0]}\u0000${a[1]}`, a[2]]));

/** The label the feed used to get from a LEFT JOIN on every candidate row. */
export function placeLabel(id: string | null): string | null {
  return id ? BY_ID.get(id)?.label ?? null : null;
}

/** Combining marks left behind by NFD, so "Ocaña" and "Ocana" are one string. */
const MARKS = /[̀-ͯ]/g;

export function slugify(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normaliseAlias(raw: string): string {
  return raw.normalize('NFD').replace(MARKS, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function placeId(
  kind: PlaceKind,
  country: string,
  parts: { admin1?: string | null; city?: string | null } = {},
): string {
  const cc = country.toLowerCase();
  if (kind === 'country') return `n:${cc}`;
  const a1 = parts.admin1 ? slugify(parts.admin1) : '';
  if (kind === 'admin1') return `a:${cc}.${a1}`;
  const city = slugify(parts.city ?? '');
  return `c:${cc}.${a1 ? `${a1}.` : ''}${city}`;
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether the store has the v1.5 gazetteer at all.
 *
 * The tables and the two new columns are created by `npm run sync`, not by the
 * deploy, so a build can reach production minutes before the pipeline has run
 * — and against an unmigrated D1 every place-aware statement is a hard error,
 * which used to empty the whole site. Every read here asks first and degrades
 * to pre-v1.5 behaviour instead.
 *
 * A `true` is cached for the life of the isolate (tables do not disappear); a
 * `false` is re-probed, so the site heals on the first sync with no redeploy.
 */
let gazetteer = false;

export async function placesReady(): Promise<boolean> {
  if (gazetteer) return true;
  try {
    const row = await (await d1()).get<{ places: number; cluster: number; prefs: number }>(
      `SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='places') AS places,
              (SELECT COUNT(*) FROM pragma_table_info('clusters') WHERE name='place_id') AS cluster,
              (SELECT COUNT(*) FROM pragma_table_info('prefs') WHERE name='place_ids') AS prefs`);
    gazetteer = Boolean(row?.places && row?.cluster && row?.prefs);
  } catch {
    gazetteer = false;   // an unreachable store is not a migrated one
  }
  return gazetteer;
}

/** Rows in the order the caller asked for; ids the gazetteer does not know are dropped. */
export async function getPlaces(ids: string[]): Promise<Place[]> {
  return ids.map((id) => BY_ID.get(id)).filter((p): p is Place => !!p);
}

/**
 * Free text -> a place. The model writes whatever it likes ("Satya Niketan,
 * Delhi", "Sagar district, Madhya Pradesh"), so after the whole string fails we
 * try the last comma-separated segment — which is the broader place, and the
 * one an alias is most likely to exist for — and only then the first.
 *
 * A country-scoped alias wins over a global one at every step: "Hyderabad" is a
 * different city in IN and PK.
 */
export async function resolvePlaceName(raw: string, country?: string | null): Promise<Place | null> {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const cc = country && /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : '';

  const segments = text.split(',').map((s) => s.trim()).filter(Boolean);
  const candidates = [text];
  if (segments.length > 1) candidates.push(segments[segments.length - 1], segments[0]);

  const aliases: string[] = [];
  for (const c of candidates) {
    const a = normaliseAlias(c);
    if (a && !aliases.includes(a)) aliases.push(a);
  }
  if (!aliases.length) return null;

  const countries = cc ? [cc, ''] : [''];
  // Same priority order the SQL's caller applied to its rows: alias candidates
  // outermost, country-scoped before global.
  for (const alias of aliases) {
    for (const c of countries) {
      const id = BY_ALIAS.get(`${alias}\u0000${c}`);
      const hit = id ? BY_ID.get(id) : undefined;
      if (hit) return hit;
    }
  }
  return null;
}

/** Type-ahead for the profile screen. Cities first — that is what people mean. */
export async function searchPlaces(q: string, limit = 8): Promise<Place[]> {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const rank = { city: 0, admin1: 1, country: 2 } as const;
  return ALL
    .filter((p) => p.name.toLowerCase().includes(term) || p.label.toLowerCase().includes(term))
    .sort((a, b) =>
      rank[a.kind] - rank[b.kind]
      || Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term))
      || (b.population ?? 0) - (a.population ?? 0)
      || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit));
}

/**
 * Every id at or below the given ones. A city is its own subtree; an admin1
 * covers its cities; a country covers everything in it. This is what makes a
 * local feed for "Karnataka" pick up a story filed in Bengaluru.
 */
export async function expandPlaceIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const out = new Set<string>(ids);       // an id we do not hold still means itself
  for (const id of ids) {
    const q = BY_ID.get(id);
    if (!q) continue;
    out.add(q.id);
    if (q.kind === 'admin1') for (const p of BY_ADMIN1.get(q.id) ?? []) out.add(p.id);
    if (q.kind === 'country') for (const p of BY_COUNTRY.get(q.country) ?? []) out.add(p.id);
  }
  return [...out];
}

/**
 * Places near the reader's, but not in them: the same admin1 first, then the
 * rest of the country. This is what the feed's exploration slot reaches for
 * when it wants somewhere new rather than something new.
 */
export async function geoAdjacentPlaceIds(ids: string[], limit = 60): Promise<string[]> {
  if (!ids.length) return [];
  const qs = ids.map((id) => BY_ID.get(id)).filter((p): p is Place => !!p);
  if (!qs.length) return [];

  // Sharing an admin1 implies sharing a country, so the candidates are the
  // countries the reader is in; the subtree is then subtracted rather than
  // asked for a second time.
  const sub = new Set(await expandPlaceIds(ids));
  const admin1s = new Set(qs.map((q) => q.admin1_id).filter((a): a is string => !!a));
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const q of qs) {
    for (const p of BY_COUNTRY.get(q.country) ?? []) {
      if (sub.has(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  const near = (p: Place) => (p.admin1_id && admin1s.has(p.admin1_id) ? 1 : 0);
  return out
    .sort((a, b) => near(b) - near(a) || (b.population ?? 0) - (a.population ?? 0))
    .slice(0, Math.max(1, limit))
    .map((p) => p.id);
}

/**
 * Coordinates -> the nearest place we know. Only ever called with a location
 * the reader just handed over; the coordinates are not stored anywhere, the
 * returned place is.
 */
export async function nearestPlace(lat: number, lon: number, maxKm = 150): Promise<Place | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const dLat = maxKm / 111;
  // Longitude degrees shrink towards the poles; near them the box degenerates,
  // so fall back to the whole longitude range rather than dividing by ~0.
  const cos = Math.cos(rad(lat));
  const dLon = cos > 0.01 ? maxKm / (111 * cos) : 180;

  const rows = ALL.filter((p) =>
    p.lat !== null && p.lon !== null
    && p.lat >= lat - dLat && p.lat <= lat + dLat
    && p.lon >= lon - dLon && p.lon <= lon + dLon);

  let best: Place | null = null;
  let bestKm = Infinity;
  for (const p of rows) {
    if (p.lat === null || p.lon === null) continue;
    const km = haversineKm({ lat, lon }, { lat: p.lat, lon: p.lon });
    if (km > maxKm) continue;
    // A city is the useful answer; a region row only wins if no city is near.
    const better = best === null ||
      (p.kind === 'city' && best.kind !== 'city') ||
      ((p.kind === 'city') === (best.kind === 'city') && km < bestKm);
    if (better) { best = p; bestKm = km; }
  }
  return best;
}
