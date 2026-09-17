import { d1 } from './d1';
import {
  getFeed, getPrefs, idList, prefsFingerprint, storyCols, STORY_FROM,
  withPlaceLabels, type Outlet, type Story,
} from './feed';
import { warm } from './cache';
import { cycleStamp } from './cycle';
import { placesReady } from './places';
import { categoryBySlug } from '../../shared/taxonomy';
import { logError } from './log';

/**
 * The query layer behind the category strip. Every function here returns the
 * section's rows ONCE: the page renders them and derives its sub-category
 * counts from the same array, so a strip of eight pills still costs one query.
 *
 * Nothing new is stored. National and International read the country the
 * cluster already carries. A cluster with a NULL country belongs to neither,
 * which is correct — it is unplaced, and reaches a reader under the Others
 * scope pill instead.
 */

const WINDOW_MS = 48 * 3_600_000;

/**
 * How many rows a section ships. Once 200, with the sub-counts taken over the
 * whole pool; the counts are now taken over the page, so the other 152 rows
 * were read from D1 on every cold isolate and thrown away.
 */
export const SECTION_PAGE = 48;

/**
 * The hidden categories, in the WHERE rather than filtered off the result:
 * with a limit that is exactly the page, filtering afterwards would leave a
 * reader who hides two categories with a shorter page than everyone else.
 */
function notHidden(prefs: { hidden: string[] }): { where: string; params: string[] } {
  if (!prefs.hidden.length) return { where: '1 = 1', params: [] };
  return { where: `c.category NOT IN (${prefs.hidden.map(() => '?').join(',')})`, params: prefs.hidden };
}

/**
 * The outlets behind a page of stories, keyed by cluster.
 *
 * One query for forty-eight clusters rather than forty-eight queries: this is
 * the detail page's whole remaining payload, so shipping it with the section is
 * what lets a story open without asking the server anything.
 *
 * One row per masthead, not per article, and three columns rather than six.
 * The page renders a deduped list of outlet names and derives the bias split
 * from the same list; it never shows an article's title or its timestamp, and
 * the count it prints is c.article_count, which the card already carries.
 * Sending whole articles tripled the section for fields nothing reads.
 */
export async function outletsFor(ids: string[]): Promise<Map<string, Outlet[]>> {
  const by = new Map<string, Outlet[]>();
  if (!ids.length) return by;
  const rows = await d1().all<Outlet & { cluster_id: string }>(
    `SELECT a.cluster_id, s.name AS source, s.bias, min(a.url) AS url
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id IN (${idList(ids)}) AND COALESCE(s.tier, 'full') <> 'title'
      GROUP BY a.cluster_id, s.name
      ORDER BY min(a.published_at) ASC`);
  for (const { cluster_id, ...o } of rows) {
    const held = by.get(cluster_id);
    if (held) held.push(o); else by.set(cluster_id, [o]);
  }
  return by;
}

const stamp = (rows: Story[]): Story[] =>
  rows.map((s) => ({ ...s, exploration: 0 as const, exploration_kind: null }));

/**
 * `order` is the section's own ordering, not a caller's free text: the two
 * values below are the only ones, and both are literals compiled in here
 * rather than anything a request can reach.
 */
type Order = 'importance' | 'recency';

const ORDER_BY: Record<Order, string> = {
  importance: 'c.importance DESC, c.last_seen DESC',
  recency: 'c.last_seen DESC, c.importance DESC',
};

async function bySql(
  where: string, params: unknown[], limit: number, order: Order = 'importance',
): Promise<Story[]> {
  const ready = await placesReady();
  const rows = withPlaceLabels(await d1().all<Story>(
    `SELECT ${storyCols(ready)}
       ${STORY_FROM}
      WHERE c.headline IS NOT NULL AND c.last_seen >= ? AND ${where}
      ORDER BY ${ORDER_BY[order]} LIMIT ${limit}`,
    [Date.now() - WINDOW_MS, ...params]));
  return stamp(rows);
}

