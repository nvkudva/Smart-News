import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { DatabaseSync } from 'node:sqlite';
import { d1 } from '../src/lib/d1';

/**
 * Push the local pipeline's finished rows up to D1, which is what the deployed
 * site reads. The pipeline itself stays on SQLite: a cluster run issues
 * thousands of statements, and over HTTP each one would be a round trip.
 *
 * Article bodies ARE synced, even though the site never shows them: with the
 * pipeline running on a stateless CI runner, D1 is the only copy of the working
 * set, and `hydrate` needs bodies to re-summarise a cluster that grew.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT NOT NULL,
  homepage TEXT, country TEXT, category TEXT, bias TEXT);
CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY, headline TEXT, crux TEXT, category TEXT, place TEXT,
  country TEXT, importance INTEGER DEFAULT 3, image_url TEXT,
  article_count INTEGER NOT NULL DEFAULT 0, source_count INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  summarised_at INTEGER, summarised_n INTEGER DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
  lead TEXT, body TEXT, image_url TEXT, published_at INTEGER NOT NULL,
  fetched_at INTEGER, content_hash TEXT, cluster_id TEXT);
CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT PRIMARY KEY, country TEXT, categories TEXT, places TEXT);
CREATE TABLE IF NOT EXISTS saved (
  user_id TEXT NOT NULL, cluster_id TEXT NOT NULL, saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, cluster_id));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, cluster_id TEXT NOT NULL,
  kind TEXT NOT NULL, dwell_ms INTEGER, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS clusters_last_seen ON clusters(last_seen DESC);
CREATE INDEX IF NOT EXISTS articles_cluster ON articles(cluster_id);
`;

// D1 caps bound parameters per statement, so rows go up in small batches.
const MAX_PARAMS = 90;

async function push(table: string, cols: string[], rows: Record<string, unknown>[]) {
  const d = await d1();
  const perBatch = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  const placeholder = `(${cols.map(() => '?').join(',')})`;
  let done = 0;

  for (let i = 0; i < rows.length; i += perBatch) {
    const batch = rows.slice(i, i + perBatch);
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES ` +
                batch.map(() => placeholder).join(',');
    await d.run(sql, batch.flatMap((r) => cols.map((c) => r[c] ?? null)));
    done += batch.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  process.stdout.write(`\r  ${table}: ${done}/${rows.length}\n`);
}

async function main() {
  const local = new DatabaseSync(process.env.SMARTNEWS_DB ?? 'data/smartnews.db', { readOnly: true });
  const d = await d1();

  console.log('Schema…');
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await d.run(stmt);

  const since = Date.now() - 14 * 24 * 3_600_000;   // a fortnight is plenty to serve
  const all = <T,>(sql: string, ...p: unknown[]) => local.prepare(sql).all(...(p as never[])) as unknown as T[];

  console.log('Pushing…');
  await push('sources', ['id', 'name', 'feed_url', 'homepage', 'country', 'category'],
    all('SELECT id,name,feed_url,homepage,country,category FROM sources'));

  const clusters = all<Record<string, unknown>>(
    `SELECT id,headline,crux,category,place,country,importance,image_url,
            article_count,source_count,first_seen,last_seen,summarised_at,summarised_n,attempts
       FROM clusters WHERE last_seen >= ?`, since);
  await push('clusters',
    ['id','headline','crux','category','place','country','importance','image_url',
     'article_count','source_count','first_seen','last_seen','summarised_at','summarised_n','attempts'],
    clusters);

  const articles = all<Record<string, unknown>>(
    `SELECT id,source_id,url,title,lead,body,image_url,published_at,fetched_at,
            content_hash,cluster_id
       FROM articles WHERE published_at >= ?`, since);
  await push('articles',
    ['id','source_id','url','title','lead','body','image_url','published_at',
     'fetched_at','content_hash','cluster_id'], articles);

  const prefs = all<Record<string, unknown>>('SELECT user_id,country,categories,places FROM prefs');
  if (prefs.length) await push('prefs', ['user_id','country','categories','places'], prefs);

  const counts = await d.get<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM sources) AS sources,
            (SELECT COUNT(*) FROM clusters) AS clusters,
            (SELECT COUNT(*) FROM articles) AS articles`);
  console.log('\nD1 now holds:', JSON.stringify(counts));
}

main().then(() => process.exit(0));
