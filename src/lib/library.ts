import { d1 } from './d1';
import type { Story } from './feed';

const SELECT_COLS = `id, headline, crux, category, place, country, importance, image_url,
                     article_count, source_count, last_seen, 0 AS exploration`;
const SELECT = `SELECT ${SELECT_COLS} FROM clusters`;

// ---------------------------------------------------------------- saved ---

export async function isSaved(clusterId: string, userId = 'local'): Promise<boolean> {
  return Boolean(await (await d1()).get(
    'SELECT 1 AS one FROM saved WHERE user_id = ? AND cluster_id = ?', [userId, clusterId]));
}

export async function toggleSaved(clusterId: string, userId = 'local'): Promise<boolean> {
  const d = await d1();
  if (await isSaved(clusterId, userId)) {
    await d.run('DELETE FROM saved WHERE user_id = ? AND cluster_id = ?', [userId, clusterId]);
    return false;
  }
  await d.run('INSERT INTO saved (user_id, cluster_id, saved_at) VALUES (?, ?, ?)',
              [userId, clusterId, Date.now()]);
  return true;
}

export async function getSaved(userId = 'local'): Promise<(Story & { saved_at: number })[]> {
  return (await d1()).all<Story & { saved_at: number }>(
    `SELECT c.id, c.headline, c.crux, c.category, c.place, c.country, c.importance,
            c.image_url, c.article_count, c.source_count, c.last_seen,
            0 AS exploration, s.saved_at
       FROM clusters c
       JOIN saved s ON s.cluster_id = c.id
      WHERE s.user_id = ?
      ORDER BY s.saved_at DESC`, [userId]);
}

// -------------------------------------------------------------- explore ---

export type CategoryFacet = { category: string; stories: number; sources: number; lead: Story | null };

export async function getCategoryFacets(): Promise<CategoryFacet[]> {
  const d = await d1();
  const since = Date.now() - 48 * 3_600_000;
  const rows = await d.all<{ category: string; stories: number; sources: number }>(
    `SELECT category, COUNT(*) AS stories, SUM(source_count) AS sources
       FROM clusters WHERE headline IS NOT NULL AND last_seen >= ?
      GROUP BY category ORDER BY stories DESC`, [since]);

  // One query for every category's lead story, rather than one round trip each.
  const leads = await d.all<Story & { rn: number }>(
    `SELECT * FROM (
       SELECT ${SELECT_COLS}, ROW_NUMBER() OVER (
         PARTITION BY category ORDER BY importance DESC, source_count DESC, last_seen DESC) AS rn
         FROM clusters WHERE headline IS NOT NULL AND last_seen >= ?
     ) WHERE rn = 1`, [since]);
  const leadBy = new Map(leads.map((l) => [l.category, l]));

  return rows.map((r) => ({ ...r, lead: leadBy.get(r.category) ?? null }));
}

export type PlaceFacet = { country: string; place: string | null; stories: number };

export async function getPlaceFacets(limit = 18): Promise<PlaceFacet[]> {
  return (await d1()).all<PlaceFacet>(
    `SELECT country, MIN(place) AS place, COUNT(*) AS stories
       FROM clusters WHERE headline IS NOT NULL AND country IS NOT NULL AND last_seen >= ?
      GROUP BY country ORDER BY stories DESC LIMIT ?`, [Date.now() - 48 * 3_600_000, limit]);
}

export async function getByCategory(category: string, limit = 40): Promise<Story[]> {
  return (await d1()).all<Story>(
    `${SELECT} WHERE headline IS NOT NULL AND category = ?
       ORDER BY last_seen DESC LIMIT ?`, [category, limit]);
}

export async function getByCountry(country: string, limit = 40): Promise<Story[]> {
  return (await d1()).all<Story>(
    `${SELECT} WHERE headline IS NOT NULL AND country = ?
       ORDER BY last_seen DESC LIMIT ?`, [country, limit]);
}

// ----------------------------------------------------------------- reels ---

/** Reels wants the biggest stories, image-first, newest — not the ranked feed. */
export async function getReels(limit = 20): Promise<Story[]> {
  return (await d1()).all<Story>(
    `${SELECT} WHERE headline IS NOT NULL AND last_seen >= ?
       ORDER BY (image_url IS NOT NULL) DESC, importance DESC, source_count DESC, last_seen DESC
       LIMIT ?`, [Date.now() - 48 * 3_600_000, limit]);
}

// ----------------------------------------------------------------- stats ---

export async function getStats() {
  // One round trip: D1 is remote, and six counts are six requests otherwise.
  const r = await (await d1()).get<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM articles) AS articles,
            (SELECT COUNT(*) FROM clusters) AS clusters,
            (SELECT COUNT(*) FROM clusters WHERE headline IS NOT NULL) AS summarised,
            (SELECT COUNT(*) FROM sources) AS sources,
            (SELECT COUNT(*) FROM saved) AS saved,
            (SELECT MAX(last_seen) FROM clusters) AS newest`);
  return {
    articles: r?.articles ?? 0, clusters: r?.clusters ?? 0, summarised: r?.summarised ?? 0,
    sources: r?.sources ?? 0, saved: r?.saved ?? 0, newest: r?.newest ?? 0,
  };
}
