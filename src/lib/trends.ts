/**
 * What people are talking about right now, from outside the feed: Bluesky's
 * trending topics and Google's daily search trends for the US and India.
 *
 * Both are read for their terms only, and only to order the single-source
 * queue - a story nobody else has written up yet, but that a lot of people are
 * searching or posting about, is the one to spend the next neuron on. Nothing
 * here costs a neuron itself: the match is lexical.
 *
 * X is absent on purpose. Its trends sit behind the expensive API tiers and
 * scraping them breaks its terms; Bluesky's endpoint is public and unauthed.
 *
 * Google's RSS ignores its category parameter, so these are all trends, not
 * technology ones. That is fine for ordering: a term only counts when it
 * appears in one of our own headlines, so the filter is the feed itself.
 */

const UA = 'smartnews/0.1 (personal news aggregator)';

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function bluesky(): Promise<string[]> {
  const body = await get('https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=25');
  if (!body) return [];
  const trends = (JSON.parse(body) as { trends?: { displayName?: string }[] }).trends ?? [];
  return trends.map((t) => t.displayName ?? '').filter(Boolean);
}

async function google(geo: string): Promise<string[]> {
  const body = await get(`https://trends.google.com/trending/rss?geo=${geo}`);
  if (!body) return [];
  // Search queries, already lowercase. Item titles only; the channel's own
  // <title> is "Daily Search Trends" and is skipped by requiring an <item>.
  return [...body.matchAll(/<item>\s*<title>([^<]+)<\/title>/g)].map((m) => m[1].trim().toLowerCase());
}

/** Words too common to say two headlines share a subject. */
const FILLER = new Set(['with', 'from', 'after', 'over', 'into', 'about', 'amid', 'says', 'their',
  'this', 'that', 'have', 'will', 'what', 'when', 'more', 'than', 'first', 'new']);

/**
 * Each trend as the words that carry it. Short words go too: "ice" or "nba" on
 * its own matches far more unrelated headlines than it earns.
 */
export type Trend = string[];

function words(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) ?? [])]
    .filter((w) => !FILLER.has(w));
}

export async function trendingTerms(): Promise<Trend[]> {
  const all = (await Promise.all([bluesky(), google('US'), google('IN')])).flat();
  const trends = all.map(words).filter((w) => w.length > 0);
  console.log(`  trending: ${trends.length} topics`);
  return trends;
}

/**
 * Whether a headline is about a trend: it must carry two of the trend's words,
 * or its only one. A single shared word is how "Alleged FBI data breach" would
 * otherwise claim every headline with "alleged" in it.
 */
export function trending(trends: Trend[], title: string): boolean {
  const have = new Set(words(title));
  return trends.some((t) => t.filter((w) => have.has(w)).length >= Math.min(2, t.length));
}
