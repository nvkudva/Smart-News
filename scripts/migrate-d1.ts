import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { appendFileSync } from 'node:fs';

import { d1 } from '../src/lib/d1';
import { applySchema, indexDrift, missingColumns, ADDED_COLUMNS } from './d1-schema';

/**
 * Bring the live D1 database up to the current schema, without touching rows.
 *
 * Until now the only thing that ran this DDL was `npm run sync`, at the tail of
 * the pipeline. That is the wrong moment: a release that reads a new column is
 * live the instant it deploys, and every request in the gap throws "no such
 * column". Run this before deploying — `npm run migrate:d1` — or with --check
 * to see what a live database is missing.
 */

/**
 * d1-schema.ts says it mirrors migrate() in db.ts. It said so while three
 * indexes were missing from it, one of them on the deployed read path, because
 * nothing ever compared the two. Now something does.
 */
async function main() {
  const check = process.argv.includes('--check');
  const d = await d1();

  const missing = await missingColumns(d);
  for (const table of Object.keys(ADDED_COLUMNS)) {
    const cols = await d.all<{ name: string }>(`PRAGMA table_info(${table})`);
    console.log(`${table}: ${cols.length ? cols.map((c) => c.name).join(', ') : '(no such table)'}`);
  }

  const drift = indexDrift();
  if (drift.length) console.log(`\nIn db.ts but not in d1-schema.ts: ${drift.join(', ')}`);

  if (check) {
    console.log(missing.length
      ? `\nMissing columns: ${missing.map(([t, n]) => `${t}.${n}`).join(', ')}`
      : '\nColumns up to date.');
    // Answered to the workflow as well as to a person: the deploy job runs this
    // first and applies the DDL only when it says so, so a release that changes
    // no schema touches the live database not at all. Harmless off a runner,
    // where GITHUB_OUTPUT is unset.
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `needed=${missing.length > 0}\n`);
    }
    if (drift.length) process.exitCode = 1;
    return;
  }

  console.log('\nSchema…');
  await applySchema(d, (s) => console.log(s));
  console.log('Done.');
}

main().then(() => process.exit(0));
