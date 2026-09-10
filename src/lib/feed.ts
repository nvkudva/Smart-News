import { d1 } from './d1';
import { SOURCES, type Bias } from './sources';
import { expandPlaceIds, geoAdjacentPlaceIds, placesReady } from './places';

export type Story = {
  id: string; headline: string; crux: string; category: string;
  place: string | null; country: string | null;
  place_id: string | null; place_label: string | null;
  importance: number;
  image_url: string | null; image_source: string | null;
  article_count: number; source_count: number;
  first_seen: number; last_seen: number;
  framing_left: string | null; framing_centre: string | null; framing_right: string | null;
  exploration: 0 | 1; exploration_kind: 'category' | 'place' | null;
};

export type Prefs = {
  country: string; categories: string[]; places: string[];
  placeIds: string[]; geoConsent: boolean; geoPlaceId: string | null;
};

export const DEFAULT_PREFS: Prefs = {
  country: 'IN',
  categories: ['World', 'India', 'Technology', 'Science'],
  places: ['Bengaluru'],
  placeIds: [],
  geoConsent: false,
  geoPlaceId: null,
};

/**
 * Every Story-shaped read: the label comes from the join, never from a lookup.
 *
 * Until `npm run sync` has migrated the store there is no places table and no
 * c.place_id, so both columns are selected as constant NULLs — the row shape a
 * caller sees is identical either way, and a deploy that lands before the
 * pipeline serves pre-v1.5 stories instead of nothing at all.
 */
export const storyCols = (ready: boolean) => `c.id, c.headline, c.crux, c.category, c.place, c.country,
       ${ready ? 'c.place_id, p.label AS place_label' : 'NULL AS place_id, NULL AS place_label'},
       c.importance, c.image_url, c.image_source,
       c.article_count, c.source_count, c.first_seen, c.last_seen`;
export const storyFrom = (ready: boolean) =>
  ready ? `FROM clusters c LEFT JOIN places p ON p.id = c.place_id` : `FROM clusters c`;

/**
 * D1 caps a statement at ~90 bound parameters and a place subtree can be longer
 * than that, so id lists are inlined instead of bound. They are the gazetteer's
 * own slugs, but quote them anyway.
 */
function idList(ids: string[]): string {
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
}

/** Rows written before v1.5 hold NULL here, and a hand-edited row can hold junk. */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export async function getPrefs(userId = 'local'): Promise<Prefs> {
  const ready = await placesReady();
  const row = await (await d1()).get<{
    country: string; categories: string; places: string;
    place_ids?: string | null; geo_consent?: number | null; geo_place_id?: string | null;
  }>(`SELECT country, categories, places${ready ? ', place_ids, geo_consent, geo_place_id' : ''}
        FROM prefs WHERE user_id = ?`, [userId]);
  if (!row) return DEFAULT_PREFS;
  return {
    country: row.country ?? DEFAULT_PREFS.country,
    categories: parseJsonArray(row.categories),
    places: parseJsonArray(row.places),
    placeIds: parseJsonArray(row.place_ids),
    geoConsent: Boolean(row.geo_consent),
    geoPlaceId: row.geo_place_id ?? null,
  };
}

export async function savePrefs(p: Prefs, userId = 'local') {
  // Without the migration the three v1.5 columns do not exist. Nothing can have
  // set them either — the picker's lookups are all no-ops then — so writing the
  // pre-v1.5 row loses nothing the reader chose.
  if (!(await placesReady())) {
    await (await d1()).run(
      `INSERT INTO prefs (user_id, country, categories, places) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET country=excluded.country,
         categories=excluded.categories, places=excluded.places`,
      [userId, p.country, JSON.stringify(p.categories), JSON.stringify(p.places)]);
    return;
  }
  await (await d1()).run(
    `INSERT INTO prefs (user_id, country, categories, places, place_ids, geo_consent, geo_place_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET country=excluded.country,
       categories=excluded.categories, places=excluded.places,
       place_ids=excluded.place_ids, geo_consent=excluded.geo_consent,
       geo_place_id=excluded.geo_place_id`,
    [userId, p.country, JSON.stringify(p.categories), JSON.stringify(p.places),
     JSON.stringify(p.placeIds), p.geoConsent ? 1 : 0, p.geoPlaceId]);
}

/** The places the feed ranks against: the stated ones plus, only with consent,
 *  the one GPS resolved to. */
export function effectivePlaceIds(p: Prefs): string[] {
  const ids = [...p.placeIds];
  if (p.geoConsent && p.geoPlaceId) ids.push(p.geoPlaceId);
  return [...new Set(ids)];
}

const HALF_LIFE_H = 9;

/**
 * `inside` is the reader's places expanded down the hierarchy. It is null when
 * they have not picked a canonical place yet — every reader until they re-save
 * prefs — and then the place term stays the free-text substring test, so their
 * feed is unchanged.
 */
