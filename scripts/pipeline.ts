import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { clusterRecent } from '../src/lib/cluster';
import { errorTally } from '../src/lib/llm';
import { summarisePending } from '../src/lib/summarise';

async function main() {
  const t0 = Date.now();

  console.log('Clustering…');
  const { clusters, assigned } = clusterRecent();
  console.log(`  ${clusters} clusters over ${assigned} articles`);

  const limit = Number(process.argv[2] ?? 30);
  console.log(`\nSummarising up to ${limit}…`);
  const { done, skipped, using } = await summarisePending(limit);
  console.log(`  model: ${using}`);
  console.log(`  ${done} summarised, ${skipped} skipped`);
  if (errorTally.size) console.log(`  failures: ${[...errorTally].map(([k, n]) => `${k}=${n}`).join(', ')}`);

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().then(() => process.exit(0));
