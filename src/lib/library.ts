import { db } from './db';
import type { Story } from './feed';

const SELECT = `SELECT id, headline, crux, category, place, country, importance, image_url,
                       article_count, source_count, last_seen, 0 AS exploration
                  FROM clusters`;

// ---------------------------------------------------------------- saved ---

export function isSaved(clusterId: string, userId = 'local'): boolean {
  return Boolean(db().prepare('SELECT 1 FROM saved WHERE user_id = ? AND cluster_id = ?')
    .get(userId, clusterId));
}

export function toggleSaved(clusterId: string, userId = 'local'): boolean {
  const d = db();
  if (isSaved(clusterId, userId)) {
    d.prepare('DELETE FROM saved WHERE user_id = ? AND cluster_id = ?').run(userId, clusterId);
    return false;
  }
  d.prepare('INSERT INTO saved (user_id, cluster_id, saved_at) VALUES (?, ?, ?)')
    .run(userId, clusterId, Date.now());
  return true;
}

export function getSaved(userId = 'local'): (Story & { saved_at: number })[] {
  return db().prepare(
    `SELECT c.id, c.headline, c.crux, c.category, c.place, c.country, c.importance,
            c.image_url, c.article_count, c.source_count, c.last_seen,
            0 AS exploration, s.saved_at
       FROM clusters c
       JOIN saved s ON s.cluster_id = c.id
      WHERE s.user_id = ?
      ORDER BY s.saved_at DESC`,
  ).all(userId) as unknown as (Story & { saved_at: number })[];
}

// -------------------------------------------------------------- explore ---

export type CategoryFacet = { category: string; stories: number; sources: number; lead: Story | null };

export function getCategoryFacets(): CategoryFacet[] {
  const d = db();
  const rows = d.prepare(
    `SELECT category, COUNT(*) AS stories, SUM(source_count) AS sources
       FROM clusters WHERE headline IS NOT NULL AND last_seen >= ?
      GROUP BY category ORDER BY stories DESC`,
  ).all(Date.now() - 48 * 3_600_000) as unknown as { category: string; stories: number; sources: number }[];

  const leadOf = d.prepare(
    `${SELECT} WHERE headline IS NOT NULL AND category = ? AND last_seen >= ?
       ORDER BY importance DESC, source_count DESC, last_seen DESC LIMIT 1`);

  return rows.map((r) => ({
    ...r,
    lead: (leadOf.get(r.category, Date.now() - 48 * 3_600_000) ?? null) as Story | null,
  }));
}

export type PlaceFacet = { country: string; place: string | null; stories: number };

export function getPlaceFacets(limit = 18): PlaceFacet[] {
  return db().prepare(
    `SELECT country, MIN(place) AS place, COUNT(*) AS stories
       FROM clusters WHERE headline IS NOT NULL AND country IS NOT NULL AND last_seen >= ?
      GROUP BY country ORDER BY stories DESC LIMIT ?`,
  ).all(Date.now() - 48 * 3_600_000, limit) as unknown as PlaceFacet[];
}

export function getByCategory(category: string, limit = 40): Story[] {
  return db().prepare(
    `${SELECT} WHERE headline IS NOT NULL AND category = ?
       ORDER BY last_seen DESC LIMIT ?`).all(category, limit) as unknown as Story[];
}

export function getByCountry(country: string, limit = 40): Story[] {
  return db().prepare(
    `${SELECT} WHERE headline IS NOT NULL AND country = ?
       ORDER BY last_seen DESC LIMIT ?`).all(country, limit) as unknown as Story[];
}

// ----------------------------------------------------------------- reels ---

/** Reels wants the biggest stories, image-first, newest — not the ranked feed. */
export function getReels(limit = 20): Story[] {
  return db().prepare(
    `${SELECT} WHERE headline IS NOT NULL AND last_seen >= ?
       ORDER BY (image_url IS NOT NULL) DESC, importance DESC, source_count DESC, last_seen DESC
       LIMIT ?`).all(Date.now() - 48 * 3_600_000, limit) as unknown as Story[];
}

// ----------------------------------------------------------------- stats ---

export function getStats() {
  const d = db();
  const one = (sql: string, ...args: unknown[]) =>
    (d.prepare(sql).get(...(args as never[])) as { n: number }).n;
  return {
    articles: one('SELECT COUNT(*) n FROM articles'),
    clusters: one('SELECT COUNT(*) n FROM clusters'),
    summarised: one('SELECT COUNT(*) n FROM clusters WHERE headline IS NOT NULL'),
    sources: one('SELECT COUNT(*) n FROM sources'),
    saved: one('SELECT COUNT(*) n FROM saved'),
    newest: (d.prepare('SELECT MAX(last_seen) n FROM clusters').get() as { n: number }).n,
  };
}
