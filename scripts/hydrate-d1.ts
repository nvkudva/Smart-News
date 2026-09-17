import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { d1 } from '../src/lib/d1';
import { checkpoint, db } from '../src/lib/db';

/**
 * Rebuild the local SQLite working store from D1.
 *
 * The pipeline is written against local SQLite because a cluster run issues
 * thousands of statements. On a CI runner there is no disk that survives
 * between runs, so the working set is pulled down at the start and pushed back
 * at the end. D1 is the durable copy; the local file is scratch.
 */

// Wider than the 4 days clustering keeps an unwritten article in play: a
// candidate the runner cannot see is one it cannot match a late second source
// to, which is the whole point of that window.
const WINDOW_MS = 5 * 24 * 3_600_000;
const PAGE = 400;

async function pull<T>(table: string, cols: string, where: string, params: unknown[],
                       orderBy?: string): Promise<T[]> {
  const d = await d1();
  const out: T[] = [];
  // Every table's primary key comes first, except where it is composite — then
  // the caller passes the whole key, or paging silently skips and repeats rows.
  //
  // A composite one has to be compared as a row value. Interpolating it into
  // `${key} > ?` reads as `alias, country > ?`, which is a syntax error, and
  // the cursor then looked itself up under the literal column name
  // "alias, country" and found undefined - so place_aliases came back as its
  // first page and was reported as a gazetteer D1 did not have. It had 996.
  const keys = (orderBy ?? cols.split(',')[0]).split(',').map((k) => k.trim());
  const order = keys.join(', ');
  const after1 = keys.length === 1
    ? `${keys[0]} > ?`
    : `(${order}) > (${keys.map(() => '?').join(', ')})`;
  // Keyset, not OFFSET. `OFFSET n` makes SQLite walk and discard n rows before
  // returning any, so paging a table costs roughly half its length squared over
  // the page size — measured at 2.8M rows a day against a 5M daily allowance,
  // for 5.5k articles. Carrying the last key read instead makes it linear.
  let after: unknown[] | null = null;
  for (;;) {
    const clause = after === null ? where : `${where ? `${where} AND` : 'WHERE'} ${after1}`;
    const page = await d.all<T>(
      `SELECT ${cols} FROM ${table} ${clause} ORDER BY ${order} LIMIT ${PAGE}`,
      after === null ? params : [...params, ...after]);
    out.push(...page);
    process.stdout.write(`\r  ${table}: ${out.length}`);
    if (page.length < PAGE) break;
    const last = page[page.length - 1] as Record<string, unknown>;
    after = keys.map((k) => last[k]);
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

/**
 * Is the file on disk already this pipeline's own working set?
 *
 * The runner used to have no disk that survived, so every cycle rebuilt the
 * store from D1 — ~14k rows a run, and the pipeline's entire read cost, to
 * re-download five days of rows of which about fifty had changed.
 *
 * With the file cached between runs there is nothing to rebuild: this pipeline
 * is the only writer of articles and clusters on D1, so a file it wrote last
 * cycle already holds what D1 holds. The site writes only prefs, saved and
 * events, and prefs are deliberately never pushed, so they are pulled fresh
 * below either way.
 *
 * That holds only while the file IS the one the last sync wrote, and nothing
 * guarantees the Actions cache hands that one back. `restore-keys:
 * smartnews-db-` matches by prefix, so a run whose save step never happened -
 * a cancellation, a timeout, a failed job - restores whatever older entry the
 * prefix still matches. Entries are also evicted, by age and by the repo's
 * 10 GB ceiling. Counting articles cannot tell those apart: a file days out of
 * date has recent articles too, passes the check, and skips the cluster pull
 * entirely, so the runner re-clusters and re-summarises work D1 already holds
 * and then pushes its own older answer back over it.
 *
 * So the file has to say which push of D1 it is. `sync` writes the same token
 * into D1's sync_meta and into the file, D1 first; they agree only when this
 * file recorded the push D1 currently holds. Anything else and we pay for the
 * full rebuild, which is the old behaviour and always correct.
 *
 * Recency is deliberately NOT part of this. A matching token already means the
 * file agrees with D1, and D1 being itself stale is a separate outage - one
 * where forcing a 14,000-row rebuild every half hour would be the wrong answer.
 */
async function usableLocalStore(path: string, since: number): Promise<boolean> {
  if (process.env.HYDRATE_FRESH === '1') return false;
  if (!existsSync(path)) return false;

  let held: string | null = null;
  try {
    const old = new DatabaseSync(path, { readOnly: true });
    try {
      const row = old.prepare('SELECT COUNT(*) AS n FROM articles WHERE published_at >= ?').get(since) as
        { n: number } | undefined;
      if (!(row?.n ?? 0)) return false;
      // Absent on a file written before this shipped, and on one no sync has
      // finished against. Both are stale by this rule, which is the safe way
      // round: one extra rebuild, once.
      const meta = old.prepare(`SELECT value FROM local_meta WHERE key = 'store'`).get() as
        { value: string } | undefined;
      held = meta?.value ?? null;
    } finally {
      // Before any checkpoint runs: TRUNCATE gives up while a reader is
      // attached, and this one would otherwise stay open for the whole run.
      old.close();
    }
  } catch {
    return false;                     // no schema, no local_meta, unreadable file
  }
  if (!held) {
    console.log('Cached store carries no sync token — rebuilding');
    return false;
  }

  const d = await d1();
  const remote = await d.get<{ value: string }>(`SELECT value FROM sync_meta WHERE key = 'store'`);
  if (remote?.value !== held) {
    console.log(`Cached store is from another push (${held} vs ${remote?.value ?? 'none'}) — rebuilding`);
    return false;
  }
  return true;
}

/**
 * Top up a cached store: the small tables whole, and anything published since
 * the newest article it already holds. A few hundred rows rather than 14,000.
 */
async function topUp(path: string): Promise<void> {
  const local = new DatabaseSync(path);
  const newest = (local.prepare('SELECT COALESCE(MAX(fetched_at), 0) AS t FROM articles').get() as
    { t: number }).t;
  local.close();

  const sources = await pull<Record<string, unknown>>('sources',
    'id,name,feed_url,homepage,country,category,bias,tier', '', []);
  const prefsCols = ['user_id','country','categories','places','place_ids','geo_consent','geo_place_id'];
  const prefs = await pull<Record<string, unknown>>('prefs',
    (await columns('prefs', prefsCols)).join(','), '', []);
  // Anything another runner pushed while this file sat in the cache. Normally
  // empty: one cycle runs at a time, and it is the one that wrote this file.
  const articleCols = ['id','source_id','url','title','lead','body','image_url','published_at','fetched_at',
    'content_hash','cluster_id','prominent'];
  const fresh = await pull<Record<string, unknown>>('articles', articleCols.join(','),
    'WHERE fetched_at > ?', [newest]);

  const d = db();
  insertAll(d, 'sources', ['id','name','feed_url','homepage','country','category','bias','tier'], sources);
  insertAll(d, 'prefs', prefsCols, prefs);
  if (fresh.length) {
    // Their parents may not be here; the clusterer will file them either way.
    for (const a of fresh) a.cluster_id = null;
    insertAll(d, 'articles', articleCols, fresh);
  }
  console.log(`Cached store reused: +${fresh.length} articles, ${sources.length} sources, ${prefs.length} prefs`);
}

async function main() {
  const path = process.env.SMARTNEWS_DB ?? 'data/smartnews.db';
  const since = Date.now() - WINDOW_MS;

  if (await usableLocalStore(path, since)) return topUp(path);

  console.log('Pulling from D1…');

  const sources = await pull<Record<string, unknown>>('sources',
    'id,name,feed_url,homepage,country,category,bias,tier', '', []);

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
    'article_count','source_count','prominence','first_seen','last_seen','summarised_at','summarised_n','attempts'];
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
  insertAll(local, 'sources', ['id','name','feed_url','homepage','country','category','bias','tier'], sources);
  insertAll(local, 'places', placeCols, places);
  insertAll(local, 'place_aliases', aliasCols, aliases);
  insertAll(local, 'clusters', clusterCols, clusters);
  insertAll(local, 'articles', articleCols, articles);
  insertAll(local, 'prefs', prefsCols, prefs);

  console.log(`\nLocal store rebuilt: ${sources.length} sources, ${clusters.length} clusters, ` +
              `${articles.length} articles, ${places.length} places, ${aliases.length} aliases`);
}

main().then(() => {
  // Both paths leave rows in the WAL, and the cache saves the database file
  // without it.
  checkpoint();
  process.exit(0);
});
