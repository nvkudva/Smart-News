import pLimit from 'p-limit';
import { CATEGORIES, db } from './db';
import type { Bias } from './sources';
import { completeJson, describe, llmConfig, type JsonSchema, type LlmOutcome } from './llm';
import { resolvePlaceLocal } from './places-local';
import { distinctByText } from './text';

const MAX_ARTICLES = 6;
const MAX_ATTEMPTS = 3;

/**
 * How much of each article the model sees.
 *
 * Input is 84% of what a summary costs — measured over a day on Workers AI,
 * 471,808 input tokens against 90,021 output — so this constant, not the
 * output, is the bill. News is written inverted-pyramid: what happened, who
 * says so, then the background that was already in yesterday's piece. The tail
 * is the cheapest part to lose and the least likely to change a summary.
 *
 * Trimmed here rather than by taking fewer articles, because every outlet in
 * the cluster has to stay in the prompt for framing_left/centre/right to have
 * anything to compare — cutting MAX_ARTICLES would save the same tokens by
 * removing exactly the voices that feature exists to contrast.
 */
const MAX_CHARS_EACH = 1800;

type Member = { source_id: string; name: string; title: string; lead: string | null; body: string | null;
                bias: Bias | null };

export type Summary = {
  headline: string; crux: string; category: string;
  place: string | null; country: string | null; importance: number;
  framing_left: string | null; framing_centre: string | null; framing_right: string | null;
};

const SYSTEM = `You summarise clusters of news articles that all cover the same event.

Write from the reporting as a whole, never from one outlet's framing. Attribute
contested claims to whoever made them ("CENTCOM said", "the health ministry says")
instead of asserting them. Never adopt a headline's spin, never editorialise,
never introduce a fact no source states. Where sources disagree, say so plainly.

headline:   under 70 characters, sentence case, no outlet name, no clickbait.
crux:       4 to 6 sentences of plain declarative prose. What happened, who says
            so, and what follows from it. No bullets, no preamble, no hedging filler.
place:      the city or region the event happened in, else null.
country:    ISO 3166-1 alpha-2 code for that place, else null.
importance: 5 for a story a world newspaper leads its front page with, 1 for routine.

Some articles are tagged with the outlet's political lean. For each lean that
appears, write ONE sentence in framing_<lean> saying what those outlets
emphasise or how they frame it — the angle taken, what is foregrounded, which
voices are quoted. Describe the coverage, do not adopt it, and do not invent a
difference that is not on the page: if a lean's articles read the same as the
rest, say so. Omit the field entirely for any lean not present.`;

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline:   { type: 'string' },
    crux:       { type: 'string' },
    category:   { type: 'string', enum: CATEGORIES },
    place:      { type: 'string', nullable: true },
    country:    { type: 'string', nullable: true },
    importance: { type: 'integer' },
    framing_left:   { type: 'string', nullable: true },
    framing_centre: { type: 'string', nullable: true },
    framing_right:  { type: 'string', nullable: true },
  },
  required: ['headline', 'crux', 'category', 'importance'],
};

export async function summariseCluster(members: Member[]): Promise<LlmOutcome<Summary>> {
  // One article per source, longest body first: diverse and substantive.
  const bySource = new Map<string, Member>();
  for (const m of [...members].sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0))) {
    if (!bySource.has(m.source_id)) bySource.set(m.source_id, m);
  }
  // Then drop republished copy. Five outlets carrying one agency story is one
  // account, and sending it five times spends input tokens to tell the model
  // the same thing again — while looking, to it, like five outlets agreeing.
  const candidates = [...bySource.values()];
  const distinct = distinctByText(candidates.map((m) => `${m.title} ${m.body ?? m.lead ?? ''}`))
    .map((i) => candidates[i]);
  const picked = distinct.slice(0, MAX_ARTICLES);
  if (!picked.length) return { ok: false, reason: 'content' };

  const corpus = picked.map((m, i) =>
    `<article n="${i + 1}" source="${m.name}"${m.bias ? ` lean="${m.bias}"` : ''}>\n<title>${m.title}</title>\n` +
    `${(m.body ?? m.lead ?? '').slice(0, MAX_CHARS_EACH)}\n</article>`).join('\n\n');

  const out = await completeJson<Summary>(
    SYSTEM,
    `${members.length} articles cover this one event. Here are ${picked.length} of them.\n\n${corpus}`,
    SCHEMA,
  );

  if (!out.ok) return out;

  // Valid JSON is not the same as a usable summary. Smaller models routinely
  // return an object that parses but omits fields; without this the undefined
  // goes straight into the database as the story's headline.
  const s = out.value;
  if (typeof s.headline !== 'string' || typeof s.crux !== 'string') return { ok: false, reason: 'content' };
  if (!s.headline.trim() || s.crux.trim().length < 40) return { ok: false, reason: 'content' };
  return out;
}

/**
 * Stand-in used only when no provider key is configured, so the app is runnable
 * before anyone signs up for anything. It quotes one source verbatim rather than
 * synthesising across them — which is exactly what the product exists not to do.
 */
function extractive(members: Member[]): LlmOutcome<Summary> {
  const best = [...members].sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0))[0];
  if (!best) return { ok: false, reason: 'content' };
  const text = (best.body ?? best.lead ?? '').replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'“])/).slice(0, 5).join(' ');
  if (!sentences) return { ok: false, reason: 'content' };
  return {
    ok: true,
    value: {
      headline: best.title.replace(/\s*[|–-]\s*[^|–-]{0,24}$/, '').slice(0, 90),
      crux: sentences.slice(0, 620),
      category: 'World',
      place: null,
      country: null,
      importance: Math.min(5, 1 + Math.round(Math.log2(members.length + 1))),
      framing_left: null, framing_centre: null, framing_right: null,
    },
  };
}

