import Parser from 'rss-parser';
import pLimit from 'p-limit';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { db, markDirty } from './db';
import { SOURCES } from '../../web/shared/sources';
import { normaliseUrl, titleFingerprint } from './text';
import { robotsVerdict } from './robots';

const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const UA = 'smartnews/0.1 (personal news aggregator)';

/**
 * How long a body-less article stays worth retrying. The cycle is half an hour,
 * so this is two more attempts — enough to outlast a restart or a rate-limit,
 * and short enough that a genuinely unreadable page stops costing fetches
 * within the hour.
 */
const RETRY_WINDOW_MS = 60 * 60 * 1000;

type Item = {
  title?: string; link?: string; isoDate?: string; pubDate?: string;
  contentSnippet?: string; content?: string; enclosure?: { url?: string };
  ['media:content']?: { $?: { url?: string } };
  ['media:thumbnail']?: { $?: { url?: string } };
};

const parser = new Parser<unknown, Item>({
  timeout: 15000,
  headers: { 'User-Agent': UA },
  customFields: { item: [['media:content', 'media:content'], ['media:thumbnail', 'media:thumbnail']] },
});

function imageOf(item: Item): string | null {
  const direct = item.enclosure?.url ?? item['media:content']?.$?.url ?? item['media:thumbnail']?.$?.url;
  if (direct) return direct;
  const m = item.content?.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function seedSources() {
  const d = db();
  // A duplicated id silently reassigns every article the first entry owns —
  // adding the Times of India's front page under an id an existing source
  // already held moved 1020 of its articles to the title tier, and with them
  // out of source_count. A duplicated feed_url is the subtler half of the same
  // mistake: an outlet read in both tiers has every article marked prominent,
  // which says no more than marking none of them would.
  const ids = new Set<string>(), feeds = new Set<string>();
  for (const s of SOURCES) {
    if (ids.has(s.id)) throw new Error(`duplicate source id: ${s.id}`);
    if (feeds.has(s.feed_url)) throw new Error(`duplicate feed_url: ${s.feed_url}`);
    ids.add(s.id); feeds.add(s.feed_url);
  }
  const stmt = d.prepare(
    `INSERT INTO sources (id, name, feed_url, homepage, country, category, bias, tier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, feed_url=excluded.feed_url,
       homepage=excluded.homepage, country=excluded.country, category=excluded.category,
       bias=excluded.bias, tier=excluded.tier`,
  );
  for (const s of SOURCES) {
    stmt.run(s.id, s.name, s.feed_url, s.homepage, s.country, s.category, s.bias, s.tier ?? 'full');
  }
}

/**
 * When each host may next be fetched. Crawl-delay is per host, not global, so
 * the six-way concurrency stays useful — a 10-second delay on CNA does not
 * stall the other thirty-eight sources.
 */
const nextFetchAt = new Map<string, number>();

async function pace(origin: string, delayMs: number): Promise<void> {
  if (!delayMs) return;
  const now = Date.now();
  const at = nextFetchAt.get(origin) ?? 0;
  nextFetchAt.set(origin, Math.max(now, at) + delayMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/**
 * The picture a page offers a social card, when the feed offered none.
 *
 * Nine per cent of written stories had no image, and almost all of them were
 * single-source: a cluster with four articles has four chances at a picture, a
 * lone one has a single chance and ABC, ESPN, Al Jazeera and CNBC all publish
 * feeds without a media tag. Their pages carry og:image all the same, and the
 * page is already downloaded and parsed for the body — this costs one lookup
 * against a document that is open anyway.
 *
 * The url is passed rather than read off the document because linkedom does not
 * set one: `parseHTML` takes a string and nothing else, so there is no baseURI
 * for a relative og:image to resolve against.
 */
function socialImage(doc: LinkedomDocument, url: string): string | null {
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]',
                     'meta[name="twitter:image:src"]', 'meta[itemprop="image"]']) {
    const raw = doc.querySelector(sel)?.getAttribute('content')?.trim();
    if (!raw) continue;
    try {
      const abs = new URL(raw, url);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') return abs.href;
    } catch { /* a relative path that is not one */ }
  }
  return null;
}

/**
 * linkedom's document, which is not the DOM lib's and cannot be named globally.
 */
type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

