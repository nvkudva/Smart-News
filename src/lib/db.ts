import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.SMARTNEWS_DB ?? resolve(process.cwd(), 'data/smartnews.db');

let handle: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (handle) return handle;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  handle = new DatabaseSync(DB_PATH);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  migrate(handle);
  return handle;
}

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      feed_url    TEXT NOT NULL,
      homepage    TEXT,
      country     TEXT,
      category    TEXT,
      bias        TEXT
    );

    CREATE TABLE IF NOT EXISTS articles (
      id            TEXT PRIMARY KEY,
      source_id     TEXT NOT NULL REFERENCES sources(id),
      url           TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      lead          TEXT,
      body          TEXT,
      image_url     TEXT,
      published_at  INTEGER NOT NULL,
      fetched_at    INTEGER NOT NULL,
      content_hash  TEXT,
      cluster_id    TEXT REFERENCES clusters(id)
    );
    CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS articles_cluster   ON articles(cluster_id);
    CREATE INDEX IF NOT EXISTS articles_hash      ON articles(content_hash);

    CREATE TABLE IF NOT EXISTS clusters (
      id             TEXT PRIMARY KEY,
      headline       TEXT,
      crux           TEXT,
      category       TEXT,
      place          TEXT,
      country        TEXT,
      importance     INTEGER DEFAULT 3,
      image_url      TEXT,
      article_count  INTEGER NOT NULL DEFAULT 0,
      source_count   INTEGER NOT NULL DEFAULT 0,
      first_seen     INTEGER NOT NULL,
      last_seen      INTEGER NOT NULL,
      summarised_at  INTEGER,
      summarised_n   INTEGER DEFAULT 0,
      attempts       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS clusters_last_seen ON clusters(last_seen DESC);

    CREATE TABLE IF NOT EXISTS prefs (
      user_id     TEXT PRIMARY KEY,
      country     TEXT,
      categories  TEXT,
      places      TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      kind       TEXT NOT NULL,
      dwell_ms   INTEGER,
      ts         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_user ON events(user_id, ts DESC);

    CREATE TABLE IF NOT EXISTS saved (
      user_id    TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      saved_at   INTEGER NOT NULL,
      PRIMARY KEY (user_id, cluster_id)
    );
  `);

  // Added after the first backfill; existing databases predate the column.
  const cols = d.prepare('PRAGMA table_info(clusters)').all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === 'attempts')) {
    d.exec('ALTER TABLE clusters ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  }
}

export const CATEGORIES = [
  'World', 'India', 'Politics', 'Business', 'Technology',
  'Science', 'Health', 'Sports', 'Entertainment', 'Climate',
] as const;
export type Category = (typeof CATEGORIES)[number];