/** Summarise clusters that are new, or that have grown 40%+ since last time. */
export async function summarisePending(limit = 30): Promise<{ done: number; skipped: number; using: string }> {
  const d = db();
  const config = llmConfig();
  // A story only one outlet ran is exactly what a corroboration-ranked feed
  // should be sceptical of, so it is also the cheapest thing to not summarise.
  const minSources = Number(process.env.SUMMARISE_MIN_SOURCES ?? 2);
  // New articles are new input, so the old verdict no longer applies: a cluster
  // that has grown since the attempt that used up its budget gets a fresh one,
  // otherwise a run of bad luck excludes it from the feed permanently.
  d.prepare(
    `UPDATE clusters SET attempts = 0
      WHERE attempts > 0 AND article_count > summarised_n
        AND (summarised_at IS NULL OR article_count >= summarised_n * 1.4)`,
  ).run();
  // Give up after MAX_ATTEMPTS: without this a cluster the model always chokes
  // on gets retried on every scheduled cycle, forever, at cost.
  const targets = d.prepare(
    `SELECT id, article_count FROM clusters
      WHERE source_count >= ?
        AND attempts < ?
        AND (summarised_at IS NULL OR article_count >= summarised_n * 1.4)
      ORDER BY source_count DESC, article_count DESC
      LIMIT ?`,
  ).all(minSources, MAX_ATTEMPTS, limit) as unknown as { id: string; article_count: number }[];

  const membersOf = d.prepare(
    `SELECT a.source_id, s.name, s.bias, a.title, a.lead, a.body
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ?`,
  );
  const save = d.prepare(
    `UPDATE clusters SET headline=?, crux=?, category=?, place=?, country=?, place_id=?,
            importance=?, framing_left=?, framing_centre=?, framing_right=?,
            summarised_at=?, summarised_n=? WHERE id=?`,
  );
  const resetAttempts = d.prepare('UPDATE clusters SET attempts = 0 WHERE id = ?');

  // Requests are paced to LLM_RPM inside llm.ts; concurrency only hides latency,
  // so it wants to be roughly rpm * seconds-per-call / 60 to actually reach that rate.
  const limiter = pLimit(Number(process.env.LLM_CONCURRENCY ?? 3));
  let done = 0, skipped = 0, stalled = 0;
  let authFailure = false;

  // summarised_n doubles as "how many articles we last judged": a spent attempt
  // records the count it was spent on, so the reset above can tell growth from
  // a cluster that has not changed since it failed.
  const bumpAttempt = d.prepare(
    `UPDATE clusters
        SET attempts = attempts + 1,
            summarised_n = CASE WHEN summarised_at IS NULL THEN article_count ELSE summarised_n END
      WHERE id = ?`,
  );

  await Promise.all(targets.map((t) => limiter(async () => {
    if (authFailure) return;
    const members = membersOf.all(t.id) as unknown as Member[];
    const r = config ? await summariseCluster(members) : extractive(members);
    if (!r.ok) {
      // Only the model's own failure to produce a usable summary spends an
      // attempt. A call that never got an answer says nothing about this
      // cluster, and three of those used to blacklist it for good.
      if (r.reason === 'auth') { authFailure = true; return; }
      if (r.reason === 'content') bumpAttempt.run(t.id); else stalled++;
      skipped++;
      return;
    }
    const s = r.value;
    const category = (CATEGORIES as readonly string[]).includes(s.category) ? s.category : 'World';
    // Models hand back "USA" or "United States" as often as "US"; the feed
    // compares this against the reader's two-letter home country.
    const cc = typeof s.country === 'string' && /^[A-Za-z]{2}$/.test(s.country.trim())
      ? s.country.trim().toUpperCase() : null;
    // The free text stays exactly as the model wrote it; place_id is the
    // canonical row it points at, and is simply NULL when nothing matches.
    const resolved = resolvePlaceLocal(d, s.place ?? null, cc);
    // A one-sentence field the model padded to a paragraph is still useful, but
    // an empty string is not — it renders as a side that said nothing.
    const framing = (v: unknown) => (typeof v === 'string' && v.trim().length > 15 ? v.trim() : null);
    save.run(s.headline, s.crux, category, s.place ?? null, resolved.country, resolved.place_id,
             Math.max(1, Math.min(5, Math.round(s.importance) || 3)),
             framing(s.framing_left), framing(s.framing_centre), framing(s.framing_right),
             Date.now(), t.article_count, t.id);
    resetAttempts.run(t.id);
    done++;
    process.stdout.write(`  ✓ ${String(members.length).padStart(2)} src  ${s.headline.slice(0, 66)}\n`);
  })));

  if (authFailure) {
    throw new Error(
      `LLM rejected our credentials (${config ? describe(config) : 'no provider'}) — aborting the run. ` +
      'Check the provider API key; no cluster has spent a retry.',
    );
  }
  if (stalled) {
    process.stdout.write(`  ! ${stalled} cluster(s) unreachable — retry budget untouched\n`);
  }

  return { done, skipped, using: config ? describe(config) : 'extractive placeholder (no API key)' };
}
