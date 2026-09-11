import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1 } from '../src/lib/d1';

/**
 * The D1 schema, and the migration that brings a live database up to it.
 *
 * This lives apart from sync-d1.ts because schema and rows have different
 * lifetimes: a column added in a release has to reach D1 the moment that
 * release deploys, whereas rows only move on the pipeline's 15-minute cycle.
 * Keeping the DDL here lets `npm run migrate:d1` apply it on its own, without
 * a local SQLite file and without pushing a single row.
 *
 * Mirrors migrate() in src/lib/db.ts. Both must change together — and that was
 * an aspiration rather than a fact until `npm run build:check` started
 * comparing them: three indexes had drifted out of this file, one of them on
 * the deployed read path. See indexNames() and the check in migrate-d1.ts.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL,
  country TEXT NOT NULL, admin1_id TEXT, parent_id TEXT, lat REAL, lon REAL,
  population INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS place_aliases (
  alias TEXT NOT NULL, country TEXT NOT NULL DEFAULT '', place_id TEXT NOT NULL,
  source TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
  PRIMARY KEY (alias, country));
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT NOT NULL,
  homepage TEXT, country TEXT, category TEXT, bias TEXT);
CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY, headline TEXT, crux TEXT, category TEXT, place TEXT,
  country TEXT, importance INTEGER DEFAULT 3, image_url TEXT, image_source TEXT,
  article_count INTEGER NOT NULL DEFAULT 0, source_count INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  summarised_at INTEGER, summarised_n INTEGER DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  place_id TEXT,
  framing_left TEXT, framing_centre TEXT, framing_right TEXT);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
  lead TEXT, body TEXT, image_url TEXT, published_at INTEGER NOT NULL,
  fetched_at INTEGER, content_hash TEXT, cluster_id TEXT);
CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT PRIMARY KEY, country TEXT, categories TEXT, places TEXT,
  place_ids TEXT, geo_consent INTEGER NOT NULL DEFAULT 0, geo_place_id TEXT);
CREATE TABLE IF NOT EXISTS saved (
  user_id TEXT NOT NULL, cluster_id TEXT NOT NULL, saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, cluster_id));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, cluster_id TEXT NOT NULL,
  kind TEXT NOT NULL, dwell_ms INTEGER, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Only a quarter of clusters are ever summarised, and every query that orders
-- by last_seen also filters headline IS NOT NULL, so the index walk was
-- stepping over three unsummarised rows for each one it could use. New names
-- rather than a rebuild of the old: both the DROPs and the CREATEs then settle
-- into no-ops on every run after the first.
DROP INDEX IF EXISTS clusters_last_seen;
DROP INDEX IF EXISTS clusters_category;
DROP INDEX IF EXISTS clusters_country;
CREATE INDEX IF NOT EXISTS clusters_live_last_seen ON clusters(last_seen DESC) WHERE headline IS NOT NULL;
CREATE INDEX IF NOT EXISTS clusters_live_category ON clusters(category, last_seen DESC) WHERE headline IS NOT NULL;
CREATE INDEX IF NOT EXISTS clusters_live_country ON clusters(country, last_seen DESC) WHERE headline IS NOT NULL;
CREATE INDEX IF NOT EXISTS articles_cluster ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at DESC);
-- Missing from D1 until now, though db.ts has had it since place_id existed.
-- getLocalFeed and getByPlace both filter on c.place_id, so the Local
-- tab and every Explore place tile were falling back to the last_seen index
-- and filtering. The drift went unnoticed because the pipeline reads places
-- from the local file, so only the deployed read path ever paid for it.
CREATE INDEX IF NOT EXISTS clusters_place ON clusters(place_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS places_country ON places(country, kind);
CREATE INDEX IF NOT EXISTS places_admin1 ON places(admin1_id);
`;

/**
 * Columns the SCHEMA above cannot deliver. Every statement in it is CREATE
 * TABLE IF NOT EXISTS, which is a silent no-op against the live tables — so a
 * column added after those tables were first created has to be ALTERed in, the
 * same way db.ts does it locally.
 */
export const ADDED_COLUMNS: Record<string, [string, string][]> = {
  clusters: [
    ['place_id', 'place_id TEXT'],
    ['framing_left', 'framing_left TEXT'],
    ['framing_centre', 'framing_centre TEXT'],
    ['framing_right', 'framing_right TEXT'],
    ['image_source', 'image_source TEXT'],
  ],
  prefs: [
    ['place_ids', 'place_ids TEXT'],
    ['geo_consent', 'geo_consent INTEGER NOT NULL DEFAULT 0'],
    ['geo_place_id', 'geo_place_id TEXT'],
  ],
};

/** Index names this schema declares, for the drift check against db.ts. */
export function indexNames(): string[] {
  return [...SCHEMA.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
}

const LOCAL_ONLY = new Set([
  // content_hash is read only while clustering, which runs against the local
  // file. An index D1 never queries would still cost a write on every synced
  // article, and D1 bills those.
  'articles_hash',
]);

export function indexDrift(): string[] {
  const local = readFileSync(resolve(process.cwd(), 'src/lib/db.ts'), 'utf8');
  const declared = new Set(indexNames());
  const inLocal = [...local.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  // One direction only: db.ts also indexes columns the site never reads, and
  // the partial cluster indexes are named the same in both.
  return [...new Set(inLocal)].filter((n) => !declared.has(n) && !LOCAL_ONLY.has(n)).sort();
}

/** Which of ADDED_COLUMNS are not on the live database yet, table by table. */
export async function missingColumns(d: D1): Promise<[string, string, string][]> {
  const out: [string, string, string][] = [];
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const info = await d.all<{ name: string }>(`PRAGMA table_info(${table})`);
    // No rows means the table itself is absent; CREATE TABLE will bring it in
    // complete, so there is nothing to ALTER.
    if (!info.length) continue;
    const have = new Set(info.map((c) => c.name));
    for (const [name, ddl] of columns) if (!have.has(name)) out.push([table, name, ddl]);
  }
  return out;
}

/** Additive and idempotent: safe to run against a live database on every deploy. */
export async function applySchema(d: D1, log: (s: string) => void = () => {}) {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await d.run(stmt);
  for (const [table, name, ddl] of await missingColumns(d)) {
    await d.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    log(`  ${table}: added ${name}`);
  }
}
