import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { d1, type D1 } from '../src/lib/d1';
import { applySchema } from './d1-schema';

/**
 * Push the local pipeline's finished rows up to D1, which is what the deployed
 * site reads. The pipeline itself stays on SQLite: a cluster run issues
 * thousands of statements, and over HTTP each one would be a round trip.
 *
 * Article bodies ARE synced, even though the site never shows them: with the
 * pipeline running on a stateless CI runner, D1 is the only copy of the working
 * set, and `hydrate` needs bodies to re-summarise a cluster that grew.
 */


// Must match hydrate's WINDOW_MS: anything older is never read back down, so
// pushing it is a write D1 bills for and nothing ever reads.
const WINDOW_MS = 5 * 24 * 3_600_000;

/**
 * A cluster is worth re-pushing only if this cycle touched it: it was
 * re-summarised, an article published into it, or one of the articles fetched
 * this run joined it. The third clause is what keeps a merge consistent — the
 * losing cluster's articles move without their own timestamps changing.
 */
const TOUCHED = `(summarised_at >= ? OR last_seen >= ?
                  OR id IN (SELECT cluster_id FROM articles WHERE fetched_at >= ?))`;

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

/**
 * The seed tables — sources and the gazetteer — move only when someone edits
 * the seed, but INSERT OR REPLACE bills a row write whether or not the value
 * changed. At 96 cycles a day those three tables alone were 131k writes against
 * D1's 100k free daily limit, which is the whole of the overage. Fingerprint
 * them and push only when the content actually differs from what D1 last got.
 * The fingerprint lives in D1 because the runner keeps nothing between cycles.
 */
async function pushSeed(d: D1, table: string, cols: string[], rows: Record<string, unknown>[]) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(rows.map((r) => cols.map((c) => r[c] ?? null))))
    .digest('hex');
  const key = `fingerprint:${table}`;

  if (process.env.SYNC_FULL !== '1') {
    const seen = await d.get<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
    if (seen?.value === fingerprint) { console.log(`  ${table}: unchanged`); return; }
  }
  await push(table, cols, rows);
  await d.run('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, fingerprint]);
}

/** Start of the cycle whose output we are pushing; null means push the window. */
function cycleStart(dbPath: string): number | null {
  if (process.env.SYNC_FULL === '1') return null;
  try { return Number(readFileSync(`${dbPath}.t0`, 'utf8').trim()) || null; } catch { return null; }
}

/**
 * Clusters vanish locally when two of them merge (src/lib/cluster.ts). Left in
 * D1 they are ghost stories: a second card for an event that already has one,
 * opening on an empty article list.
 */
async function reap(d: D1, local: DatabaseSync, since: number) {
  const rows = local.prepare('SELECT id FROM clusters WHERE last_seen >= ?')
    .all(since as never) as unknown as { id: string }[];
  const localIds = new Set(rows.map((r) => r.id));
  const remote = await remoteClusterIds(d, since);
  const ghosts = remote.filter((id) => !localIds.has(id));
  if (!ghosts.length) return;

  // A store that was never hydrated looks exactly like "every story merged".
  if (ghosts.length > remote.length / 10) {
    console.warn(`  ! ${ghosts.length}/${remote.length} clusters absent locally — not deleting; hydrate first`);
    return;
  }
  for (let i = 0; i < ghosts.length; i += MAX_PARAMS) {
    const batch = ghosts.slice(i, i + MAX_PARAMS);
    // Release the children first. D1 does not enforce the foreign key, so a
    // cluster deleted out from under its articles leaves them pointing at
    // nothing — and the next hydrate, into a store that does enforce it, dies
    // on the insert. A null cluster_id is also the truth, and puts the article
    // back in front of the clusterer.
    await d.run(
      `UPDATE articles SET cluster_id = NULL WHERE cluster_id IN (${batch.map(() => '?').join(',')})`, batch);
    await d.run(`DELETE FROM clusters WHERE id IN (${batch.map(() => '?').join(',')})`, batch);
  }
  console.log(`  clusters: ${ghosts.length} merged away, deleted`);
}

