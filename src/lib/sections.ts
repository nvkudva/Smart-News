import { d1 } from './d1';
import {
  getFeed, getLocalFeed, getPrefs, prefsFingerprint, storyCols, storyFrom, withPlaceLabels,
  type Story,
} from './feed';
import { cycleStamp } from './cycle';
import { placesReady } from './places';
import { categoryBySlug, type Section } from './taxonomy';

/**
 * The query layer behind the category strip. Every function here returns the
 * section's rows ONCE: the page renders them and derives its sub-category
 * counts from the same array, so a strip of eight pills still costs one query.
 *
 * Nothing new is stored. Local reads place_id through the gazetteer, National
 * and International read the country the cluster already carries. A cluster
 * with a NULL country belongs to neither, which is correct — it is unplaced.
 */

const WINDOW_MS = 48 * 3_600_000;

/** Generous by design: the counts under the strip describe the whole section,
 *  not the first screen of it. */
export const SECTION_LIMIT = 200;

/** How many of those actually reach the page. The counts need every row; the
 *  reader needs the first few screens, and rendering all 200 was most of what
 *  made switching categories feel slow. */
export const SECTION_PAGE = 48;

const stamp = (rows: Story[]): Story[] =>
  rows.map((s) => ({ ...s, exploration: 0 as const, exploration_kind: null }));

async function bySql(where: string, params: unknown[], limit: number): Promise<Story[]> {
  const ready = await placesReady();
  const rows = withPlaceLabels(await (await d1()).all<Story>(
    `SELECT ${storyCols(ready)}
       ${storyFrom(ready)}
      WHERE c.headline IS NOT NULL AND c.last_seen >= ? AND ${where}
      ORDER BY c.importance DESC, c.last_seen DESC LIMIT ${limit}`,
    [Date.now() - WINDOW_MS, ...params]));
  return stamp(rows);
}

/** The reader's own places. Delegates so /local and the Local tab can never
 *  disagree about what "local" means, including the pre-v1.5 free-text
 *  fallback and the empty-on-unmigrated-D1 degradation. */
export function getLocalSection(limit: number, userId: string): Promise<Story[]> {
  return getLocalFeed(limit, userId);
}

export async function getNationalSection(limit: number, userId: string): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  return bySql('c.country = ?', [prefs.country], limit);
}

export async function getInternationalSection(limit: number, userId: string): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  return bySql('c.country IS NOT NULL AND c.country <> ?', [prefs.country], limit);
}

export function getTopicSection(category: string, limit = SECTION_LIMIT): Promise<Story[]> {
  return bySql('c.category = ?', [category], limit);
}

/**
 * A section costs two D1 round trips and up to 200 rows, and the pipeline only
 * moves every fifteen minutes, so re-running it for each tap on the strip is
 * pure latency. The map lives in module scope: on Workers that is the isolate,
 * which serves many requests, and on a cold isolate it is simply empty.
 *
 * Keyed on the cycle stamp rather than expired by a clock. The stamp is derived
 * from the data and moves only when the readable feed could have changed, so an
 * entry is good until it is actually wrong — a section is queried once per
 * cycle instead of once a minute, and the fifty-nine other minutes' worth of
 * round trips never happen. A stamp of null (no sync_meta yet) falls back to a
 * short TTL, which is the old behaviour and the only honest answer when there
 * is nothing to version against.
 *
 * Promises, not results, are cached — two readers landing on the same section
 * at once then share one query instead of racing.
 */
const NO_STAMP_TTL_MS = 60_000;
const warm = new Map<string, { stamp: string; at: number; rows: Promise<Story[]> }>();

function cached(key: string, stamp: string | null, run: () => Promise<Story[]>): Promise<Story[]> {
  const version = stamp ?? 'none';
  const hit = warm.get(key);
  const fresh = hit && hit.stamp === version
    && (stamp !== null || Date.now() - hit.at < NO_STAMP_TTL_MS);
  if (fresh) return hit.rows;

  const rows = run();
  warm.set(key, { stamp: version, at: Date.now(), rows });
  // A failed query must not be remembered as this section's answer for a cycle.
  rows.catch(() => { if (warm.get(key)?.rows === rows) warm.delete(key); });

  // Everything from an older cycle is dead the moment the stamp moves, so the
  // map never carries more than the sections this isolate served this cycle.
  for (const [k, v] of warm) if (v.stamp !== version) warm.delete(k);
  return rows;
}

/**
 * One entry point for the strip. Returns null for a slug outside the taxonomy so
 * the caller can 404 rather than render an empty section, which a reader would
 * read as a quiet news day.
 */
export async function getSection(
  slug: string, limit = SECTION_LIMIT, userId: string,
): Promise<{ category: Section; stories: Story[] } | null> {
  const category = categoryBySlug(slug);
  if (!category) return null;

  // A topic section is the same rows for everyone, so it is keyed without a
  // reader at all; the four that rank against preferences carry a fingerprint
  // of the prefs they were ranked with. getPrefs is request-scoped, so naming
  // it here costs nothing the ranking below was not already going to pay.
  const key = category.kind === 'topic'
    ? `${slug}:${limit}`
    : `${slug}:${limit}:${userId}:${prefsFingerprint(await getPrefs(userId))}`;
  const stamp = await cycleStamp();

  let stories: Story[] = [];
  try {
    stories = await cached(key, stamp, () => {
      if (category.kind === 'topic') return getTopicSection(category.name, limit);
      if (category.slug === 'top') return getFeed(limit, userId);
      if (category.slug === 'local') return getLocalSection(limit, userId);
      if (category.slug === 'national') return getNationalSection(limit, userId);
      return getInternationalSection(limit, userId);
    });
  } catch {
    // A store that predates the v1.5 migration answers some of these with a
    // missing column. An empty section beats a 500 on a live deploy.
    stories = [];
  }
  return { category, stories };
}
