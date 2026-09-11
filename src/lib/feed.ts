import { cache } from 'react';
import { d1 } from './d1';
import { type Bias } from './sources';
import { coverageOf } from './coverage';
import { expandPlaceIds, geoAdjacentPlaceIds, placeLabel, placesReady } from './places';
import { matchesSub } from './taxonomy';

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
  /**
   * Categories the reader has switched off, which is a different question from
   * the ones they are interested in. `categories` only ever ranked — an
   * unchecked category still appeared, deliberately, because a quarter of the
   * feed is reserved for what the reader has not asked for. This removes.
   */
  hidden: string[];
};

export const DEFAULT_PREFS: Prefs = {
  country: 'IN',
  categories: ['Technology', 'Business', 'World', 'Science'],
  places: ['Bengaluru'],
  placeIds: [],
  geoConsent: false,
  geoPlaceId: null,
  hidden: [],
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
       ${ready ? 'c.place_id' : 'NULL AS place_id'}, NULL AS place_label,
       c.importance, c.image_url, c.image_source,
       c.article_count, c.source_count, c.first_seen, c.last_seen`;
export const storyFrom = (_ready: boolean) => `FROM clusters c`;

/**
 * The label the LEFT JOIN used to supply. It was one indexed lookup per
 * candidate row — 87 of the 237 rows a feed query billed — for a string that
 * has been in the bundle since gazetteer.gen.ts existed. Every query built from
 * storyCols passes its rows through here instead.
 */
export function withPlaceLabels<T extends { place_id: string | null; place_label: string | null }>(
  rows: T[],
): T[] {
  return rows.map((r) => (r.place_id ? { ...r, place_label: placeLabel(r.place_id) } : r));
}

/**
 * D1 caps a statement at ~90 bound parameters and a place subtree can be longer
 * than that, so id lists are inlined instead of bound. They are the gazetteer's
 * own slugs, but quote them anyway.
 */
/** One link per masthead, which is all the story page renders: it dedupes
 *  articles by source and shows the outlet's name against a single URL. */
export type Outlet = { source: string; url: string; bias: Bias | null };

export type Article = {
  title: string; url: string; published_at: number;
  source: string; homepage: string; bias: Bias | null;
};

export function idList(ids: string[]): string {
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

/**
 * A fingerprint of the preferences a ranked answer was built against. Anything
 * keyed on it — the isolate map, an ETag — is invalidated by a save changing
 * the value rather than by waiting out a clock.
 */
export function prefsFingerprint(p: Prefs): string {
  const flat = `${p.country}|${p.categories.join(',')}|${p.places.join(',')}`
             + `|${p.placeIds.join(',')}|${p.geoConsent ? 1 : 0}|${p.geoPlaceId ?? ''}`
             + `|${p.hidden.join(',')}`;
  let h = 5381;
  for (let i = 0; i < flat.length; i++) h = ((h * 33) ^ flat.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Wrapped in React's `cache` so the several places that need the reader's prefs
 * inside one request — the section's cache key and then the ranking itself —
 * share a single D1 round trip instead of each paying for their own.
 */
export const getPrefs = cache(uncachedGetPrefs);

async function uncachedGetPrefs(userId: string): Promise<Prefs> {
  const ready = await placesReady();
  const row = await (await d1()).get<{
    country: string; categories: string; places: string;
    place_ids?: string | null; geo_consent?: number | null; geo_place_id?: string | null;
    hidden?: string | null;
  }>(`SELECT country, categories, places${ready ? ', place_ids, geo_consent, geo_place_id, hidden' : ''}
        FROM prefs WHERE user_id = ?`, [userId]);
  if (!row) return DEFAULT_PREFS;
  return {
    country: row.country ?? DEFAULT_PREFS.country,
    categories: parseJsonArray(row.categories),
    places: parseJsonArray(row.places),
    placeIds: parseJsonArray(row.place_ids),
    geoConsent: Boolean(row.geo_consent),
    geoPlaceId: row.geo_place_id ?? null,
    hidden: parseJsonArray(row.hidden),
  };
}

export async function savePrefs(p: Prefs, userId: string) {
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
    `INSERT INTO prefs (user_id, country, categories, places, place_ids, geo_consent, geo_place_id, hidden)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET country=excluded.country,
       categories=excluded.categories, places=excluded.places,
       place_ids=excluded.place_ids, geo_consent=excluded.geo_consent,
       geo_place_id=excluded.geo_place_id, hidden=excluded.hidden`,
    [userId, p.country, JSON.stringify(p.categories), JSON.stringify(p.places),
     JSON.stringify(p.placeIds), p.geoConsent ? 1 : 0, p.geoPlaceId,
     JSON.stringify(p.hidden)]);
}

/** The places the feed ranks against: the stated ones plus, only with consent,
 *  the one GPS resolved to. */
export function effectivePlaceIds(p: Prefs): string[] {
  const ids = [...p.placeIds];
  if (p.geoConsent && p.geoPlaceId) ids.push(p.geoPlaceId);
  return [...new Set(ids)];
}

/**
 * Who this feed is for.
 *
 * `interest` answers whether the reader asked for a category at all; this
 * answers how much this particular readership cares once they have. The two
 * multiply, so a category can be both chosen and merely tolerated. The
 * readership is engineers and AI practitioners who also follow markets, so
 * Technology leads and Business follows it — and nothing is pushed below 1,
 * because down-weighting a category is what the exploration slot and the
 * reader's own choices are for.
 */
const AUDIENCE: Record<string, number> = {
  Technology: 1.35,
  Business: 1.15,
  Science: 1.05,
};

/**
 * "Global news with a large economic impact" is not a category — it is a
 * property that cuts across Business, World and Politics, and the same tariff
 * ruling can be filed under any of the three. So it is read off the text
 * rather than the label, reusing the keyword lists that already define the
 * Business sub-categories: they were measured against this store, and a second
 * hand-tuned list would only drift from them.
 *
 * Scaled by corroboration rather than applied flat, because breadth is what
 * separates a decision that moved markets from a column predicting one. At six
 * outlets it is the full quarter; at one it is almost nothing.
 */
const MACRO_SUBS: readonly (readonly [string, string])[] = [
  ['business', 'markets'], ['business', 'economy'],
  ['business', 'trade-tariffs'], ['business', 'energy-commodities'],
  // Crypto counts as an asset class here, not as a gadget: a readership that
  // follows markets reads a Bitcoin move the way it reads a rate decision. The
  // pill exists under Technology too, and either filing earns the lift.
  ['business', 'crypto'], ['technology', 'crypto'],
];

function macroLift(s: Story): number {
  if (!MACRO_SUBS.some(([cat, sub]) => matchesSub(cat, sub, s))) return 1;
  return 1 + 0.25 * Math.min(1, s.source_count / 6);
}

const HALF_LIFE_H = 9;

/**
 * How far back the ranker is willing to look. Every row in here is a row D1
 * bills, and the half-life above is what makes the far end worthless: at 24
 * hours recency is already 0.16, at 48 it is 0.024, so the second day was
 * paying for candidates the score had buried anyway. The LIMIT beside it is set
 * to bind — at 400 it never did, so the window alone decided the cost.
 */
const CANDIDATE_WINDOW_H = 24;

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
  return recency * (0.35 + 0.65 * corroboration) * (0.5 + 0.1 * s.importance) * interest
         * (AUDIENCE[s.category] ?? 1) * macroLift(s);
}

/**
 * Drop the categories the reader switched off.
 *
 * Applied to the rows rather than folded into each WHERE: three queries would
 * each need the clause and the list is usually empty, so the cost is one pass
 * over rows already in hand against three more bound parameters on every read.
 *
 * Not applied to a topic section. Asking for /c/sports is an explicit request
 * for sports, and answering it with nothing because sports is hidden would be
 * obtuse — the category simply does not appear in the strip to be asked for.
 */
export function withoutHidden<T extends { category: string }>(rows: T[], p: Prefs): T[] {
  if (!p.hidden.length) return rows;
  const off = new Set(p.hidden);
  return rows.filter((r) => !off.has(r.category));
}

/**
 * Ranked feed with a reserved exploration budget: one slot in four goes to a
 * story outside the reader's stated interests, chosen on merit within that set.
 * "Outside" now has two meanings — a category they never picked, or a place
 * near the ones they did — and the reserved slots alternate between them.
 */
export async function getFeed(limit: number, userId: string): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  const effective = effectivePlaceIds(prefs);
  // One call each for the whole list, never one per place. geoAdjacentPlaceIds
  // already subtracts the reader's own subtree, so `adjacent` is the ring only.
  const inside = effective.length ? new Set(await expandPlaceIds(effective)) : null;
  const adjacent = effective.length ? new Set(await geoAdjacentPlaceIds(effective)) : null;

  const ready = await placesReady();
  const rows = withPlaceLabels(await (await d1()).all<Story>(
    `SELECT ${storyCols(ready)}
       ${storyFrom(ready)}
      WHERE c.headline IS NOT NULL AND c.last_seen >= ?
      ORDER BY c.last_seen DESC LIMIT 150`,
    [Date.now() - CANDIDATE_WINDOW_H * 3_600_000]));

  const scored = withoutHidden(rows, prefs)
    .map((s) => ({ s, k: score(s, prefs, inside) })).sort((a, b) => b.k - a.k);
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
export async function getLocalFeed(limit: number, userId: string): Promise<Story[]> {
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

    return withoutHidden(withPlaceLabels(rows), prefs).map((s) => ({ s, k: score(s, prefs, inside) }))
      .sort((a, b) => b.k - a.k)
      .slice(0, limit)
      .map(({ s }) => ({ ...s, exploration: 0 as const, exploration_kind: null }));
  } catch {
    return [];
  }
}

export async function getStory(id: string) {
  const d = await d1();
  const cluster = withPlaceLabels(await d.all<Story>('SELECT * FROM clusters WHERE id = ?', [id]))[0];
  if (!cluster) return null;

  // Issued together. Neither needs the other's answer — related needs only the
  // category, which the cluster row already gave us — and each is a round trip
  // to a database on the far side of the network, so awaiting them in turn was
  // paying that distance twice to learn two unrelated facts.
  const [articles, related] = await Promise.all([
    d.all<Article>(
      `SELECT a.title, a.url, a.published_at, s.name AS source, s.homepage, s.bias
         FROM articles a JOIN sources s ON s.id = a.source_id
        WHERE a.cluster_id = ? ORDER BY a.published_at ASC`, [id]),
    // The whole row, not four columns: the related list renders real cards now,
    // so it needs the crux, the photograph and the place the card foot reads.
    // Six of them on one indexed category filter is not worth economising on.
    d.all<Story>(
      `SELECT * FROM clusters
        WHERE category = ? AND id != ? AND headline IS NOT NULL
        ORDER BY last_seen DESC LIMIT 6`, [cluster.category, id]),
  ]);

  return {
    cluster, articles, related: withPlaceLabels(related), coverage: coverageOf(articles),
  };
}