function score(s: Story, prefs: Prefs, inside: Set<string> | null): number {
  const ageH = (Date.now() - s.last_seen) / 3_600_000;
  const recency = Math.pow(0.5, ageH / HALF_LIFE_H);
  const corroboration = Math.min(1, Math.log1p(s.source_count) / Math.log(25));
  let interest = 0.55;
  if (prefs.categories.includes(s.category)) interest = 1;
  if (s.country && s.country === prefs.country) interest = Math.max(interest, 0.95);
  if (inside) {
    if (s.place_id && inside.has(s.place_id)) interest = 1.15;
  } else if (s.place && prefs.places.some((p) => s.place!.toLowerCase().includes(p.toLowerCase()))) {
    interest = 1.15;
  }
  // importance/5 would span 0.2-1.0 — a 5x swing that decides the order on its
  // own and leaves the other three terms arguing over the remainder. Mapped to
  // 0.6-1.0 it still sorts, but a widely-run story can now outrank a lightly-run
  // one the model happened to like better.
  return recency * (0.35 + 0.65 * corroboration) * (0.5 + 0.1 * s.importance) * interest;
}

/**
 * Ranked feed with a reserved exploration budget: one slot in four goes to a
 * story outside the reader's stated interests, chosen on merit within that set.
 * "Outside" now has two meanings — a category they never picked, or a place
 * near the ones they did — and the reserved slots alternate between them.
 */
export async function getFeed(limit = 30, userId = 'local'): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  const effective = effectivePlaceIds(prefs);
  // One call each for the whole list, never one per place. geoAdjacentPlaceIds
  // already subtracts the reader's own subtree, so `adjacent` is the ring only.
  const inside = effective.length ? new Set(await expandPlaceIds(effective)) : null;
  const adjacent = effective.length ? new Set(await geoAdjacentPlaceIds(effective)) : null;

  const ready = await placesReady();
  const rows = await (await d1()).all<Story>(
    `SELECT ${storyCols(ready)}
       ${storyFrom(ready)}
      WHERE c.headline IS NOT NULL AND c.last_seen >= ?
      ORDER BY c.last_seen DESC LIMIT 400`,
    [Date.now() - 48 * 3_600_000]);

  const scored = rows.map((s) => ({ s, k: score(s, prefs, inside) })).sort((a, b) => b.k - a.k);
  const known = scored.filter(({ s }) => prefs.categories.includes(s.category));
  const novel = scored.filter(({ s }) => !prefs.categories.includes(s.category));
  // Geo-adjacent: near a stated place but not inside it, and not something the
  // known pool would have served anyway.
  const geo = adjacent
    ? scored.filter(({ s }) => s.place_id && adjacent.has(s.place_id)
                               && !prefs.categories.includes(s.category))
    : [];

  // With no stated interests nothing is "outside" them: every story would fall
  // into novel and the marker would make a claim that is false on every card.
  if (known.length === 0) {
    return scored.slice(0, limit)
      .map(({ s }) => ({ ...s, exploration: 0 as const, exploration_kind: null }));
  }

  const budget = Math.ceil(limit / 4);
  const out: Story[] = [];
  const used = new Set<string>();
  // The geo pool is drawn from the same rows as the novel pool, so a story can
  // sit in both; the cursors step over anything already served.
  const skip = (pool: typeof scored, i: number) => {
    while (i < pool.length && used.has(pool[i].s.id)) i++;
    return i;
  };
  const take = (s: Story, kind: Story['exploration_kind']) => {
    out.push({ ...s, exploration: kind ? 1 : 0, exploration_kind: kind });
    used.add(s.id);
  };

  let ki = 0, ni = 0, gi = 0, spent = 0;
  while (out.length < limit) {
    ni = skip(novel, ni);
    gi = skip(geo, gi);
    const wantExplore = out.length > 0 && out.length % 4 === 3 && spent < budget
                        && (ni < novel.length || gi < geo.length);
    if (wantExplore) {
      const useGeo = gi < geo.length && (spent % 2 === 1 || ni >= novel.length);
      if (useGeo) take(geo[gi++].s, 'place');
      else take(novel[ni++].s, 'category');
      spent++;
    }
    else if (ki < known.length) take(known[ki++].s, null);
    else if (ni < novel.length) {
      // Padding past the known set: these are off-interest too, but the reserve
      // is one slot in four, so stamp only while the budget lasts.
      const explore = spent < budget;
      if (explore) spent++;
      take(novel[ni++].s, explore ? 'category' : null);
    }
    else break;
  }
  return out;
}

/**
 * The reader's own places, over a 7-day window because city-level news is far
 * thinner than the 48 hours the main feed lives in. A reader whose typed places
 * never resolved to an id still gets the free-text match, so the surface is not
 * empty for them; a reader who has named no place at all gets nothing, and
 * nothing thrown.
 */
