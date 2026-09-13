import { d1 } from './d1';
import type { CategoryFacet, PlaceFacet } from '../../shared/types';
export type { CategoryFacet, PlaceFacet };
import { idList, storyCols, STORY_FROM, withPlaceLabels, type Story } from './feed';
import { expandPlaceIds, placesReady } from './places';

// Shape shared with the feed, so an unmigrated store degrades identically here.
const cols = (ready: boolean) => `${storyCols(ready)},
                     0 AS exploration, NULL AS exploration_kind`;
const select = (ready: boolean) => `SELECT ${cols(ready)} ${STORY_FROM}`;

// ---------------------------------------------------------------- saved ---

export async function isSaved(clusterId: string, userId: string): Promise<boolean> {
  return Boolean(await d1().get(
    'SELECT 1 AS one FROM saved WHERE user_id = ? AND cluster_id = ?', [userId, clusterId]));
}

/**
 * Which of these are saved, in one statement.
 *
 * The reels page asked isSaved twenty times, once per story. Promise.all does
 * not rescue that: the D1 interface has no batch, so over the REST backend each
 * is its own HTTPS round trip, and even on the binding it is twenty statements
 * billed. A page that renders twenty stories should ask one question about
 * twenty ids.
 */
export async function savedAmong(clusterIds: string[], userId: string): Promise<Set<string>> {
  if (!clusterIds.length) return new Set();
  const rows = await d1().all<{ cluster_id: string }>(
    `SELECT cluster_id FROM saved WHERE user_id = ? AND cluster_id IN (${idList(clusterIds)})`,
    [userId]);
  return new Set(rows.map((r) => r.cluster_id));
}

export async function toggleSaved(clusterId: string, userId: string): Promise<boolean> {
  const d = d1();
  // DELETE ... RETURNING answers whether there was a row to delete, so the
  // unsave path is one statement where it used to be a SELECT and then a DELETE.
  const gone = await d.get('DELETE FROM saved WHERE user_id = ? AND cluster_id = ? RETURNING 1',
                           [userId, clusterId]);
  if (gone) return false;
  await d.run('INSERT INTO saved (user_id, cluster_id, saved_at) VALUES (?, ?, ?)',
              [userId, clusterId, Date.now()]);
  return true;
}

export async function getSaved(userId: string): Promise<(Story & { saved_at: number })[]> {
  const ready = await placesReady();
  return withPlaceLabels(await d1().all<Story & { saved_at: number }>(
    `SELECT ${cols(ready)}, sv.saved_at
       ${STORY_FROM}
       JOIN saved sv ON sv.cluster_id = c.id
      WHERE sv.user_id = ?
      ORDER BY sv.saved_at DESC`, [userId]));
}

// -------------------------------------------------------------- explore ---

export async function getCategoryFacets(): Promise<CategoryFacet[]> {
  const d = d1();
  const since = Date.now() - 48 * 3_600_000;
  const rows = await d.all<{ category: string; stories: number; sources: number }>(
    `SELECT category, COUNT(*) AS stories, SUM(source_count) AS sources
       FROM clusters WHERE headline IS NOT NULL AND last_seen >= ?
      GROUP BY category ORDER BY stories DESC`, [since]);

  // One query for every category's lead story, rather than one round trip each.
  const ready = await placesReady();
  const leads = withPlaceLabels(await d.all<Story & { rn: number }>(
    `SELECT * FROM (
       SELECT ${cols(ready)}, ROW_NUMBER() OVER (
         PARTITION BY c.category ORDER BY c.importance DESC, c.source_count DESC, c.last_seen DESC) AS rn
         ${STORY_FROM} WHERE c.headline IS NOT NULL AND c.last_seen >= ?
     ) WHERE rn = 1`, [since]));
  const leadBy = new Map(leads.map((l) => [l.category, l]));

  return rows.map((r) => ({ ...r, lead: leadBy.get(r.category) ?? null }));
}

/** Grouped by the canonical place, so "Delhi" and "New Delhi" are one facet.
 *  A cluster the gazetteer could not resolve simply does not appear. */
