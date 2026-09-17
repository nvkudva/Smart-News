import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { recountClusters } from '../src/lib/cluster';
import { checkpoint } from '../src/lib/db';
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

// D1 caps bound parameters per statement, so rows go up in small batches.
const MAX_PARAMS = 90;

/** SQLite caps bound parameters, so read a long id list in slices. */
function inChunks<T>(ids: string[], read: (slice: string[]) => T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += MAX_PARAMS - 1) out.push(...read(ids.slice(i, i + MAX_PARAMS - 1)));
  return out;
}

/**
 * Upsert, and D1 bills what this touches.
 *
 * `INSERT OR REPLACE` was a DELETE followed by an INSERT: it rewrote every
 * index entry of every row it sent, whether or not the indexed column had
 * changed, and D1 counts index writes as rows written. clusters carries four
 * indexes and articles two, so a re-pushed cluster whose source_count moved was
 * billed for rewriting its category, country, place and last_seen entries as
 * well. `ON CONFLICT DO UPDATE` updates in place, and SQLite then touches only
 * the indexes whose columns actually changed.
 *
 * The WHERE makes a row that is byte-identical to what D1 already holds free
 * rather than merely cheap. That is a small share of a normal push - measured
 * at 66 of 4,020 rows, 1.6% - because the dirty list is already tight. It is
 * here because it is one clause with no bookkeeping behind it, and because the
 * cost of the dirty list ever loosening is then bounded.
 *
 * `IS NOT` rather than `<>`: half these columns are nullable, and `<>` against
 * NULL is NULL, which would make every row with a null headline look changed.
 */
