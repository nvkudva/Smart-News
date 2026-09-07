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
 * Mirrors migrate() in src/lib/db.ts. Both must change together.
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
  country TEXT, importance INTEGER DEFAULT 3, image_url TEXT,
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
CREATE INDEX IF NOT EXISTS clusters_last_seen ON clusters(last_seen DESC);
CREATE INDEX IF NOT EXISTS clusters_category ON clusters(category, last_seen DESC);
CREATE INDEX IF NOT EXISTS clusters_country ON clusters(country, last_seen DESC);
CREATE INDEX IF NOT EXISTS articles_cluster ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at DESC);
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
  ],
  prefs: [
    ['place_ids', 'place_ids TEXT'],
    ['geo_consent', 'geo_consent INTEGER NOT NULL DEFAULT 0'],
    ['geo_place_id', 'geo_place_id TEXT'],
  ],
};

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