export async function getPlaceFacets(limit = 18): Promise<PlaceFacet[]> {
  if (!(await placesReady())) return [];   // no gazetteer, no place facets — the category ones still stand
  return d1().all<PlaceFacet>(
    `SELECT p.id AS place_id, p.label, p.kind, p.country, COUNT(*) AS stories
       FROM clusters c JOIN places p ON p.id = c.place_id
      WHERE c.headline IS NOT NULL AND c.last_seen >= ?
      GROUP BY p.id, p.label, p.kind, p.country
      ORDER BY stories DESC LIMIT ?`, [Date.now() - 48 * 3_600_000, limit]);
}

/** A place and everything under it: asking for Karnataka gets Bengaluru too.
 *  D1 caps a statement at ~90 bound parameters and a subtree can be longer, so
 *  the ids are inlined; they are the gazetteer's own slugs, quoted anyway. */
export async function getByPlace(placeId: string, limit = 40): Promise<Story[]> {
  // Empty also when the gazetteer has not been synced, which is why the query
  // below can assume the place columns exist.
  const ids = await expandPlaceIds([placeId]);
  if (!ids.length) return [];
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  return withPlaceLabels(await d1().all<Story>(
    `${select(true)} WHERE c.headline IS NOT NULL AND c.place_id IN (${list})
       ORDER BY c.last_seen DESC LIMIT ?`, [limit]));
}

/**
 * The same query under two headings: these were two functions differing in one
 * column name. The column is named here rather than interpolated from a caller
 * - it is part of the query, not an argument to it.
 */
export async function getByColumn(
  column: 'category' | 'country', value: string, limit = 40,
): Promise<Story[]> {
  const ready = await placesReady();
  return withPlaceLabels(await d1().all<Story>(
    `${select(ready)} WHERE c.headline IS NOT NULL AND c.${column} = ?
       ORDER BY c.last_seen DESC LIMIT ?`, [value, limit]));
}

// ----------------------------------------------------------------- reels ---

/** Reels wants the biggest stories, image-first, newest — not the ranked feed. */
export async function getReels(limit = 20): Promise<Story[]> {
  const ready = await placesReady();
  return withPlaceLabels(await d1().all<Story>(
    `${select(ready)} WHERE c.headline IS NOT NULL AND c.last_seen >= ?
       ORDER BY (c.image_url IS NOT NULL) DESC, c.importance DESC, c.source_count DESC, c.last_seen DESC
       LIMIT ?`, [Date.now() - 48 * 3_600_000, limit]));
}

// ----------------------------------------------------------------- stats ---

/**
 * The profile counters.
 *
 * These used to be six COUNT(*)s, two of them over whole tables, run on every
 * profile render. D1 bills rows read, and nothing deletes articles, so the
 * price of looking at your own profile grew with the age of the database.
 *
 * The pipeline counts them instead — it has the local file open and counting
 * there is free — and leaves the answer in sync_meta beside the cycle stamp.
 * Reading it is one row. Only `saved` is still counted live, because the
 * reader writes it between cycles and a stale number there would be wrong in
 * the one place they would notice.
 */
export async function getStats() {
  const d = d1();
  const [meta, saved] = await Promise.all([
    // sync_meta is written on D1 by sync-d1.ts, so the local SQLite stand-in —
    // the pipeline's own file — has no such table. A missing row and a missing
    // table mean the same thing here, the same way cycleStamp() reads them.
    d.get<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', ['stats'])
      .catch(() => undefined),
    d.get<{ n: number }>('SELECT COUNT(*) AS n FROM saved'),
  ]);
  let r: Record<string, number> = {};
  try { r = meta?.value ? JSON.parse(meta.value) as Record<string, number> : {}; } catch { /* pre-stats sync */ }
  return {
    articles: r.articles ?? 0, clusters: r.clusters ?? 0, summarised: r.summarised ?? 0,
    sources: r.sources ?? 0, saved: saved?.n ?? 0, newest: r.newest ?? 0,
  };
}