/**
 * null means no body; `blocked` distinguishes "told not to" from "could not".
 *
 * Parsed with linkedom rather than jsdom. jsdom builds a spec-compliant DOM
 * with a JS execution context per page, and none of that is used here: the
 * document is read twice — four meta lookups and Readability's scoring pass —
 * and thrown away. Measured over eight real article pages from the store, 17KB
 * to 1MB, the two produce the same body to the character and the same og:image
 * verdict, at 1011ms against 135ms.
 *
 * The parse was never the bottleneck at six-way concurrency — a page-slot is
 * about 1.5s, almost all of it waiting on the network. It is what let the
 * concurrency go up: at sixteen, jsdom's 100-270ms per page contends for the
 * runner's four cores, and linkedom's ~17ms does not.
 *
 * One consequence: linkedom sets no documentURI, so Readability cannot
 * absolutise the relative links inside the article HTML it returns. Only
 * `.textContent` is read here, which has no links in it.
 */
async function extractBody(url: string): Promise<{ text: string | null; image: string | null } | null | 'blocked'> {
  try {
    const verdict = await robotsVerdict(url, UA);
    if (!verdict.allowed) return 'blocked';
    await pace(new URL(url).origin, verdict.delayMs);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(14000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return null;
    const html = await res.text();
    const { document } = parseHTML(html);
    const image = socialImage(document, url);
    const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
    const text = article?.textContent?.replace(/\s+/g, ' ').trim();
    return { text: text && text.length > 240 ? text.slice(0, 8000) : null, image };
  } catch {
    return null;
  }
}

export async function ingest(): Promise<{ added: number; withBody: number }> {
  const d = db();
  seedSources();

  // The URL is the identity, never (source, URL): a front page and the desk feed
  // beneath it carry the same story, and the tier of whoever holds it decides
  // what happens next.
  const owner = d.prepare(
    `SELECT a.id, s.tier FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.url = ?`,
  );
  const insert = d.prepare(
    `INSERT OR IGNORE INTO articles
       (id, source_id, url, title, lead, body, image_url, published_at, fetched_at, content_hash, prominent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // A story its own front page carried first would otherwise be stranded under
  // a title-tier owner for good: never body-fetched, and never counted as a
  // source. When the desk feed brings the same URL in, hand the row over to the
  // outlet we are allowed to read. The id does not change, so anything already
  // pointing at the article — cluster membership above all — survives.
  const upgrade = d.prepare('UPDATE articles SET source_id = ? WHERE id = ?');
  const markProminent = d.prepare('UPDATE articles SET prominent = 1 WHERE id = ? AND prominent = 0');

  const now = Date.now();
  const feedLimit = pLimit(8);
  const pending: { id: string; url: string }[] = [];
  let seen = 0;

  const readFeed = async (s: { id: string; feed_url: string }) => {
    try { return await parser.parseURL(s.feed_url); }
    catch (err) { console.warn(`  ! ${s.id}: ${(err as Error).message.slice(0, 70)}`); return null; }
  };
  const usable = (item: Item) => {
    if (!item.title || !item.link) return null;
    const published = Date.parse(item.isoDate ?? item.pubDate ?? '') || now;
    if (now - published > MAX_AGE_MS) return null;
    return { url: normaliseUrl(item.link), published, title: item.title.trim() };
  };
  const idFor = (sourceId: string, url: string) =>
    `${sourceId}:${Buffer.from(url).toString('base64url').slice(-24)}`;
  const leadOf = (item: Item) =>
    (item.contentSnippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);

  // Pass 1: the feeds we read in full, exactly as before. It is awaited to
  // completion before the front pages run, so within a cycle a story always
  // lands under the outlet whose body we can fetch and no title-tier row for it
  // is ever created. The upgrade below is for the case the ordering cannot fix
  // — a front page carrying a story hours before the desk feed does.
  await Promise.all(SOURCES.filter((s) => s.tier !== 'title').map((s) => feedLimit(async () => {
    const feed = await readFeed(s);
    if (!feed) return;
    let added = 0, upgraded = 0;
    for (const item of feed.items ?? []) {
      const u = usable(item);
      if (!u) continue;
      seen++;
      const held = owner.get(u.url) as { id: string; tier: string } | undefined;
      if (held) {
        if (held.tier !== 'title') continue;
        upgrade.run(s.id, held.id);
        pending.push({ id: held.id, url: u.url });
        markDirty('article', [held.id]);
        upgraded++;
        continue;
      }
      const id = idFor(s.id, u.url);
      insert.run(id, s.id, u.url, u.title, leadOf(item), null, imageOf(item), u.published, now,
                 titleFingerprint(u.title), 0);
      pending.push({ id, url: u.url });
      markDirty('article', [id]);
      added++;
    }
    console.log(`  ${s.id.padEnd(20)} ${String(added).padStart(3)} new / ${feed.items?.length ?? 0}`
                + `${upgraded ? ` (+${upgraded} upgraded)` : ''}`);
  })));

  // Pass 2: front pages, headline only. Nothing here is ever followed to an
  // article page, so robots.txt does not enter into it and an outlet that
  // refuses automated retrieval can still tell us what it is leading with. A
  // URL we already hold is flagged where it lies; one we have not seen is
  // inserted body-less, so it can still cluster on its headline — title and
  // lead are what the clustering reads anyway.
  await Promise.all(SOURCES.filter((s) => s.tier === 'title').map((s) => feedLimit(async () => {
    const feed = await readFeed(s);
    if (!feed) return;
    let flagged = 0, added = 0;
    for (const item of feed.items ?? []) {
      const u = usable(item);
      if (!u) continue;
      const held = owner.get(u.url) as { id: string; tier: string } | undefined;
      if (held) {
        markProminent.run(held.id);
        markDirty('article', [held.id]);
        flagged++;
        continue;
      }
      const id = idFor(s.id, u.url);
      insert.run(id, s.id, u.url, u.title, leadOf(item), null, imageOf(item), u.published, now,
                 titleFingerprint(u.title), 1);
      markDirty('article', [id]);
      added++;
    }
    console.log(`  ${s.id.padEnd(20)} ${String(flagged + added).padStart(3)} prominent`
                + ` / ${feed.items?.length ?? 0}`);
  })));

  // A body that failed once was never tried again: `pending` holds only rows
  // this run inserted. That made every transient failure permanent — and with
  // a robots.txt 5xx read as a refusal, one blip on a publisher's server
  // silently cost that source its text for good. Recent misses get another go.
  const retry = d.prepare(
    `SELECT a.id, a.url FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.body IS NULL AND s.tier = 'full' AND a.fetched_at >= ? AND a.fetched_at < ?
      ORDER BY a.fetched_at DESC LIMIT 200`,
  ).all(now - RETRY_WINDOW_MS, now) as unknown as { id: string; url: string }[];

  const work = [...pending, ...retry];
  console.log(`\n${pending.length} new articles (${seen} seen)`
              + `${retry.length ? `, ${retry.length} earlier misses retried` : ''}. Extracting full text…`);

  // Six, and the reasoning against raising it is worth keeping because it was
  // tried. A page-slot is about 1.5s and almost all of it is the network, the
  // parse is ~17ms since linkedom, and Crawl-delay is enforced per host by
  // pace() - so six slots across sixty hosts looks like idleness rather than
  // politeness, and sixteen looks free.
  //
  // It is not. Two cycles at sixteen returned 66/83 and 53/65 bodies, 79% and
  // 82%, against a band of 89-94% over the seven runs before them; the step
  // got no faster. The same code at the same width from a residential address
  // returned 1,100/1,192, which is inside the band - so what the runner hits
  // is not the width itself but a burst of sixteen from a datacenter IP, and
  // no amount of local CPU headroom answers that.
  //
  // A middle value may exist. Whoever looks for one should read the body rate,
  // not the clock: the cost lands as articles summarised from their headline
  // alone, and an hour of retries hides it from the run that caused it.
  const bodyLimit = pLimit(6);
  const setBody = d.prepare('UPDATE articles SET body = ? WHERE id = ?');
  // Only when the feed gave nothing: a feed's own media tag is the outlet's
  // choice of picture for the story, and og:image is what it shows strangers.
  const setImage = d.prepare('UPDATE articles SET image_url = ? WHERE id = ? AND image_url IS NULL');
  let got = 0;
  let blocked = 0;
  await Promise.all(work.map((a) => bodyLimit(async () => {
    const page = await extractBody(a.url);
    if (page === 'blocked') { blocked++; if (process.env.LOG_BLOCKED) console.log(`  BLOCKED ${a.url.slice(0, 110)}`); return; }
    if (!page) return;
    if (page.image) setImage.run(page.image, a.id);
    if (page.text) { setBody.run(page.text, a.id); got++; }
  })));

  // Worth its own number rather than folding into the misses: a rising count
  // here is a publisher changing their policy, not the extractor failing.
  console.log(`Full text for ${got}/${work.length}.${blocked ? ` ${blocked} disallowed by robots.txt.` : ''}`);
  return { added: pending.length, withBody: got };
}
