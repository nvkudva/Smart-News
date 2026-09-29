import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { checkpoint, db, markDirty } from '../../src/lib/db';
import { outletCountry } from '../../src/lib/places';

/**
 * Give a country to written stories that have none, the way the summariser now
 * would: from the place they resolved to, else from their outlets' country.
 * Touched rows are marked dirty, so the next `sync` pushes them to D1.
 *
 *   bun run backfill:country            apply
 *   bun run backfill:country --dry-run  count only
 */
const dry = process.argv.includes('--dry-run');
const d = db();

const fromPlace = d.prepare(
  `SELECT c.id, p.country FROM clusters c JOIN places p ON p.id = c.place_id
    WHERE c.headline IS NOT NULL AND c.country IS NULL`,
).all() as unknown as { id: string; country: string }[];

const rest = d.prepare(
  `SELECT c.id, group_concat(COALESCE(s.country, ''), ',') AS countries
     FROM clusters c JOIN articles a ON a.cluster_id = c.id JOIN sources s ON s.id = a.source_id
    WHERE c.headline IS NOT NULL AND c.country IS NULL AND c.place_id IS NULL
    GROUP BY c.id`,
).all() as unknown as { id: string; countries: string }[];

const fromOutlets = rest
  .map((r) => ({ id: r.id, country: outletCountry(r.countries.split(',')) }))
  .filter((r): r is { id: string; country: string } => !!r.country);

console.log(`from place: ${fromPlace.length}, from outlets: ${fromOutlets.length}, still none: ${rest.length - fromOutlets.length}`);

if (!dry) {
  const set = d.prepare('UPDATE clusters SET country = ? WHERE id = ?');
  d.exec('BEGIN');
  for (const r of [...fromPlace, ...fromOutlets]) set.run(r.country, r.id);
  d.exec('COMMIT');
  markDirty('cluster', [...fromPlace, ...fromOutlets].map((r) => r.id));
  checkpoint();
  console.log('Done. Run `bun run sync` to push.');
}
