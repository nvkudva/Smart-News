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
    CREATE TABLE IF NOT EXISTS places (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      name        TEXT NOT NULL,
      label       TEXT NOT NULL,
      country     TEXT NOT NULL,
      admin1_id   TEXT,
      parent_id   TEXT,
      lat         REAL,
      lon         REAL,
      population  INTEGER,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS places_country ON places(country, kind);
    CREATE INDEX IF NOT EXISTS places_admin1  ON places(admin1_id);

    CREATE TABLE IF NOT EXISTS place_aliases (
      alias       TEXT NOT NULL,
      country     TEXT NOT NULL DEFAULT '',
      place_id    TEXT NOT NULL,
      source      TEXT NOT NULL,
      confidence  REAL NOT NULL DEFAULT 1,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (alias, country)
    );

    CREATE TABLE IF NOT EXISTS sources (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      feed_url    TEXT NOT NULL,
      homepage    TEXT,
      country     TEXT,
      category    TEXT,
      bias        TEXT,
      tier        TEXT NOT NULL DEFAULT 'full'
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
      cluster_id    TEXT REFERENCES clusters(id),
      prominent     INTEGER NOT NULL DEFAULT 0
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
      image_source   TEXT,
      article_count  INTEGER NOT NULL DEFAULT 0,
      source_count   INTEGER NOT NULL DEFAULT 0,
      prominence     INTEGER NOT NULL DEFAULT 0,
      first_seen     INTEGER NOT NULL,
      last_seen      INTEGER NOT NULL,
      summarised_at  INTEGER,
      summarised_n   INTEGER DEFAULT 0,
      attempts       INTEGER NOT NULL DEFAULT 0,
      place_id       TEXT REFERENCES places(id),
      framing_left   TEXT, framing_centre TEXT, framing_right  TEXT
    );
    -- Partial: a quarter of clusters are summarised, and every last_seen-ordered
    -- query filters on that, so the other three quarters were being walked over.
    DROP INDEX IF EXISTS clusters_last_seen;
    DROP INDEX IF EXISTS clusters_category;
    DROP INDEX IF EXISTS clusters_country;
    CREATE INDEX IF NOT EXISTS clusters_live_last_seen ON clusters(last_seen DESC) WHERE headline IS NOT NULL;
    CREATE INDEX IF NOT EXISTS clusters_live_category  ON clusters(category, last_seen DESC) WHERE headline IS NOT NULL;
    CREATE INDEX IF NOT EXISTS clusters_live_country   ON clusters(country, last_seen DESC) WHERE headline IS NOT NULL;

    -- Rows this machine has changed since the last successful push. The sync
    -- used to infer that from timestamps, which meant an article was uploaded
    -- whenever anything in its cluster moved: one active 389-article story
    -- re-sent all 389 rows on every cycle, and D1 bills writes. It also
    -- missed the opposite case — a cluster whose count changed but whose
    -- last_seen did not was never pushed at all. Local only; a hydrated runner
    -- starts empty, which is correct, because it has just copied D1 verbatim.
    CREATE TABLE IF NOT EXISTS dirty (
      kind TEXT NOT NULL,
      id   TEXT NOT NULL,
      PRIMARY KEY (kind, id)
    );

    -- Which push of D1 this file is. sync writes the same token here and into
    -- D1's sync_meta as its last act, so hydrate can ask whether the file the
    -- Actions cache just handed it is the one that wrote what D1 currently
    -- holds - rather than an older entry restore-keys matched by prefix, or a
    -- survivor of an eviction. Local only; never pushed.
    CREATE TABLE IF NOT EXISTS local_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prefs (
      user_id      TEXT PRIMARY KEY,
      country      TEXT,
      categories   TEXT,
      places       TEXT,
      place_ids    TEXT,
      geo_consent  INTEGER NOT NULL DEFAULT 0,
      geo_place_id TEXT,
      hidden       TEXT
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

  // Columns added after the tables first shipped; existing files predate them.
  // CREATE TABLE IF NOT EXISTS is a no-op on a table that already exists, so
  // every later column needs its own guarded ALTER.
  const add = (table: string, column: string, ddl: string) => {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  add('clusters', 'attempts', 'attempts INTEGER NOT NULL DEFAULT 0');
  // How many front pages led with this. Kept apart from source_count because it
  // answers a different question: breadth is how many newsrooms covered it,
  // prominence is how many of them thought it was the day's story.
  add('clusters', 'prominence', 'prominence INTEGER NOT NULL DEFAULT 0');
  add('articles', 'prominent', 'prominent INTEGER NOT NULL DEFAULT 0');
  add('sources', 'tier', `tier TEXT NOT NULL DEFAULT 'full'`);
  add('clusters', 'place_id', 'place_id TEXT REFERENCES places(id)');
  // One paragraph per side that actually ran the story, written in the same
  // summarisation call. Nullable: a cluster summarised before v2.0 has none,
  // and one covered by a single side only gets the side it has.
  add('clusters', 'framing_left', 'framing_left TEXT');
  add('clusters', 'framing_centre', 'framing_centre TEXT');
  add('clusters', 'framing_right', 'framing_right TEXT');
  // Which outlet's feed the chosen image came from, so it can be credited.
  add('clusters', 'image_source', 'image_source TEXT');
  add('prefs', 'place_ids', 'place_ids TEXT');
  add('prefs', 'geo_consent', 'geo_consent INTEGER NOT NULL DEFAULT 0');
  add('prefs', 'geo_place_id', 'geo_place_id TEXT');
  // Categories the reader has switched off. Distinct from `categories`, which
  // only ever ranked: this one removes.
  add('prefs', 'hidden', 'hidden TEXT');

  // After the ALTER, not with the other indexes: on a database that predates
  // place_id the column does not exist yet when the CREATE TABLE block runs.
  d.exec('CREATE INDEX IF NOT EXISTS clusters_place ON clusters(place_id, last_seen DESC)');
}

export { CATEGORIES, type Category } from '../../web/shared/categories';

/** Record that a row differs from what D1 holds, so `sync` can push just it. */
export function markDirty(kind: 'cluster' | 'article', ids: Iterable<string>): void {
  const stmt = db().prepare('INSERT OR IGNORE INTO dirty (kind, id) VALUES (?, ?)');
  for (const id of ids) stmt.run(kind, id);
}

/**
 * Fold the write-ahead log back into the database file.
 *
 * The Actions cache saves `data/smartnews.db` and neither `data/smartnews.db-wal`
 * nor `-shm`. SQLite commits land in the WAL and only reach the main file when
 * something checkpoints - automatically at about a thousand pages, so the bulk
 * of a cycle does get folded in and the tail behind that threshold does not.
 * It is committed, it is on disk, and it is dropped when the file is packed
 * without the sidecar it lives in. Measured on a real store: 45 articles, and
 * a cluster whose recount sat in the tail keeps a count for rows that vanished.
 *
 * TRUNCATE rather than PASSIVE, which gives up quietly while any reader holds a
 * read transaction. `busy` says it gave up anyway, and that is worth a line
 * rather than a silent return to the behaviour this replaces.
 */
export function checkpoint(d: DatabaseSync = db()): void {
  const r = d.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number } | undefined;
  if (r?.busy) {
    console.warn('  ! wal_checkpoint busy - a reader is still attached and the WAL tail will not survive the cache');
  }
}
