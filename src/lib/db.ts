import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ADDED_COLUMNS, DEFERRED_INDEXES, SCHEMA } from './schema-local';

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
  d.exec(SCHEMA);

  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }

  for (const sql of DEFERRED_INDEXES) d.exec(sql);
}

export { CATEGORIES, type Category } from '../../web/shared/categories';

/** Record that a row differs from what D1 holds, so `sync` can push just it.
 *  `gone` is a cluster this file no longer has and D1 still does. */
export function markDirty(kind: 'cluster' | 'article' | 'gone', ids: Iterable<string>): void {
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
