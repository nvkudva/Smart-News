import { indexDrift } from '../../src/lib/schema-d1';

/**
 * Fails the build when schema-local.ts declares an index schema-d1.ts does not.
 *
 * src/lib/schema-d1.ts has always said it mirrors the local schema. Nothing checked,
 * and three indexes drifted out of it — one of them clusters_place, which the
 * Local tab and every Explore place tile read through. Deliberate omissions go
 * in LOCAL_ONLY with a reason; everything else is a bug.
 *
 * Pure file comparison, so it belongs in build:check rather than migrate:d1:
 * no network, no credentials, no live database.
 */
const drift = indexDrift();
if (drift.length) {
  console.error(`schema drift — in src/lib/schema-local.ts but not in src/lib/schema-d1.ts: ${drift.join(', ')}`);
  console.error('Add them to SCHEMA, or to LOCAL_ONLY with the reason they stay local.');
  process.exit(1);
}
console.log(`schema: ${'✓'} index lists agree`);
