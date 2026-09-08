import { d1 } from './d1';
import {
  getFeed, getLocalFeed, getPrefs, storyCols, storyFrom, type Story,
} from './feed';
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

const stamp = (rows: Story[]): Story[] =>
  rows.map((s) => ({ ...s, exploration: 0 as const, exploration_kind: null }));

async function bySql(where: string, params: unknown[], limit: number): Promise<Story[]> {
  const ready = await placesReady();
  const rows = await (await d1()).all<Story>(
    `SELECT ${storyCols(ready)}
       ${storyFrom(ready)}
      WHERE c.headline IS NOT NULL AND c.last_seen >= ? AND ${where}
      ORDER BY c.importance DESC, c.last_seen DESC LIMIT ${limit}`,
    [Date.now() - WINDOW_MS, ...params]);
  return stamp(rows);
}

/** The reader's own places. Delegates so /local and the Local tab can never
 *  disagree about what "local" means, including the pre-v1.5 free-text
 *  fallback and the empty-on-unmigrated-D1 degradation. */
export function getLocalSection(limit = SECTION_LIMIT, userId = 'local'): Promise<Story[]> {
  return getLocalFeed(limit, userId);
}

export async function getNationalSection(limit = SECTION_LIMIT, userId = 'local'): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  return bySql('c.country = ?', [prefs.country], limit);
}

export async function getInternationalSection(limit = SECTION_LIMIT, userId = 'local'): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  return bySql('c.country IS NOT NULL AND c.country <> ?', [prefs.country], limit);
}

export function getTopicSection(category: string, limit = SECTION_LIMIT): Promise<Story[]> {
  return bySql('c.category = ?', [category], limit);
}

/**
 * One entry point for the strip. Returns null for a slug outside the taxonomy so
 * the caller can 404 rather than render an empty section, which a reader would
 * read as a quiet news day.
 */
export async function getSection(
  slug: string, limit = SECTION_LIMIT, userId = 'local',
): Promise<{ category: Section; stories: Story[] } | null> {
  const category = categoryBySlug(slug);
  if (!category) return null;

  let stories: Story[] = [];
  try {
    if (category.kind === 'topic') stories = await getTopicSection(category.name, limit);
    else if (category.slug === 'top') stories = await getFeed(limit, userId);
    else if (category.slug === 'local') stories = await getLocalSection(limit, userId);
    else if (category.slug === 'national') stories = await getNationalSection(limit, userId);
    else stories = await getInternationalSection(limit, userId);
  } catch {
    // A store that predates the v1.5 migration answers some of these with a
    // missing column. An empty section beats a 500 on a live deploy.
    stories = [];
  }
  return { category, stories };
}
