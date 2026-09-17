import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { clusterRecent } from '../src/lib/cluster';
import { affordable, DAILY_NEURONS, NEURON_BUDGET, neuronsToday } from '../src/lib/budget';
import { checkpoint } from '../src/lib/db';
import { ingest } from '../src/lib/ingest';
import { errorTally, tokenTally } from '../src/lib/llm';
import { summarisePending } from '../src/lib/summarise';

/**
 * Mirror everything the run prints into a log, so a cycle can be followed live
 * with `tail -f` and read back afterwards. Written with writeSync rather than a
 * stream because main() ends in process.exit(), which drops a stream's pending
 * buffer: the last line of a run is the summary line, and losing it would make
 * the log useless for exactly the runs worth analysing. Piping stdout to `tee`
 * does not substitute — node block-buffers stdout when it is a pipe, so the
 * output arrives in 4KB lumps and a slow cycle looks stalled.
 *
 * One file per cycle rather than one file appended to for ever. A single log
 * answers "what happened just now" only by tailing it, and answers "what did
 * the 04:00 run do" not at all without counting backwards through the ones
 * after it; a named file per run is grep-able across days and deletable by age.
 * The name is the start time to the second, which the concurrency group in
 * cycle.yml makes unique — two runs never overlap.
 */
const LOG_DIR = process.env.CYCLE_LOG_DIR ?? 'data/logs';
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Every time a run states is IST, in the clock the person reading it is on.
 *
 * The runner is UTC and toISOString was showing 11:41 for a cycle that ran at
 * quarter past five in the evening, so comparing a log against the feed - or
 * against the measured shape of the day, which is the whole reason these are
 * kept - meant adding five and a half hours by hand every time.
 *
 * Derived from the same parts for the file name and the line inside it, so the
 * two can never disagree about when a run happened.
 */
function istParts(d: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).formatToParts(d)) parts[p.type] = p.value;
  return parts;
}

/** `2026-09-17 05:11:06 pm IST` — what the run prints above its own output. */
function istStamp(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ` +
         `${(p.dayPeriod ?? '').toLowerCase()} IST`;
}

/**
 * `cycle-2026-09-17-05-11-06-pm.log` — the same instant, with the separators a
 * file name can carry.
 *
 * A twelve-hour clock costs the lexical sort within a day: `01-...-pm` sorts
 * above `05-...-am`. Across days the date still orders correctly, and `ls -t`
 * or the stamp on the first line settles the rest.
 */
function logName(d: Date): string {
  const p = istParts(d);
  return `cycle-${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}-${p.second}` +
         `-${(p.dayPeriod ?? '').toLowerCase()}.log`;
}

/**
 * Three days of runs is about 144 files and a few megabytes, which is enough to
 * compare a quiet morning against a busy evening and not enough to notice.
 *
 * Swept at the start of the run that is about to add to it, so nothing has to
 * schedule anything: the only process that creates these is the only one that
 * needs to remove them. Best-effort throughout — a log that cannot be tidied
 * must not stop a cycle from running.
 */
function sweepLogs(): void {
  try {
    const cutoff = Date.now() - KEEP_MS;
    for (const name of readdirSync(LOG_DIR)) {
      if (!name.startsWith('cycle-') || !name.endsWith('.log')) continue;
      const path = join(LOG_DIR, name);
      try { if (statSync(path).mtimeMs < cutoff) rmSync(path); } catch { /* raced with another reader */ }
    }
  } catch { /* no directory yet, which is the same as nothing to sweep */ }
}

mkdirSync(LOG_DIR, { recursive: true });
sweepLogs();
const logFd = openSync(join(LOG_DIR, logName(new Date())), 'a');
const stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  try { writeSync(logFd, typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)); } catch { /* a full disk must not kill a cycle */ }
  return (stdoutWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

/** One scheduled pass: pull what's new, re-cluster, summarise what changed. */
async function main() {
  const t0 = Date.now();
  const stamp = istStamp(new Date());
  console.log(`\n── ${stamp} ─────────────────────────────`);

  const { added, withBody } = await ingest();
  const { clusters, assigned } = clusterRecent();
  console.log(`${clusters} clusters over ${assigned} articles`);

  const asked = Number(process.argv[2] ?? 40);
  // Asked of Cloudflare before anything is written, because the allowance is
  // shared with every other thing that draws on it and a count kept here would
  // only know about itself. A meter that cannot be read leaves `asked` alone.
  const spent = await neuronsToday();
  const limit = affordable(spent, asked);
  if (spent !== null) {
    console.log(`neurons: ${spent}/${NEURON_BUDGET} spent of a ${DAILY_NEURONS} day` +
                (limit < asked ? ` — summarising ${limit} not ${asked}` : ''));
  }
  // A budget stop is not a failure: ingest and clustering both did their work
  // and are worth keeping, and stopping is the plan working. The line below
  // reports it in the same place as everything else.
  const { done, skipped, using } = limit === 0
    ? { done: 0, skipped: 0, using: `budget spent — no summarising until 00:00 UTC` }
    : await summarisePending(limit);
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

  // Before the stamp: `.t0` tells the next sync to push only what this pass
  // touched, so it must not outlive the rows it is describing.
  checkpoint();

  // Stamp when this pass began so `sync` can push only the rows it touched.
  // Written last on purpose: a cycle that dies half-way leaves no stamp, and
  // the next sync falls back to pushing the whole window.
  writeFileSync(`${process.env.SMARTNEWS_DB ?? 'data/smartnews.db'}.t0`, String(t0));

  // A run that tried to summarise and got nothing back is not a quiet news
  // day, and used to exit 0 looking exactly like one. Every call being
  // rejected - an exhausted allowance, a dead token, a model that has gone
  // away - is the case this catches. A budget stop is not: nothing was
  // attempted, so there is nothing to have failed.
  if (limit > 0 && done === 0 && skipped > 0 && errorTally.size) {
    throw new Error(`every summarise call failed (${[...errorTally].map(([k, n]) => `${k}=${n}`).join(', ')})`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  // Named on one line rather than thrown as an unhandled rejection, which
  // buries the sentence that matters under a stack through the module loader.
  console.error(`\ncycle failed: ${(e as Error).message}`);
  process.exit(1);
});
