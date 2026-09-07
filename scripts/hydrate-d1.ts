import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { d1 } from '../src/lib/d1';
import { db } from '../src/lib/db';

/**
 * Rebuild the local SQLite working store from D1.
 *
 * The pipeline is written against local SQLite because a cluster run issues
 * thousands of statements. On a CI runner there is no disk that survives
 * between runs, so the working set is pulled down at the start and pushed back
 * at the end. D1 is the durable copy; the local file is scratch.
 */

const WINDOW_MS = 5 * 24 * 3_600_000;   // comfortably wider than the 48h clustering window
const PAGE = 400;

async function pull<T>(table: string, cols: string, where: string, params: unknown[]): Promise<T[]> {
  const d = await d1();
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await d.all<T>(
      `SELECT ${cols} FROM ${table} ${where} LIMIT ${PAGE} OFFSET ${offset}`, params);
    out.push(...page);
    process.stdout.write(`\r  ${table}: ${out.length}`);
    if (page.length < PAGE) break;
  }
  process.stdout.write(`\r  ${table}: ${out.length}\n`);
  return out;
}

function insertAll(local: ReturnType<typeof db>, table: string, cols: string[], rows: Record<string, unknown>[]) {
  const stmt = local.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  for (const r of rows) stmt.run(...cols.map((c) => (r[c] ?? null) as never));
}

async function main() {
  const path = process.env.SMARTNEWS_DB ?? 'data/smartnews.db';
  if (process.env.HYDRATE_FRESH !== '0') {
    mkdirSync(dirname(path), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }

  const local = db();                 // creates the schema
  const since = Date.now() - WINDOW_MS;
  console.log('Pulling from D1…');

  const sources = await pull<Record<string, unknown>>('sources',
    'id,name,feed_url,homepage,country,category,bias', '', []);
  insertAll(local, 'sources', ['id','name','feed_url','homepage','country','category','bias'], sources);

  const clusters = await pull<Record<string, unknown>>('clusters',
    `id,headline,crux,category,place,country,importance,image_url,article_count,
     source_count,first_seen,last_seen,summarised_at,summarised_n,attempts`,
    'WHERE last_seen >= ?', [since]);
  insertAll(local, 'clusters',
    ['id','headline','crux','category','place','country','importance','image_url','article_count',
     'source_count','first_seen','last_seen','summarised_at','summarised_n','attempts'], clusters);

  const articles = await pull<Record<string, unknown>>('articles',
    'id,source_id,url,title,lead,body,image_url,published_at,fetched_at,content_hash,cluster_id',
    'WHERE published_at >= ?', [since]);
  insertAll(local, 'articles',
    ['id','source_id','url','title','lead','body','image_url','published_at','fetched_at',
     'content_hash','cluster_id'], articles);

  const prefs = await pull<Record<string, unknown>>('prefs', 'user_id,country,categories,places', '', []);
  insertAll(local, 'prefs', ['user_id','country','categories','places'], prefs);

  console.log(`\nLocal store rebuilt: ${sources.length} sources, ${clusters.length} clusters, ${articles.length} articles`);
}

main().then(() => process.exit(0));
