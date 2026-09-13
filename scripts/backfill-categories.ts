/**
 * Re-file the clusters that still carry a retired category.
 *
 * 'India' and 'World' were scopes wearing a subject's clothes, and between them
 * they held 43% of the store. Removing them from the enum stops new rows
 * landing there; this moves the ones already written.
 *
 * It asks only for the category, against the headline and crux the summariser
 * already wrote - not a re-summarise. That is a two-line answer per cluster
 * instead of six articles of input, so the whole backlog costs about what one
 * normal cycle does.
 *
 * Runs against the local SQLite file, like every other pipeline step: hydrate
 * first, run this, then sync. Default is a dry run - nothing is written until
 * --write is passed, because 43% of the feed changing shape is worth reading
 * before it ships.
 *
 *   npx tsx scripts/hydrate-d1.ts
 *   npx tsx scripts/backfill-categories.ts            # print the verdicts
 *   npx tsx scripts/backfill-categories.ts --write
 *   npx tsx scripts/sync-d1.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import pLimit from 'p-limit';
import { CATEGORIES, RETIRED_CATEGORIES, db } from '../src/lib/db';
import { completeJson, llmConfig, type JsonSchema } from '../src/lib/llm';

const SYSTEM = `You file news stories under one subject. Answer with the single
best fit from the list you are given and nothing else.

The subject is what the story is ABOUT, never where it happened - where is
recorded separately. So a road collapse in Delhi is Disasters & Accidents, not
an India story.

Most stories match more than one subject. Work down this list and stop at the
FIRST one that fits. Do not skip ahead because a later subject feels like the
bigger theme.

1. Crime & Courts - a crime, a police action, or ANY court proceeding: arrest,
   trial, charge, sentence, acquittal, bail, verdict, ruling. This wins over
   every subject below it. An activist jailed is Crime & Courts, not Politics.
   A rapper acquitted is Crime & Courts, not Entertainment. A minister raided
   is Crime & Courts, not Governance. Someone killing someone - a shooting, a
   stabbing, an attack, a murder, a lynching - is Crime & Courts however many
   died. A suicide or an unexplained death is Crime & Courts too.

2. Disasters & Accidents - harm nobody meant: a building that fell, a vehicle
   that crashed, a fire, a flood, an earthquake, a leak, a rescue. Also
   large-scale transport breakdowns such as an air traffic control failure.

3. Conflict & Diplomacy - war, strikes between states, troops, ceasefires,
   sanctions, import bans on another country, summits and talks between
   governments. A leader meeting another leader is here, not Politics.

4. Politics - the contest for power, and only that: parties, elections,
   campaigns, protests against a government, resignations, legislatures. A
   story that is merely odd, ceremonial or historical is not Politics; if
   nothing on this list fits it, it is Others.

5. Governance - the business of governing where no crime is alleged: schemes,
   ministries, civic bodies, budgets, appointments, regulators, inspections,
   demolitions and official surveys and rankings.

6. Climate - warming, emissions, climate targets and climate finance.
7. Science - research, space, an excavation, a fossil, a dig, a find. Remains
   being unearthed is archaeology, never a disaster.
8. Health - disease, treatment, hospitals, nutrition, mental health.
9. Education - schools, universities, exams, admissions, education policy.
10. Sports - matches, players, tournaments.
11. Entertainment - film, television, music, celebrity. A row between public
   figures about a television show is Entertainment whoever is having it.
12. Technology - devices, software, AI, chips, platforms, games consoles.
13. Business - companies, markets, jobs, the economy, rates, trade. Not
    everything with money in it: a tourism piece is Others.
14. Others - nothing above fits.`;


const SCHEMA: JsonSchema = {
  type: 'object',
  properties: { category: { type: 'string', enum: CATEGORIES } },
  required: ['category'],
};

type Row = { id: string; headline: string; crux: string | null; category: string };

async function main() {
  const write = process.argv.includes('--write');
  if (!llmConfig()) {
    console.error('No LLM configured — set LLM_PROVIDER and its key.');
    process.exit(1);
  }

  const d = db();
  const marks = RETIRED_CATEGORIES.map(() => '?').join(',');
  const rows = d.prepare(
    `SELECT id, headline, crux, category FROM clusters
      WHERE headline IS NOT NULL AND category IN (${marks})
      ORDER BY last_seen DESC`,
  ).all(...RETIRED_CATEGORIES) as Row[];

  console.log(`${rows.length} clusters to re-file${write ? '' : ' (dry run)'}\n`);
  if (!rows.length) return;

  const update = d.prepare('UPDATE clusters SET category = ? WHERE id = ?');
  const limiter = pLimit(Number(process.env.LLM_CONCURRENCY ?? 3));
  const tally = new Map<string, number>();
  let failed = 0;

  await Promise.all(rows.map((r) => limiter(async () => {
    const out = await completeJson<{ category: string }>(
      SYSTEM,
      `Subjects: ${CATEGORIES.join(', ')}\n\nHeadline: ${r.headline}\n\n${r.crux ?? ''}`,
      SCHEMA,
    );
    // A cluster left on its retired value is visible in the next run's count
    // and is reached through the scope tabs meanwhile, so a failure here costs
    // a retry rather than a wrong answer written to the store.
    if (!out.ok) { failed++; return; }
    const picked = (CATEGORIES as readonly string[]).includes(out.value.category)
      ? out.value.category : 'Others';
    tally.set(picked, (tally.get(picked) ?? 0) + 1);
    console.log(`${picked.padEnd(22)} ← ${r.category.padEnd(6)} ${r.headline}`);
    if (write) update.run(picked, r.id);
  })));

  console.log('');
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(String(v).padStart(5), k);
  }
  if (failed) console.log(`${failed} left on their old value — run again`);
  if (!write) console.log('\nDry run. Pass --write to apply.');
}

main();
