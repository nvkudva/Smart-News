import { cycleStamp } from './cycle';
import { SECTION_PAGE, getSection, outletsFor } from './sections';
import { TAXONOMY, slug, subCategoriesFor, subSlugsFor, type SubCount } from '../../shared/taxonomy';
import type { Outlet, Story } from './feed';

/**
 * Everything the reader can read, in one answer.
 *
 * Fourteen sections drawn from one forty-eight-hour window are not fourteen
 * bodies of work: they are one pool of about three hundred stories, ordered
 * fourteen different ways. Asking for them a section at a time meant a request
 * per tap on the strip, and every one of those requests re-sent rows the
 * browser already held under a different heading.
 *
 * So the bodies ship once, deduplicated, and each section ships only its
 * ordering. A section switch, a story opening, a related-stories list — all of
 * them become reads of an array already in IndexedDB.
 *
 * The ranking stays here. Three of the four scope sections rank against the
 * reader's preferences and the place tree, so the order is per-reader even
 * though the bodies are not; sending ids rather than the ranker is what keeps
 * the gazetteer and score() out of the browser.
 */
export type WorldStory = Story & {
  /** This story's sub-slugs within its own topic section. */
  subs: string[];
  /** Its category as a slug — what the scope sections filter on, so the client
   *  never needs the taxonomy to do it. */
  cslug: string;
  outlets: Outlet[];
};

export type WorldSection = {
  name: string;
  /** Which of the two sub-filters applies: a scope section's pills are the ten
   *  topics, a topic section's are its own keyword lists. */
  kind: 'scope' | 'topic';
  /** How many ids this section ships, which is what the reader can scroll. */
  total: number;
  ids: string[];
  /** Counts for the sub-strip, taken over the whole section rather than the
   *  page, exactly as the per-section route computed them. */
  subs: SubCount[];
};

export type World = {
  stamp: string | null;
  sections: Record<string, WorldSection>;
  stories: WorldStory[];
};

export async function getWorld(userId: string, since: number): Promise<World> {
  const stamp = await cycleStamp();

  // Fourteen at once. Each is memoised against the cycle stamp inside
  // getSection, so on a warm isolate this is fourteen map lookups; on a cold
  // one the queries at least overlap rather than queue.
  const got = await Promise.all(
    TAXONOMY.map(async (c) => [c, await getSection(c.slug, userId)] as const));

  const sections: Record<string, WorldSection> = {};
  const bodies = new Map<string, Story>();

  for (const [c, rows] of got) {
    const page = rows.slice(0, SECTION_PAGE);
    sections[c.slug] = {
      name: c.name,
      kind: c.kind,
      total: page.length,
      ids: page.map((s) => s.id),
      subs: subCategoriesFor(c.slug, rows),
    };
    for (const s of page) if (!bodies.has(s.id)) bodies.set(s.id, s);
  }

  // The orderings always ship in full and the bodies do not: an id that stops
  // appearing is how the client learns a story was reaped, which a `since`
  // alone could never say.
  const all = [...bodies.values()];
  const changed = since > 0 ? all.filter((s) => s.last_seen > since) : all;

  const outlets = await outletsFor(changed.map((s) => s.id));
  const stories = changed.map((s) => ({
    ...s,
    // A story sits in exactly one topic section, so its sub-tags are its own.
    // The scope sections tag by category name, which the row already carries,
    // and the client derives those without needing the taxonomy.
    subs: subSlugsFor(slug(s.category), s),
    cslug: slug(s.category),
    outlets: outlets.get(s.id) ?? [],
  }));

  return { stamp, sections, stories };
}