async function push(table: string, cols: string[], rows: Record<string, unknown>[], key = ['id']) {
  const d = await d1();
  const perBatch = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  const placeholder = `(${cols.map(() => '?').join(',')})`;
  const rest = cols.filter((c) => !key.includes(c));
  const onConflict = rest.length
    ? `ON CONFLICT(${key.join(',')}) DO UPDATE SET ` +
      rest.map((c) => `${c}=excluded.${c}`).join(',') +
      ` WHERE ` + rest.map((c) => `${table}.${c} IS NOT excluded.${c}`).join(' OR ')
    : `ON CONFLICT(${key.join(',')}) DO NOTHING`;
  let done = 0;

  for (let i = 0; i < rows.length; i += perBatch) {
    const batch = rows.slice(i, i + perBatch);
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ` +
                batch.map(() => placeholder).join(',') + ' ' + onConflict;
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
/** The names in a SELECT list, so a push cannot name a different set. */
const colList = (sql: string) => sql.split(',').map((c) => c.trim()).filter(Boolean);

async function pushSeed(d: D1, table: string, cols: string[], rows: Record<string, unknown>[], pk = ['id']) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(rows.map((r) => cols.map((c) => r[c] ?? null))))
    .digest('hex');
  const key = `fingerprint:${table}`;

  if (process.env.SYNC_FULL !== '1') {
    const seen = await d.get<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
    if (seen?.value === fingerprint) { console.log(`  ${table}: unchanged`); return; }
  }
  await push(table, cols, rows, pk);
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

  // A store that was never hydrated looks exactly like "every story merged",
  // so the deletion is refused. It used to warn and carry on, which meant the
  // ghosts stayed in D1 - a second card for an event that already has one -
  // and accumulated, with the only record a console line in a runner log
  // nobody reads. Thrown instead, so the run goes red and the Actions tab says
  // what happened. Everything above this point has already been pushed; what
  // is skipped is the cycle stamp and the store token, which is the safe half
  // to skip - the next hydrate sees no matching token and rebuilds.
  if (ghosts.length > remote.length / 10) {
    throw new Error(
      `${ghosts.length}/${remote.length} clusters absent locally — refusing to delete. ` +
      `The working store is behind D1; hydrate before syncing.`);
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

/**
 * Delete what fell out of the window. `sync` has always pushed a five-day slice
 * and `hydrate` has always read the same slice back, but nothing removed the
 * far side, so article rows — bodies included, up to 8000 characters each —
 * accumulated for the life of the database. Everything downstream paid for it:
 * D1 bills rows read, and the table only ever grew.
 *
 * Ids are collected before anything is deleted rather than issuing one
 * `DELETE ... WHERE published_at < ?`: D1 caps how long a statement may run and
 * how much it may touch, and the first prune against a store that has been
 * growing since the beginning has months to remove, not days.
 *
 * Clusters go first for the reverse of reap's reason. A cluster whose articles
 * are all outside the window has nothing left to re-summarise from, and leaving
 * it would strand a headline over an empty source list.
 */
async function prune(d: D1, since: number) {
  const stale: string[] = [];
  let after = '';
  for (;;) {
    const page = await d.all<{ id: string }>(
      `SELECT id FROM articles WHERE published_at < ? AND id > ? ORDER BY id LIMIT 400`,
      [since, after]);
    stale.push(...page.map((r) => r.id));
    if (page.length < 400) break;
    after = page[page.length - 1].id;
    // One prune is a cycle step with fourteen minutes of company. Anything this
    // run does not reach, the next one does, and the window only moves forward.
    if (stale.length >= 20_000) break;
  }
  if (!stale.length) return;

  for (let i = 0; i < stale.length; i += MAX_PARAMS) {
    const batch = stale.slice(i, i + MAX_PARAMS);
    const marks = batch.map(() => '?').join(',');
    await d.run(`DELETE FROM articles WHERE id IN (${marks})`, batch);
  }

  // Clusters the prune just emptied. Counted rather than joined: D1 has no
  // foreign-key cascade here, and article_count is the column the site reads.
  const orphans = await d.all<{ id: string }>(
    `SELECT id FROM clusters WHERE last_seen < ?
       AND id NOT IN (SELECT cluster_id FROM articles WHERE cluster_id IS NOT NULL)`,
    [since]);
  for (let i = 0; i < orphans.length; i += MAX_PARAMS) {
    const batch = orphans.slice(i, i + MAX_PARAMS).map((r) => r.id);
    await d.run(`DELETE FROM clusters WHERE id IN (${batch.map(() => '?').join(',')})`, batch);
  }
  console.log(`  pruned: ${stale.length} articles, ${orphans.length} emptied clusters`);
}

/**
 * The same window, applied to the file this runner keeps.
 *
 * It used to be rebuilt from D1 on every cycle, so nothing local ever outlived
 * the window on its own. Now that the file is carried between runs, nothing
 * deletes from it either: at ~1,500 articles a day with their body text that is
 * ~7MB a day, a couple of hundred megabytes in a month, and a cache entry that
 * grows until GitHub starts evicting it.
 *
 * VACUUM because SQLite does not return the pages a DELETE frees; without it
 * the file keeps the high-water mark for ever. It rewrites the file, which is a
 * second at this size, and only runs when something was actually removed.
 */
function pruneLocal(local: DatabaseSync, since: number): void {
  const before = (local.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }).n;
  // Which clusters are about to lose articles, asked before the delete because
  // afterwards there is nothing left to join on. A cluster that loses only SOME
  // of its articles survives the sweep below and used to keep the counts it had
  // when they were there — see recountClusters for what that cost.
  const losing = (local.prepare(
    `SELECT DISTINCT cluster_id AS id FROM articles
      WHERE published_at < ? AND cluster_id IS NOT NULL`).all(since) as unknown as
    { id: string }[]).map((r) => r.id);
  local.exec('BEGIN');
  local.prepare('DELETE FROM articles WHERE published_at < ?').run(since);
  // A cluster with nothing left to show is a headline over an empty source list.
  local.exec(`DELETE FROM clusters
               WHERE id NOT IN (SELECT DISTINCT cluster_id FROM articles WHERE cluster_id IS NOT NULL)`);
  // The survivors, now that the sweep above has taken the empty ones. Marked
  // dirty by hand rather than through markDirty, which opens db.ts's own handle
  // and not the one this script is holding mid-transaction.
  const recounted = recountClusters(local, losing);
  const dirty = local.prepare("INSERT OR IGNORE INTO dirty (kind, id) VALUES ('cluster', ?)");
  for (const id of recounted) dirty.run(id);
  // Rows that no longer exist cannot be owed to D1; the prune above told it.
  local.exec(`DELETE FROM dirty
               WHERE (kind = 'article' AND id NOT IN (SELECT id FROM articles))
                  OR (kind = 'cluster' AND id NOT IN (SELECT id FROM clusters))`);
  local.exec('COMMIT');
  const after = (local.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }).n;
  if (before === after) return;
  local.exec('VACUUM');
  console.log(`  local: ${before - after} articles dropped, file vacuumed`);
}

/** Cluster ids D1 holds inside the window, paged because D1 caps a result set. */
async function remoteClusterIds(d: D1, since: number): Promise<string[]> {
  const out: string[] = [];
  let after = '';
  for (;;) {
    const page = await d.all<{ id: string }>(
      `SELECT id FROM clusters WHERE last_seen >= ? AND id > ? ORDER BY id LIMIT 400`, [since, after]);
    out.push(...page.map((r) => r.id));
    if (page.length < 400) break;
    after = page[page.length - 1].id;
  }
  return out;
}

async function main() {
  const dbPath = process.env.SMARTNEWS_DB ?? 'data/smartnews.db';
  // Writable: the dirty list is cleared here, once a push has actually landed.
  const local = new DatabaseSync(dbPath);
  const d = await d1();

  console.log('Schema…');
  await applySchema(d, (s) => console.log(s));

  const since = Date.now() - WINDOW_MS;
  const all = <T,>(sql: string, ...p: unknown[]) => local.prepare(sql).all(...(p as never[])) as unknown as T[];

  // The pipeline records every row it changes as it changes it, so the sync
  // uploads exactly that and nothing else. Inferring the set from timestamps
  // sent an article up whenever anything in its cluster moved — one busy
  // 389-article story re-sent all 389 rows on every cycle — and still
  // missed a cluster whose count changed without its last_seen moving.
  //
  // The stamp survives as the fallback: a cycle that died before recording
  // anything, or SYNC_FULL=1 for a repair run, pushes the whole window.
  const t0 = cycleStart(dbPath);
  const full = !t0 || process.env.SYNC_FULL === '1';
  const dirtyIds = (kind: string) =>
    (local.prepare('SELECT id FROM dirty WHERE kind = ?').all(kind) as unknown as { id: string }[])
      .map((r) => r.id);

  console.log(full ? 'Pushing the full window…' : 'Pushing what the cycle recorded as changed…');
  // One list, read and written. Holding the SELECT and the column list apart
  // let `tier` be added to the second and not the first, which pushed a null
  // tier over all 72 rows: every front-page source read as an ordinary one.
  const sourceCols = ['id', 'name', 'feed_url', 'homepage', 'country', 'category', 'bias', 'tier'];
  await pushSeed(d, 'sources', sourceCols, all(`SELECT ${sourceCols.join(',')} FROM sources`));

  // The gazetteer goes up whole or not at all — a changed-since column would
  // not pay for itself on a few hundred rows — but it goes up only when its
  // fingerprint moved. It precedes clusters, which point into it.
  const placeCols = ['id','kind','name','label','country','admin1_id','parent_id','lat','lon','population','updated_at'];
  await pushSeed(d, 'places', placeCols, all(`SELECT ${placeCols.join(',')} FROM places`));
  const aliasCols = ['alias','country','place_id','source','confidence','updated_at'];
  await pushSeed(d, 'place_aliases', aliasCols, all(`SELECT ${aliasCols.join(',')} FROM place_aliases`), ['alias', 'country']);

  // Articles before clusters, and the order is the whole point.
  //
  // A cluster row carries article_count and source_count for rows that live in
  // the articles table. D1 enforces no foreign key, so whichever of the two
  // pushes does not happen leaves the other standing on its own. Push the
  // counts first and a run that dies in between - the job's twelve-minute
  // timeout, a cancellation, the D1 blip this branch also fixes - leaves D1
  // serving stories that claim five sources over articles it never received,
  // and the dirty list that would have repaired them dies with the file.
  //
  // The other way round the leftovers are invisible: an article whose cluster
  // is not there yet is only ever reached through that cluster, and the next
  // hydrate nulls its link and hands it back to the clusterer, which files it
  // again. Wrong-and-showing becomes absent-and-self-healing.
  const articleCols = `id,source_id,url,title,lead,body,image_url,published_at,fetched_at,
            content_hash,cluster_id,prominent`;
  const dirtyArticles = full ? [] : dirtyIds('article');
  const articles = full
    ? all<Record<string, unknown>>(`SELECT ${articleCols} FROM articles WHERE published_at >= ?`, since)
    : inChunks(dirtyArticles, (ids) => all<Record<string, unknown>>(
        `SELECT ${articleCols} FROM articles
          WHERE published_at >= ? AND id IN (${ids.map(() => '?').join(',')})`, since, ...ids));
  await push('articles', colList(articleCols), articles);

  const clusterCols = `id,headline,crux,category,place,country,place_id,importance,image_url,image_source,
            framing_left,framing_centre,framing_right,
            article_count,source_count,prominence,first_seen,last_seen,summarised_at,summarised_n,attempts`;
  const dirtyClusters = full ? [] : dirtyIds('cluster');
  const clusters = full
    ? all<Record<string, unknown>>(`SELECT ${clusterCols} FROM clusters WHERE last_seen >= ?`, since)
    : inChunks(dirtyClusters, (ids) => all<Record<string, unknown>>(
        `SELECT ${clusterCols} FROM clusters
          WHERE last_seen >= ? AND id IN (${ids.map(() => '?').join(',')})`, since, ...ids));
  await push('clusters', colList(clusterCols), clusters);

  await reap(d, local, since);

  // Cleared only once both pushes have landed: anything that threw above stays
  // on the list and goes up next cycle. Ids the window no longer covers are
  // cleared too — D1 has pruned them, and they would otherwise retry forever.
  if (!full) {
    const forget = local.prepare('DELETE FROM dirty WHERE kind = ? AND id = ?');
    for (const id of dirtyClusters) forget.run('cluster', id);
    for (const id of dirtyArticles) forget.run('article', id);
  }

  await prune(d, since);
  pruneLocal(local, since);

  // prefs are deliberately not pushed: the web app is the only writer, and a
  // sync that carried the hydrated copy back up would revert whatever the
  // reader changed while the cycle was running.

  // The stamp every cached response is validated against. It has to change
  // exactly when the readable feed could have changed and not one cycle sooner,
  // so it is derived from the data rather than from the clock: a cycle that
  // pushed nothing leaves it alone, and every client keeps its cache.
  //
  // MAX(last_seen) alone would miss a ghost merge, which deletes a cluster
  // without moving the maximum; the count catches that. Both read the partial
  // index rather than the table.
  const state = await d.get<{ n: number; m: number }>(
    `SELECT COUNT(*) AS n, COALESCE(MAX(last_seen), 0) AS m
       FROM clusters WHERE headline IS NOT NULL`);

  // The profile counters, computed here rather than on every profile render.
  // getStats used to COUNT(*) two whole tables per page view, and D1 bills rows
  // read. The local file is open and counts there are free.
  const counts = local.prepare(
    `SELECT (SELECT COUNT(*) FROM articles) AS articles,
            (SELECT COUNT(*) FROM clusters) AS clusters,
            (SELECT COUNT(*) FROM clusters WHERE headline IS NOT NULL) AS summarised,
            (SELECT COUNT(*) FROM sources) AS sources,
            (SELECT COALESCE(MAX(last_seen), 0) FROM clusters) AS newest`,
  ).get() as Record<string, number>;
  await d.run('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
              ['stats', JSON.stringify(counts)]);
  const cycle = `${state?.n ?? 0}-${state?.m ?? 0}`;
  const seen = await d.get<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', ['cycle']);
  if (seen?.value !== cycle) {
    await d.run('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', ['cycle', cycle]);
    console.log(`\nCycle stamp: ${cycle}`);
  } else {
    console.log(`\nCycle stamp: ${cycle} (unchanged)`);
  }

  // Which push of D1 this file is, so `hydrate` can tell the file that wrote
  // D1's current state from an older one the Actions cache happened to hand
  // back. A token rather than the cycle stamp above: that stamp is derived from
  // the data and deliberately does not move when a cycle pushed nothing, so two
  // different files can carry it.
  //
  // D1 first and the local copy second. Then the only way the two can disagree
  // is a file that never recorded a push D1 took, which reads as a stale file
  // and costs a full rebuild - correct, merely expensive. The reverse ordering
  // would let a file claim a push D1 never received.
  // `local` is a raw handle, not db(), so the migration that declares this
  // table has not necessarily run against this file.
  local.exec('CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const token = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  await d.run('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', ['store', token]);
  local.prepare('INSERT OR REPLACE INTO local_meta (key, value) VALUES (?, ?)').run('store', token);

  // The dirty list was cleared above and the prune ran; both are writes, and
  // the cache saves the database file without the WAL they are sitting in.
  checkpoint(local);
}

main().then(() => process.exit(0));
