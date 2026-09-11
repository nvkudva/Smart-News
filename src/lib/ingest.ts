import Parser from 'rss-parser';
import pLimit from 'p-limit';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { db } from './db';
import { SOURCES } from './sources';
import { normaliseUrl, titleFingerprint } from './text';
import { robotsVerdict } from './robots';

const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const UA = 'smartnews/0.1 (personal news aggregator)';

/**
 * How long a body-less article stays worth retrying. The cycle is fifteen
 * minutes, so this is roughly four more attempts — enough to outlast a
 * restart or a rate-limit, and short enough that a genuinely unreadable page
 * stops costing fetches within the hour.
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
  const stmt = d.prepare(
    `INSERT INTO sources (id, name, feed_url, homepage, country, category, bias)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, feed_url=excluded.feed_url,
       homepage=excluded.homepage, country=excluded.country, category=excluded.category,
       bias=excluded.bias`,
  );
  for (const s of SOURCES) stmt.run(s.id, s.name, s.feed_url, s.homepage, s.country, s.category, s.bias);
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

/** null means no body; `blocked` distinguishes "told not to" from "could not". */
async function extractBody(url: string): Promise<string | null | 'blocked'> {
  try {
    const verdict = await robotsVerdict(url, UA);
    if (!verdict.allowed) return 'blocked';
    await pace(new URL(url).origin, verdict.delayMs);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(14000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return null;
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    dom.window.close();
    const text = article?.textContent?.replace(/\s+/g, ' ').trim();
    return text && text.length > 240 ? text.slice(0, 8000) : null;
  } catch {
    return null;
  }
}

export async function ingest(): Promise<{ added: number; withBody: number }> {
  const d = db();
  seedSources();

  const exists = d.prepare('SELECT 1 FROM articles WHERE url = ?');
  const insert = d.prepare(
    `INSERT OR IGNORE INTO articles
       (id, source_id, url, title, lead, body, image_url, published_at, fetched_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = Date.now();
  const feedLimit = pLimit(8);
  const pending: { id: string; url: string }[] = [];
  let seen = 0;

  await Promise.all(SOURCES.map((s) => feedLimit(async () => {
    let feed;
    try {
      feed = await parser.parseURL(s.feed_url);
    } catch (err) {
      console.warn(`  ! ${s.id}: ${(err as Error).message.slice(0, 70)}`);
      return;
    }
    let added = 0;
    for (const item of feed.items ?? []) {
      if (!item.title || !item.link) continue;
      const published = Date.parse(item.isoDate ?? item.pubDate ?? '') || now;
      if (now - published > MAX_AGE_MS) continue;
      const url = normaliseUrl(item.link);
      seen++;
      if (exists.get(url)) continue;
      const id = `${s.id}:${Buffer.from(url).toString('base64url').slice(-24)}`;
      const lead = (item.contentSnippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
      insert.run(id, s.id, url, item.title.trim(), lead, null, imageOf(item), published, now,
                 titleFingerprint(item.title));
      pending.push({ id, url });
      added++;
    }
    console.log(`  ${s.id.padEnd(20)} ${String(added).padStart(3)} new / ${feed.items?.length ?? 0}`);
  })));

  // A body that failed once was never tried again: `pending` holds only rows
  // this run inserted. That made every transient failure permanent — and with
  // a robots.txt 5xx read as a refusal, one blip on a publisher's server
  // silently cost that source its text for good. Recent misses get another go.
  const retry = d.prepare(
    `SELECT id, url FROM articles
      WHERE body IS NULL AND fetched_at >= ? AND fetched_at < ?
      ORDER BY fetched_at DESC LIMIT 200`,
  ).all(now - RETRY_WINDOW_MS, now) as unknown as { id: string; url: string }[];

  const work = [...pending, ...retry];
  console.log(`\n${pending.length} new articles (${seen} seen)`
              + `${retry.length ? `, ${retry.length} earlier misses retried` : ''}. Extracting full text…`);

  const bodyLimit = pLimit(6);
  const setBody = d.prepare('UPDATE articles SET body = ? WHERE id = ?');
  let got = 0;
  let blocked = 0;
  await Promise.all(work.map((a) => bodyLimit(async () => {
    const body = await extractBody(a.url);
    if (body === 'blocked') { blocked++; if (process.env.LOG_BLOCKED) console.log(`  BLOCKED ${a.url.slice(0, 110)}`); return; }
    if (body) { setBody.run(body, a.id); got++; }
  })));

  // Worth its own number rather than folding into the misses: a rising count
  // here is a publisher changing their policy, not the extractor failing.
  console.log(`Full text for ${got}/${work.length}.${blocked ? ` ${blocked} disallowed by robots.txt.` : ''}`);
  return { added: pending.length, withBody: got };
}