export async function getLocalFeed(limit = 30, userId = 'local'): Promise<Story[]> {
  try {
    const prefs = await getPrefs(userId);
    const effective = effectivePlaceIds(prefs);
    const since = Date.now() - 7 * 24 * 3_600_000;
    const d = await d1();
    const ready = await placesReady();

    let rows: Story[] = [];
    let inside: Set<string> | null = null;
    const ids = ready && effective.length ? await expandPlaceIds(effective) : [];
    if (ids.length) {
      inside = new Set(ids);
      rows = await d.all<Story>(
        `SELECT ${storyCols(ready)}
           ${storyFrom(ready)}
          WHERE c.headline IS NOT NULL AND c.last_seen >= ?
            AND c.place_id IN (${idList(ids)})
          ORDER BY c.last_seen DESC LIMIT 200`, [since]);
    } else if (prefs.places.length) {
      const where = prefs.places.map(() => `LOWER(c.place) LIKE '%' || LOWER(?) || '%'`).join(' OR ');
      rows = await d.all<Story>(
        `SELECT ${storyCols(ready)}
           ${storyFrom(ready)}
          WHERE c.headline IS NOT NULL AND c.last_seen >= ? AND c.place IS NOT NULL AND (${where})
          ORDER BY c.last_seen DESC LIMIT 200`, [since, ...prefs.places]);
    } else {
      return [];
    }

    return rows.map((s) => ({ s, k: score(s, prefs, inside) }))
      .sort((a, b) => b.k - a.k)
      .slice(0, limit)
      .map(({ s }) => ({ ...s, exploration: 0 as const, exploration_kind: null }));
  } catch {
    return [];
  }
}

export async function getStory(id: string) {
  const d = await d1();
  const cluster = await d.get<Story>('SELECT * FROM clusters WHERE id = ?', [id]);
  if (!cluster) return null;
  const articles = await d.all<{ title: string; url: string; published_at: number;
                                 source: string; homepage: string; bias: Bias | null }>(
    `SELECT a.title, a.url, a.published_at, s.name AS source, s.homepage, s.bias
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ? ORDER BY a.published_at ASC`, [id]);

  // The whole row, not four columns: the related list renders real cards now, so
  // it needs the crux, the photograph and the place the card foot reads. Six of
  // them on one indexed category filter is not a query worth economising on.
  const related = await d.all<Story>(
    `SELECT * FROM clusters
      WHERE category = ? AND id != ? AND headline IS NOT NULL
      ORDER BY last_seen DESC LIMIT 6`, [cluster.category, id]);

  return { cluster, articles, related, coverage: coverageOf(articles) };
}

export type Coverage = {
  /** Distinct outlets per side — outlets, not articles: one paper filing six
   *  times is one voice, and counting articles would let it drown the rest. */
  counts: Record<Bias, number>;
  total: number;
  /** The side holding at least BLINDSPOT_SHARE of the outlets, if any. */
  dominant: Bias | null;
  /** Sides with a rating that ran nothing. Only meaningful once `total` is
   *  large enough that silence is a choice rather than a small sample. */
  missing: Bias[];
  rated: number;
  unrated: number;
};

const BLINDSPOT_SHARE = 0.75;
const BLINDSPOT_MIN_OUTLETS = 5;

/**
 * A side can only be *missing* from a story if we read enough of that side for
 * its silence to mean anything. We rate 4 right outlets against 25 centre, so
 * "no right-leaning outlet ran this" would fire on most stories and would be a
 * fact about our source list, not about the coverage. Sides below the floor
 * still count in the split bar — they just never generate a blindspot claim.
 */
const MIN_OUTLETS_TO_CLAIM_SILENCE = 5;
const CORPUS: Record<Bias, number> = SOURCES.reduce(
  (acc, s) => { acc[s.bias]++; return acc; },
  { left: 0, centre: 0, right: 0 } as Record<Bias, number>);

export function coverageOf(articles: { source: string; bias: Bias | null }[]): Coverage {
  const bySource = new Map<string, Bias | null>();
  for (const a of articles) if (!bySource.has(a.source)) bySource.set(a.source, a.bias);

  const counts: Record<Bias, number> = { left: 0, centre: 0, right: 0 };
  let unrated = 0;
  for (const bias of bySource.values()) {
    if (bias === 'left' || bias === 'centre' || bias === 'right') counts[bias]++;
    else unrated++;
  }
  const rated = counts.left + counts.centre + counts.right;

  const dominant = (Object.keys(counts) as Bias[]).find(
    (b) => rated >= BLINDSPOT_MIN_OUTLETS && counts[b] / rated >= BLINDSPOT_SHARE) ?? null;

  return {
    counts, total: bySource.size, dominant, rated, unrated,
    missing: rated >= BLINDSPOT_MIN_OUTLETS
      ? (Object.keys(counts) as Bias[]).filter(
          (b) => counts[b] === 0 && CORPUS[b] >= MIN_OUTLETS_TO_CLAIM_SILENCE)
      : [],
  };
}

export async function logEvent(clusterId: string, kind: string, dwellMs?: number, userId = 'local') {
  await (await d1()).run(
    'INSERT INTO events (user_id, cluster_id, kind, dwell_ms, ts) VALUES (?, ?, ?, ?, ?)',
    [userId, clusterId, kind, dwellMs ?? null, Date.now()]);
}
