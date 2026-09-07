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
 */

import { d1 } from './d1';

export type PlaceKind = 'city' | 'admin1' | 'country';

export type Place = {
  id: string; kind: PlaceKind; name: string; label: string; country: string;
  admin1_id: string | null; parent_id: string | null;
  lat: number | null; lon: number | null; population: number | null;
};

const COLS = 'id,kind,name,label,country,admin1_id,parent_id,lat,lon,population';

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

const holes = (n: number) => Array.from({ length: n }, () => '?').join(',');

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
  if (!ids.length || !(await placesReady())) return [];
  const db = await d1();
  const rows = await db.all<Place>(`SELECT ${COLS} FROM places WHERE id IN (${holes(ids.length)})`, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((p): p is Place => !!p);
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
  if (!text || !(await placesReady())) return null;
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
  const db = await d1();
  const rows = await db.all<Place & { _alias: string; _country: string }>(
    `SELECT p.${COLS.split(',').join(',p.')}, a.alias AS _alias, a.country AS _country
       FROM place_aliases a JOIN places p ON p.id = a.place_id
      WHERE a.alias IN (${holes(aliases.length)}) AND a.country IN (${holes(countries.length)})`,
    [...aliases, ...countries],
  );
  if (!rows.length) return null;

  // One round trip returns every match; the priority order is applied here.
  for (const alias of aliases) {
    for (const c of countries) {
      const hit = rows.find((r) => r._alias === alias && r._country === c);
      if (hit) return strip(hit);
    }
  }
  return null;
}

function strip(row: Place & Record<string, unknown>): Place {
  return {
    id: row.id, kind: row.kind, name: row.name, label: row.label, country: row.country,
    admin1_id: row.admin1_id, parent_id: row.parent_id,
    lat: row.lat, lon: row.lon, population: row.population,
  };
}

/** Type-ahead for the profile screen. Cities first — that is what people mean. */
export async function searchPlaces(q: string, limit = 8): Promise<Place[]> {
  const term = q.trim();
  if (!term || !(await placesReady())) return [];
  const db = await d1();
  const like = `%${term.replace(/[%_]/g, '')}%`;
  const prefix = `${term.replace(/[%_]/g, '')}%`;
  return db.all<Place>(
    `SELECT ${COLS} FROM places
      WHERE name LIKE ? OR label LIKE ?
      ORDER BY CASE kind WHEN 'city' THEN 0 WHEN 'admin1' THEN 1 ELSE 2 END,
               CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
               COALESCE(population, 0) DESC,
               name
      LIMIT ?`,
    [like, like, prefix, Math.max(1, limit)],
  );
}

/**
 * Every id at or below the given ones. A city is its own subtree; an admin1
 * covers its cities; a country covers everything in it. This is what makes a
 * local feed for "Karnataka" pick up a story filed in Bengaluru.
 */
export async function expandPlaceIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  if (!(await placesReady())) return [];
  const db = await d1();
  // Self-join instead of two trips: q is the reader's places, p the candidates.
  const rows = await db.all<{ id: string }>(
    `SELECT DISTINCT p.id AS id
       FROM places p JOIN places q ON q.id IN (${holes(ids.length)})
      WHERE p.id = q.id
         OR (q.kind = 'admin1'  AND p.admin1_id = q.id)
         OR (q.kind = 'country' AND p.country   = q.country)`,
    ids,
  );
  const out = new Set(rows.map((r) => r.id));
  for (const id of ids) out.add(id);      // an id we do not hold still means itself
  return [...out];
}

/**
 * Places near the reader's, but not in them: the same admin1 first, then the
 * rest of the country. This is what the feed's exploration slot reaches for
 * when it wants somewhere new rather than something new.
 */
export async function geoAdjacentPlaceIds(ids: string[], limit = 60): Promise<string[]> {
  if (!ids.length || !(await placesReady())) return [];
  const db = await d1();
  // Sharing an admin1 implies sharing a country, so one WHERE covers both, and
  // the subtree is excluded in the HAVING rather than in a second query.
  const rows = await db.all<{ id: string }>(
    `SELECT p.id AS id,
            MAX(CASE WHEN p.id = q.id
                       OR (q.kind = 'admin1'  AND p.admin1_id = q.id)
                       OR (q.kind = 'country' AND p.country   = q.country)
                     THEN 1 ELSE 0 END) AS sub,
            MAX(CASE WHEN p.admin1_id IS NOT NULL AND p.admin1_id = q.admin1_id
                     THEN 1 ELSE 0 END) AS near
       FROM places p JOIN places q ON q.id IN (${holes(ids.length)})
      WHERE p.country = q.country
      GROUP BY p.id
     HAVING sub = 0
      ORDER BY near DESC, COALESCE(p.population, 0) DESC
      LIMIT ?`,
    [...ids, Math.max(1, limit)],
  );
  return rows.map((r) => r.id);
}

/**
 * Coordinates -> the nearest place we know. Only ever called with a location
 * the reader just handed over; the coordinates are not stored anywhere, the
 * returned place is.
 */
export async function nearestPlace(lat: number, lon: number, maxKm = 150): Promise<Place | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!(await placesReady())) return null;
  const dLat = maxKm / 111;
  // Longitude degrees shrink towards the poles; near them the box degenerates,
  // so fall back to the whole longitude range rather than dividing by ~0.
  const cos = Math.cos(rad(lat));
  const dLon = cos > 0.01 ? maxKm / (111 * cos) : 180;

  const db = await d1();
  const rows = await db.all<Place>(
    `SELECT ${COLS} FROM places
      WHERE lat IS NOT NULL AND lon IS NOT NULL
        AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
    [lat - dLat, lat + dLat, lon - dLon, lon + dLon],
  );

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
