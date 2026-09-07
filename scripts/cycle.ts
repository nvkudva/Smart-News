import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

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
}

main().then(() => process.exit(0));
