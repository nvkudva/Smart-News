import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
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

async function pull<T>(table: string, cols: string, where: string, params: unknown[],
                       orderBy?: string): Promise<T[]> {
  const d = await d1();
  const out: T[] = [];
  // Every table's primary key comes first, except where it is composite — then
  // the caller passes the whole key, or paging silently skips and repeats rows.
  const key = orderBy ?? cols.split(',')[0].trim();
  // Keyset, not OFFSET. `OFFSET n` makes SQLite walk and discard n rows before
  // returning any, so paging a table costs roughly half its length squared over
  // the page size — measured at 2.8M rows a day against a 5M daily allowance,
  // for 5.5k articles. Carrying the last key read instead makes it linear.
  let after: unknown = null;
  for (;;) {
    const clause = after === null ? where : `${where ? `${where} AND` : 'WHERE'} ${key} > ?`;
    const page = await d.all<T>(
      `SELECT ${cols} FROM ${table} ${clause} ORDER BY ${key} LIMIT ${PAGE}`,
      after === null ? params : [...params, after]);
    out.push(...page);
    process.stdout.write(`\r  ${table}: ${out.length}`);
    if (page.length < PAGE) break;
    after = (page[page.length - 1] as Record<string, unknown>)[key];
  }
  process.stdout.write(`\r  ${table}: ${out.length}\n`);
  return out;
}

/**
 * The subset of `wanted` that D1 actually has.
 *
 * A column added to this repo reaches D1 only on the next `sync`, and hydrate
 * runs first in the cycle — so selecting one D1 has not been ALTERed to yet
 * fails the whole run. Missing columns come back as null, which is what a
 * freshly ALTERed D1 column would hold anyway.
 */
async function columns(table: string, wanted: string[]): Promise<string[]> {
  const d = await d1();
  const have = new Set((await d.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name));
  const got = wanted.filter((c) => have.has(c));
  if (!got.length) throw new Error(`D1 has no table ${table}`);
  return got;
}

/**
 * The gazetteer as the local file already holds it.
 *
 * places/place_aliases are built locally from data/gazetteer.seed.json and only
 * reach D1 on a later sync, so between the two the wipe below is the only copy
 * standing. Carry it across rather than dropping it.
 */
function localGazetteer(path: string, placeCols: string[], aliasCols: string[]) {
  const empty = { places: [] as Record<string, unknown>[], aliases: [] as Record<string, unknown>[] };
  if (!existsSync(path)) return empty;
  const old = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      places: old.prepare(`SELECT ${placeCols.join(',')} FROM places`).all() as Record<string, unknown>[],
      aliases: old.prepare(`SELECT ${aliasCols.join(',')} FROM place_aliases`).all() as Record<string, unknown>[],
    };
  } catch {
    return empty;                     // an older file, from before the gazetteer shipped
  } finally {
    old.close();
  }
}

function insertAll(local: ReturnType<typeof db>, table: string, cols: string[], rows: Record<string, unknown>[]) {
  const stmt = local.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  for (const r of rows) stmt.run(...cols.map((c) => (r[c] ?? null) as never));
}