/**
 * The countries we actually carry news for.
 *
 * Home country is not a profile field — it is the definition of the National
 * and International tabs, which are `c.country = ?` and its complement. So the
 * only countries worth offering are the ones that would answer with something;
 * a picker listing all 249 would let a reader choose two empty sections.
 */
export async function countriesWithNews(): Promise<string[]> {
  return warm('countries', await cycleStamp(), uncachedCountriesWithNews);
}

async function uncachedCountriesWithNews(): Promise<string[]> {
  const rows = await d1().all<{ country: string }>(
    `SELECT DISTINCT country FROM clusters
      WHERE headline IS NOT NULL AND country IS NOT NULL AND last_seen >= ?
      ORDER BY country`, [Date.now() - WINDOW_MS]);
  // The column is whatever the summariser wrote, and it has written junk — a
  // bare comma among them. A picker is the wrong place to find that out.
  return rows.map((r) => r.country.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
}

export async function getNationalSection(limit: number, userId: string): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  const h = notHidden(prefs);
  return bySql(`c.country = ? AND ${h.where}`, [prefs.country, ...h.params], limit);
}

export async function getInternationalSection(limit: number, userId: string): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  const h = notHidden(prefs);
  return bySql(`c.country IS NOT NULL AND c.country <> ? AND ${h.where}`,
               [prefs.country, ...h.params], limit);
}

/**
 * Newest first, and nothing else: no interest weighting, no exploration slot,
 * no importance tie-break ahead of the clock. The reader who opens Latest is
 * asking what the last cycle brought, so the only judgement applied is the
 * reader's own — hidden categories still stay hidden.
 *
 */
export async function getLatestSection(limit: number, userId: string): Promise<Story[]> {
  const h = notHidden(await getPrefs(userId));
  return bySql(h.where, h.params, limit, 'recency');
}

export function getTopicSection(category: string, limit = SECTION_PAGE): Promise<Story[]> {
  return bySql('c.category = ?', [category], limit);
}

/**
 * One entry point for the strip: the rows for one slug, ranked and memoised.
 *
 * It used to take a `limit` in the middle and default it, which made its only
 * caller pass a literal `undefined` to reach the argument after it, and to
 * answer `{ category, stories }` or null - but getWorld walks TAXONOMY itself,
 * so it already holds the category and never asks for a slug outside it.
 */
export async function getSection(slug: string, userId: string): Promise<Story[]> {
  const category = categoryBySlug(slug);
  if (!category) return [];
  const limit = SECTION_PAGE;

  // Keyed without a reader when the rows are the same for everyone; the three
  // that rank against preferences carry a fingerprint of what they ranked
  // with, and nothing else - the queries read the prefs and never the reader,
  // so two readers on the same prefs (most of them, on the defaults) share one
  // answer per cycle. The key used to carry the userId as well, which gave
  // each of them a private copy of one identical query.
  // Latest sits between the two: it ranks against nothing, so country and
  // places cannot move it and the full fingerprint would give every reader a
  // private copy of one identical query. The only preference it honours is the
  // hidden list, so that is the whole of its key.
  const key = category.kind === 'topic'
    ? `${slug}:${limit}`
    : category.slug === 'latest'
      ? `${slug}:${limit}:${(await getPrefs(userId)).hidden.join(',')}`
      : `${slug}:${limit}:${prefsFingerprint(await getPrefs(userId))}`;
  const stamp = await cycleStamp();

  let stories: Story[] = [];
  try {
    stories = await warm(key, stamp, () => {
      if (category.kind === 'topic') return getTopicSection(category.name, limit);
      if (category.slug === 'top') return getFeed(limit, userId);
      if (category.slug === 'latest') return getLatestSection(limit, userId);
      if (category.slug === 'national') return getNationalSection(limit, userId);
      return getInternationalSection(limit, userId);
    });
  } catch (err) {
    // A store that predates the v1.5 migration answers some of these with a
    // missing column. An empty section beats a 500 on a live deploy - but this
    // catch is not that narrow, so a D1 outage lands here too and renders as a
    // section with nothing in it. Which of the two it was is what this records.
    logError('section.failed', err, { section: category.slug });
    stories = [];
  }
  return stories;
}
