import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { writeFileSync } from 'node:fs';
import { clusterRecent } from '../src/lib/cluster';
import { ingest } from '../src/lib/ingest';
import { errorTally } from '../src/lib/llm';
import { summarisePending } from '../src/lib/summarise';

/** One scheduled pass: pull what's new, re-cluster, summarise what changed. */
async function main() {
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n── ${stamp} ─────────────────────────────`);

  const { added, withBody } = await ingest();
  const { clusters, assigned } = clusterRecent();
  console.log(`${clusters} clusters over ${assigned} articles`);

  const limit = Number(process.argv[2] ?? 40);
  const { done, skipped, using } = await summarisePending(limit);
  console.log(`+${added} articles (${withBody} with text) · ${done} summarised, ${skipped} skipped · ${using}`);
  if (errorTally.size) console.log(`failures: ${[...errorTally].map(([k, n]) => `${k}=${n}`).join(', ')}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Stamp when this pass began so `sync` can push only the rows it touched.
  // Written last on purpose: a cycle that dies half-way leaves no stamp, and
  // the next sync falls back to pushing the whole window.
  writeFileSync(`${process.env.SMARTNEWS_DB ?? 'data/smartnews.db'}.t0`, String(t0));
}

main().then(() => process.exit(0));