async function main() {
  const path = process.env.SMARTNEWS_DB ?? 'data/smartnews.db';
  const since = Date.now() - WINDOW_MS;
  console.log('Pulling from D1…');

  const sources = await pull<Record<string, unknown>>('sources',
    'id,name,feed_url,homepage,country,category,bias', '', []);

  // Before clusters: a cluster's place_id is a foreign key into places, and the
  // local store enforces them.
  //
  // Tolerated missing, because this runs first in the scheduled cycle and the
  // gazetteer tables only appear in D1 on the first `sync` after they shipped.
  // A cron that dies here would take the whole news pipeline with it.
  const placeCols = ['id','kind','name','label','country','admin1_id','parent_id','lat','lon','population','updated_at'];
  const aliasCols = ['alias','country','place_id','source','confidence','updated_at'];
  let places: Record<string, unknown>[] = [];
  let aliases: Record<string, unknown>[] = [];
  try {
    places = await pull<Record<string, unknown>>('places', placeCols.join(','), '', []);
    aliases = await pull<Record<string, unknown>>('place_aliases', aliasCols.join(','), '', [],
      'alias, country');
  } catch (e) {
    console.warn(`\n  ! gazetteer not in D1 yet (${(e as Error).message}) — run \`npm run gazetteer && npm run sync\``);
  }

  const clusterCols = ['id','headline','crux','category','place','country','place_id','importance','image_url','image_source',
    'framing_left','framing_centre','framing_right',
    'article_count','source_count','first_seen','last_seen','summarised_at','summarised_n','attempts'];
  const haveClusterCols = (await columns('clusters', clusterCols)).join(',');
  const clusters = await pull<Record<string, unknown>>('clusters',
    haveClusterCols, 'WHERE last_seen >= ?', [since]);

  const articleCols = ['id','source_id','url','title','lead','body','image_url','published_at','fetched_at',
    'content_hash','cluster_id'];
  const articles = await pull<Record<string, unknown>>('articles', articleCols.join(','),
    'WHERE published_at >= ?', [since]);

  // The two windows do not have to agree, and in practice they do not: an
  // article published inside the window can belong to a cluster whose last_seen
  // is outside it, and articles.cluster_id is a foreign key the local store
  // enforces. Fetch exactly the parents the articles ask for.
  const have = new Set(clusters.map((c) => c.id as string));
  const orphans = [...new Set(articles
    .map((a) => a.cluster_id as string | null)
    .filter((id): id is string => !!id && !have.has(id)))];

  if (orphans.length) {
    const before = clusters.length;
    const d = await d1();
    for (let i = 0; i < orphans.length; i += 100) {
      const chunk = orphans.slice(i, i + 100);
      const rows = await d.all<Record<string, unknown>>(
        `SELECT ${haveClusterCols} FROM clusters WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      clusters.push(...rows);
      for (const r of rows) have.add(r.id as string);
    }
    console.log(`  clusters: +${clusters.length - before} parents outside the window`);
  }

  // A parent that is not in D1 at all was deleted there, by a sync that ran
  // before it knew to release its children. Null the link rather than drop the
  // article: the row is real, and the clusterer will find it a new home on this
  // very run, which sync then writes back.
  let released = 0;
  for (const a of articles) {
    if (a.cluster_id && !have.has(a.cluster_id as string)) { a.cluster_id = null; released++; }
  }
  if (released) console.warn(`  ! ${released} articles released: their cluster is gone from D1`);

  const prefsCols = ['user_id','country','categories','places','place_ids','geo_consent','geo_place_id'];
  const prefs = await pull<Record<string, unknown>>('prefs',
    (await columns('prefs', prefsCols)).join(','), '', []);

  // Only now, with the whole working set in hand, is the local file replaced —
  // a D1 error above must never leave the machine with neither copy.
  if (!places.length) ({ places, aliases } = localGazetteer(path, placeCols, aliasCols));
  if (process.env.HYDRATE_FRESH !== '0') {
    mkdirSync(dirname(path), { recursive: true });
    for (const suffix of ['', '-wal', '-shm', '.t0']) rmSync(path + suffix, { force: true });
  }

  const local = db();                 // creates the schema
  insertAll(local, 'sources', ['id','name','feed_url','homepage','country','category','bias'], sources);
  insertAll(local, 'places', placeCols, places);
  insertAll(local, 'place_aliases', aliasCols, aliases);
  insertAll(local, 'clusters', clusterCols, clusters);
  insertAll(local, 'articles', articleCols, articles);
  insertAll(local, 'prefs', prefsCols, prefs);

  console.log(`\nLocal store rebuilt: ${sources.length} sources, ${clusters.length} clusters, ` +
              `${articles.length} articles, ${places.length} places, ${aliases.length} aliases`);
}

main().then(() => process.exit(0));
