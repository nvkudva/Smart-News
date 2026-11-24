import { label } from '../../shared/categories';
import { TOPIC_CATEGORIES, sectionSlugFor, slug } from '../../shared/taxonomy';
import { sectionFrom, type SectionStory, type World } from './world';

export const STORIES_PER_CATEGORY = 3;

export type PodcastTrack = {
  id: string;
  category: string;
  categoryKey: string;
  indexInCategory: number;
  totalInCategory: number;
  headline: string;
  crux: string;
  intro: string;
  script: string;
};

function cleanSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function makeScript(headline: string, crux: string): string {
  const head = cleanSentence(headline);
  const body = cleanSentence(crux);
  return body ? `${head} ${body}` : head;
}

type TopicSection = Extract<(typeof TOPIC_CATEGORIES)[number], { kind: 'topic' }>;

const TOPICS: TopicSection[] = TOPIC_CATEGORIES.filter(
  (sec): sec is TopicSection => sec.kind === 'topic',
);

function storiesForCategory(
  world: World,
  cat: string,
  hiddenSet: Set<string>,
  seenIds: Set<string>,
): SectionStory[] {
  const picked: SectionStory[] = [];
  const addFrom = (list: SectionStory[]) => {
    for (const story of list) {
      if (picked.length >= STORIES_PER_CATEGORY) break;
      if (hiddenSet.has(story.category) || seenIds.has(story.id)) continue;
      if (story.category !== cat && !primaryMatches(cat, story)) continue;
      seenIds.add(story.id);
      picked.push(story);
    }
  };

  const primary = TOPICS.find((sec) => sec.categories[0] === cat);
  if (primary) {
    for (const story of sectionFrom(world, primary.slug).stories) {
      if (picked.length >= STORIES_PER_CATEGORY) break;
      if (hiddenSet.has(story.category) || seenIds.has(story.id)) continue;
      seenIds.add(story.id);
      picked.push(story);
    }
    return picked;
  }

  const mappedSlug = sectionSlugFor(cat);
  if (world.sections[mappedSlug]) addFrom(sectionFrom(world, mappedSlug).stories);
  if (picked.length < STORIES_PER_CATEGORY) addFrom(sectionFrom(world, 'top').stories);
  if (picked.length < STORIES_PER_CATEGORY) {
    const fallback = [...world.stories]
      .filter((s) => s.category === cat && !hiddenSet.has(s.category) && !seenIds.has(s.id))
      .sort((a, b) => b.importance - a.importance || b.last_seen - a.last_seen);
    addFrom(fallback);
  }
  return picked;
}

function primaryMatches(cat: string, story: SectionStory): boolean {
  return story.category === cat;
}

const ANCHOR_TRANSITIONS = [
  (cat: string) => `Moving over to ${cat} next.`,
  (cat: string) => `Turning now to ${cat}, here is the latest.`,
  (cat: string) => `Next up in your briefing, top stories from ${cat}.`,
  (cat: string) => `Checking in on ${cat} now.`,
];

function anchorIntro(categoryName: string, categoryOrder: number): string {
  if (categoryOrder === 0) {
    return `Welcome to your Smart News briefing. Starting with ${categoryName}, here is what you need to know.`;
  }
  return ANCHOR_TRANSITIONS[(categoryOrder - 1) % ANCHOR_TRANSITIONS.length](categoryName);
}

function pushCategory(
  out: PodcastTrack[],
  categoryName: string,
  categoryKey: string,
  stories: SectionStory[],
  categoryOrder: number,
) {
  const total = stories.length;
  stories.forEach((story, idx) => {
    const intro = idx === 0 ? anchorIntro(categoryName, categoryOrder) : '';
    out.push({
      id: story.id,
      category: categoryName,
      categoryKey,
      indexInCategory: idx + 1,
      totalInCategory: total,
      headline: story.headline,
      crux: story.crux,
      intro,
      script: makeScript(story.headline, story.crux),
    });
  });
}

/**
 * Build the podcast playlist: top 3 stories from each user-selected Interest
 * category, or from each visible (non-hidden) topic category when no Interests
 * are chosen.
 */
export function buildPodcastQueue(
  world: World,
  interests: readonly string[],
  hidden: readonly string[],
): PodcastTrack[] {
  const hiddenSet = new Set(hidden);
  const seenIds = new Set<string>();
  const tracks: PodcastTrack[] = [];
  let categoryCount = 0;

  const activeInterests = interests.filter((c) => !hiddenSet.has(c));
  if (activeInterests.length > 0) {
    for (const cat of activeInterests) {
      const stories = storiesForCategory(world, cat, hiddenSet, seenIds);
      if (stories.length === 0) continue;
      pushCategory(tracks, label(cat), slug(cat), stories, categoryCount);
      categoryCount++;
    }
    if (tracks.length > 0) return tracks;
  }

  for (const sec of TOPICS) {
    if (sec.categories.every((c) => hiddenSet.has(c))) continue;
    const stories = sectionFrom(world, sec.slug).stories
      .filter((s) => !hiddenSet.has(s.category) && !seenIds.has(s.id))
      .slice(0, STORIES_PER_CATEGORY);
    if (stories.length === 0) continue;
    for (const s of stories) seenIds.add(s.id);
    pushCategory(tracks, sec.name, sec.slug, stories, categoryCount);
    categoryCount++;
  }

  if (tracks.length > 0) return tracks;

  const topStories = sectionFrom(world, 'top').stories
    .filter((s) => !hiddenSet.has(s.category))
    .slice(0, STORIES_PER_CATEGORY);
  if (topStories.length > 0) {
    pushCategory(tracks, 'Trending', 'top', topStories, 0);
  }
  return tracks;
}

/** Full spoken text for a track, prepending the category intro on story #1. */
export function speakableText(track: PodcastTrack, includeIntro: boolean): string {
  return includeIntro && track.intro ? `${track.intro} ${track.script}` : track.script;
}

/** Index of the first track in the next category, wrapping to 0 if at the end. */
export function nextCategoryIndex(tracks: readonly PodcastTrack[], currentIndex: number): number {
  if (tracks.length === 0) return -1;
  const currentKey = tracks[currentIndex]?.categoryKey;
  for (let i = currentIndex + 1; i < tracks.length; i++) {
    if (tracks[i].categoryKey !== currentKey) return i;
  }
  for (let i = 0; i < currentIndex; i++) {
    if (tracks[i].categoryKey !== currentKey) return i;
  }
  return -1;
}
