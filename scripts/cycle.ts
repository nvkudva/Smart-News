import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { writeFileSync } from 'node:fs';
import { clusterRecent } from '../src/lib/cluster';
import { ingest } from '../src/lib/ingest';
import { errorTally, tokenTally } from '../src/lib/llm';
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
  // Printed per run so a day of logs answers where the money goes without
  // another instrumentation pass. Cloudflare prices output ~6.6x input, so the
  // cost split is not the token split - the ratio below is the one to read.
  if (tokenTally.calls) {
    const { input, output, calls } = tokenTally;
    console.log(`tokens: ${input} in, ${output} out over ${calls} calls ` +
                `(${(input / calls).toFixed(0)}/${(output / calls).toFixed(0)} each, ` +
                `out/in ${(output / Math.max(1, input)).toFixed(3)})`);
  }
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Stamp when this pass began so `sync` can push only the rows it touched.
  // Written last on purpose: a cycle that dies half-way leaves no stamp, and
  // the next sync falls back to pushing the whole window.
  writeFileSync(`${process.env.SMARTNEWS_DB ?? 'data/smartnews.db'}.t0`, String(t0));
}

main().then(() => process.exit(0));
