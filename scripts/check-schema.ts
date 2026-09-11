import { indexDrift } from './d1-schema';

/**
 * Fails the build when db.ts declares an index d1-schema.ts does not.
 *
 * d1-schema.ts has always said it mirrors migrate() in db.ts. Nothing checked,
 * and three indexes drifted out of it — one of them clusters_place, which the
 * Local tab and every Explore place tile read through. Deliberate omissions go
 * in LOCAL_ONLY with a reason; everything else is a bug.
 *
 * Pure file comparison, so it belongs in build:check rather than migrate:d1:
 * no network, no credentials, no live database.
 */
const drift = indexDrift();
if (drift.length) {
  console.error(`schema drift — in src/lib/db.ts but not in scripts/d1-schema.ts: ${drift.join(', ')}`);
  console.error('Add them to SCHEMA, or to LOCAL_ONLY with the reason they stay local.');
  process.exit(1);
}
console.log(`schema: ${'✓'} index lists agree`);