/** Cluster ids D1 holds inside the window, paged because D1 caps a result set. */
async function remoteClusterIds(d: D1, since: number): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 400) {
    const page = await d.all<{ id: string }>(
      `SELECT id FROM clusters WHERE last_seen >= ? ORDER BY id LIMIT 400 OFFSET ${offset}`, [since]);
    out.push(...page.map((r) => r.id));
    if (page.length < 400) break;
  }
  return out;
}

async function main() {
  const dbPath = process.env.SMARTNEWS_DB ?? 'data/smartnews.db';
  const local = new DatabaseSync(dbPath, { readOnly: true });
  const d = await d1();

  console.log('Schema…');
  await applySchema(d, (s) => console.log(s));

  const since = Date.now() - WINDOW_MS;
  const all = <T,>(sql: string, ...p: unknown[]) => local.prepare(sql).all(...(p as never[])) as unknown as T[];

  // `cycle` stamps its start time on the way out. Pushing only what it touched
  // turns ~2,800 rows every quarter hour into a few dozen; with no stamp (a
  // cycle that died, or SYNC_FULL=1 for a repair run) fall back to the window.
  const t0 = cycleStart(dbPath);

  console.log(t0 ? `Pushing what changed since ${new Date(t0).toISOString().slice(11, 19)}…` : 'Pushing the full window…');
  await pushSeed(d, 'sources', ['id', 'name', 'feed_url', 'homepage', 'country', 'category', 'bias'],
    all('SELECT id,name,feed_url,homepage,country,category,bias FROM sources'));

  // The gazetteer goes up whole or not at all — a changed-since column would
  // not pay for itself on a few hundred rows — but it goes up only when its
  // fingerprint moved. It precedes clusters, which point into it.
  const placeCols = ['id','kind','name','label','country','admin1_id','parent_id','lat','lon','population','updated_at'];
  await pushSeed(d, 'places', placeCols, all(`SELECT ${placeCols.join(',')} FROM places`));
  const aliasCols = ['alias','country','place_id','source','confidence','updated_at'];
  await pushSeed(d, 'place_aliases', aliasCols, all(`SELECT ${aliasCols.join(',')} FROM place_aliases`));

  const clusterCols = `id,headline,crux,category,place,country,place_id,importance,image_url,
            framing_left,framing_centre,framing_right,
            article_count,source_count,first_seen,last_seen,summarised_at,summarised_n,attempts`;
  const clusters = t0
    ? all<Record<string, unknown>>(
        `SELECT ${clusterCols} FROM clusters WHERE last_seen >= ? AND ${TOUCHED}`, since, t0, t0, t0)
    : all<Record<string, unknown>>(`SELECT ${clusterCols} FROM clusters WHERE last_seen >= ?`, since);
  await push('clusters',
    ['id','headline','crux','category','place','country','place_id','importance','image_url',
     'framing_left','framing_centre','framing_right',
     'article_count','source_count','first_seen','last_seen','summarised_at','summarised_n','attempts'],
    clusters);

  await reap(d, local, since);

  const articleCols = `id,source_id,url,title,lead,body,image_url,published_at,fetched_at,
            content_hash,cluster_id`;
  const articles = t0
    ? all<Record<string, unknown>>(
        `SELECT ${articleCols} FROM articles
          WHERE published_at >= ?
            AND (fetched_at >= ? OR cluster_id IN (SELECT id FROM clusters WHERE ${TOUCHED}))`,
        since, t0, t0, t0, t0)
    : all<Record<string, unknown>>(`SELECT ${articleCols} FROM articles WHERE published_at >= ?`, since);
  await push('articles',
    ['id','source_id','url','title','lead','body','image_url','published_at',
     'fetched_at','content_hash','cluster_id'], articles);

  // prefs are deliberately not pushed: the web app is the only writer, and a
  // sync that carried the hydrated copy back up would revert whatever the
  // reader changed while the cycle was running.

  const counts = await d.get<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM sources) AS sources,
            (SELECT COUNT(*) FROM clusters) AS clusters,
            (SELECT COUNT(*) FROM articles) AS articles,
            (SELECT COUNT(*) FROM places) AS places,
            (SELECT COUNT(*) FROM place_aliases) AS aliases`);
  console.log('\nD1 now holds:', JSON.stringify(counts));
}

main().then(() => process.exit(0));
