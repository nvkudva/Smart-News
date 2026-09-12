import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA } from './d1-schema';

/**
 * Fill miniflare's local D1 from the pipeline's SQLite file.
 *
 * Nothing has ever written to local D1: `next dev` reads deployed rows over
 * HTTP, and `dev:local` reads data/smartnews.db directly — see the comment on
 * d1() in src/lib/d1.ts. The Vite SPA in web/ has no such escape hatch. Its
 * Worker only has the `DB` binding, so the binding has to point at a database
 * that actually holds rows.
 *
 * This runs the opposite way to hydrate-d1.ts. That one pulls D1 down into the
 * local file for the pipeline to work against; this one pushes the local file
 * up into local D1 for the Worker to read. Neither touches the deployed
 * database: --local is hard-coded below and there is no flag to override it.
 */

const SRC = 'data/smartnews.db';

/**
 * Parent-before-child, so the DROPs below can run in reverse and the INSERTs
 * in order without tripping a foreign key the schema may later declare.
 */
const TABLES = ['sources', 'places', 'place_aliases', 'clusters', 'articles',
                'prefs', 'saved', 'events', 'sync_meta'];

/**
 * D1's column order, learned by applying SCHEMA to a throwaway file.
 *
 * The two schemas hold the same columns in different orders: d1-schema.ts
 * appends what db.ts has ALTERed in over time. Positional `INSERT INTO t
 * VALUES (...)` therefore lands values in the wrong columns — it fails on
 * clusters.attempts if you are lucky, and silently transposes framing_left
 * into place_id if you are not. So every statement here names its columns.
 */
function d1Columns(): Map<string, string[]> {
  const probe = join(tmpdir(), `d1-schema-probe-${process.pid}.db`);
  if (existsSync(probe)) rmSync(probe);
  const db = new DatabaseSync(probe);
  db.exec(SCHEMA);
  const out = new Map<string, string[]>();
  for (const t of TABLES) out.set(t, columns(db, t));
  db.close();
  rmSync(probe);
  return out;
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .map((c) => c.name);
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function main() {
  if (!existsSync(SRC)) throw new Error(`No ${SRC}. Run the pipeline first.`);

  const wanted = d1Columns();
  const src = new DatabaseSync(SRC, { readOnly: true });

  // Idempotent: dropping first means re-seeding never merges an old cycle's
  // rows into a new one, which would leave clusters the stamp cannot explain.
  const sql = [...TABLES].reverse().map((t) => `DROP TABLE IF EXISTS ${t};`);
  sql.push(SCHEMA);

  for (const table of TABLES) {
    const have = new Set(columns(src, table));
    const use = wanted.get(table)!.filter((c) => have.has(c));
    const missing = wanted.get(table)!.filter((c) => !have.has(c));
    const list = use.map((c) => `"${c}"`).join(',');

    const rows = src.prepare(`SELECT ${list} FROM ${table}`).all() as Record<string, unknown>[];
    for (const row of rows) {
      sql.push(`INSERT INTO ${table} (${list}) VALUES (${use.map((c) => literal(row[c])).join(',')});`);
    }
    console.log(`  ${table.padEnd(14)} ${String(rows.length).padStart(5)} rows` +
      (missing.length ? `  (not in ${SRC}: ${missing.join(', ')})` : ''));
  }
  src.close();

  const file = join(tmpdir(), `seed-local-d1-${process.pid}.sql`);
  writeFileSync(file, sql.join('\n') + '\n');

  // From web/, so wrangler reads web/wrangler.jsonc for the database name, and
  // --persist-to matches the persistState path its Vite plugin config sets.
  console.log('\nApplying to local D1…');
  try {
    execFileSync('bunx', ['wrangler', 'd1', 'execute', 'smartnews',
      '--local', '--persist-to', '../.wrangler/state', '--file', file, '-y'],
      { cwd: 'web', stdio: ['ignore', 'ignore', 'inherit'] });
  } finally {
    rmSync(file);
  }
  console.log('Done.');
}

main();
