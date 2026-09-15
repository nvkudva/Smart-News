import pLimit from 'p-limit';
import { CATEGORIES, db, markDirty } from './db';
import type { Bias } from './sources';
import { completeJson, describe, llmConfig, type JsonSchema, type LlmOutcome } from './llm';
import { isoCountry, resolvePlaceLocal } from './places-local';
import type { DatabaseSync } from 'node:sqlite';
import { distinctByText, entities } from './text';

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
  place: string | null; city: string | null; region: string | null;
  country: string | null; importance: number;
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
category:   the subject the story is about, never where it happened - scope is
            derived from country. Governance is the business of governing
            (schemes, ministries, civic bodies, appointments); Politics is the
            contest for power (parties, elections, resignations, campaigns). A
            court ruling is Crime & Courts even when the defendant is a
            minister. Conflict & Diplomacy covers war, strikes, sanctions and
            talks between states. Others only when nothing else fits.
place:      where the event happened, as you would say it in a sentence, else
            null. This is what the reader sees.
city:       just the city or town, no country, no state, else null. "Hyderabad",
            not "Hyderabad, India". Null for anything larger than a city.
region:     just the state, province or region, else null. "Telangana", not
            "Telangana, India". Null if you do not know which one.
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
    // Asked for in parts as well as prose. The parts cost a dozen output tokens
    // on a response that already runs to hundreds, and they save the resolver
    // from taking "Hyderabad, India" apart and guessing which half is which.
    city:       { type: 'string', nullable: true },
    region:     { type: 'string', nullable: true },
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
  const crux = whole(s.crux);
  if (!s.headline.trim() || crux.length < 40) return { ok: false, reason: 'content' };
  return { ok: true, value: { ...s, crux } };
}

/**
 * The last complete sentence, and nothing after it.
 *
 * A small model routinely stops mid-sentence and still closes its JSON, so the
 * object parses and the fragment reads as a finished summary. Ten of 234 live
 * stories were like that - one of them 72 characters ending "used its AI model
 * for ", mid-clause, with a trailing space. Length alone cannot tell a short
 * summary from a severed one, which is why the floor below let them through.
 *
 * Cuts back to the last terminator rather than rejecting outright: a crux
 * severed after four good sentences is still four good sentences, while one
 * severed after half of the first has nothing left and fails the floor - and a
 * failed summary is retried on a later cycle rather than stored.
 */
function whole(text: string): string {
  const t = text.trim();
  // Already finished, allowing for a closing quote or bracket after the stop.
  if (/[.!?][")\u2019\u201d]?$/.test(t)) return t;
  const cut = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'));
  return cut === -1 ? '' : t.slice(0, cut + 1);
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
  // The 620 is a hard cut and lands mid-sentence as readily as a model does.
  const crux = whole(sentences.slice(0, 620));
  if (!crux) return { ok: false, reason: 'content' };
  return {
    ok: true,
    value: {
      headline: best.title.replace(/\s*[|–-]\s*[^|–-]{0,24}$/, '').slice(0, 90),
      crux,
      category: 'Others',
      place: null,
      city: null,
      region: null,
      country: null,
      importance: Math.min(5, 1 + Math.round(Math.log2(members.length + 1))),
      framing_left: null, framing_centre: null, framing_right: null,
    },
  };
}


/**
 * Service journalism, by the shape of its headline. None of it is news anyone
 * else will corroborate, and none of it is worth a model call: a guide to
 * making a bootable USB, a pricing note, a team of the week.
 */
const CHORE = /^(how to|q&a|best |watch:|explained:|live updates|what to know|\d+ things|can you use)|\b(team of the week|deals?|discount|coupon|how to watch|step by step|hints and answers|wordle|quordle|connections|crossword|sudoku|horoscope|daily quiz|answers for)\b/i;

/**
 * How much of the rest of the window is about the same thing.
 *
 * A story one outlet ran is not automatically obscure — sometimes the clusterer
 * simply failed to match two ways of saying it. So rather than ask whether the
 * article clustered, ask whether the names in its headline turn up in other
 * newsrooms' headlines at all. "Cong rejects TMC proposal for bypoll pact"
 * scores because TMC and Congress are everywhere this week; "Fitzroy Crossing
 * calls for stronger FASD support" scores nothing, and should not.
 */
function heatIndex(d: DatabaseSync, since: number): Map<string, Set<string>> {
  const rows = d.prepare('SELECT source_id, title FROM articles WHERE published_at >= ?')
    .all(since) as unknown as { source_id: string; title: string }[];
  const heat = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const e of entities(r.title)) {
      const set = heat.get(e) ?? heat.set(e, new Set()).get(e)!;
      set.add(r.source_id);
    }
  }
  return heat;
}

/**
 * Every single-source cluster worth writing up, best first.
 *
 * There is no cap here on purpose. A cap meant a desk like Technology — where
 * ten articles arrive in three hours and no two are about the same thing —
 * saw one story written a day while 130 went past. What limits the work is the
 * run's own limit and what the gates refuse, not an allowance.
 *
 * Everything here is a string test or a map lookup: the point of choosing
 * without the model is that choosing must not cost what writing costs.
 */
function worthWriting(d: DatabaseSync): { id: string; article_count: number }[] {
  const since = Date.now() - 48 * 3_600_000;
  // Heat is measured against two days of headlines, but only fresh articles are
  // eligible to be written. An older singleton has had longer to accumulate
  // matching names, so scoring the whole window picked day-old stories every
  // time — and the feed only considers the last 24 hours, so they were written
  // and then never seen. Six hours leaves a story most of its half-life.
  const fresh = Date.now() - 6 * 3_600_000;
  const heat = heatIndex(d, since);
  const rows = d.prepare(
    `SELECT c.id, c.article_count, a.source_id, a.title, a.published_at, s.category
       FROM clusters c JOIN articles a ON a.cluster_id = c.id JOIN sources s ON s.id = a.source_id
      WHERE c.headline IS NULL AND c.source_count = 1 AND c.attempts < ?
        AND a.published_at >= ? AND LENGTH(COALESCE(a.body, '')) > 800`,
  ).all(MAX_ATTEMPTS, fresh) as unknown as
    { id: string; article_count: number; source_id: string; title: string;
      published_at: number; category: string }[];

  const scored: { id: string; article_count: number; category: string; heat: number; at: number }[] = [];
  for (const r of rows) {
    if (CHORE.test(r.title)) continue;
    const others = new Set<string>();
    for (const e of entities(r.title)) {
      for (const src of heat.get(e) ?? []) if (src !== r.source_id) others.add(src);
    }
    // Heat orders the queue; it does not guard it. Requiring other newsrooms to
    // be writing about the same names is corroboration wearing a different
    // hat, and it shuts out exactly the desks this exists for: nobody else is
    // writing about Kioxia, or about whatever The Verge noticed this morning,
    // and that is the normal condition of a technology desk rather than a
    // reason to publish nothing.
    scored.push({ id: r.id, category: r.category, heat: others.size, at: r.published_at,
                  article_count: r.article_count });
  }
  // Heat still sorts, so if the run's limit binds it binds on the weakest
  // stories rather than on whichever desk happened to be queried first.
  scored.sort((a, b) => b.heat - a.heat || b.at - a.at);
  return scored.map(({ id, article_count }) => ({ id, article_count }));
}

/**
 * Summarise clusters that have never been summarised. A headline is written
 * once and kept: a story that gains a seventh article, or a fifth outlet, is
 * the same story, and paying the model again to say so is the single largest
 * avoidable cost in a cycle that runs every half hour.
 */
export async function summarisePending(limit = 30): Promise<{ done: number; skipped: number; using: string }> {
  const d = db();
  const config = llmConfig();
  // A story only one outlet ran is exactly what a corroboration-ranked feed
  // should be sceptical of, so it is also the cheapest thing to not summarise.
  const minSources = Number(process.env.SUMMARISE_MIN_SOURCES ?? 2);
  // New articles are new input, so a verdict that was never reached still can
  // be: a cluster that has grown since the attempt that used up its budget gets
  // a fresh one, otherwise a run of bad luck excludes it from the feed
  // permanently. Only clusters that have never been summarised are eligible —
  // one that already has a headline is finished, however much it grows.
  d.prepare(
    `UPDATE clusters SET attempts = 0
      WHERE attempts > 0 AND summarised_at IS NULL AND article_count > summarised_n`,
  ).run();
  // Give up after MAX_ATTEMPTS: without this a cluster the model always chokes
  // on gets retried on every scheduled cycle, forever, at cost.
  const targets = d.prepare(
    `SELECT id, article_count FROM clusters
      WHERE source_count >= ?
        AND attempts < ?
        AND summarised_at IS NULL
      ORDER BY source_count DESC, article_count DESC
      LIMIT ?`,
  ).all(minSources, MAX_ATTEMPTS, limit) as unknown as { id: string; article_count: number }[];

  // Corroboration is not the same as newsworthiness. Several outlets publish
  // the day's Wordle hints, and they corroborate each other perfectly, so
  // "Quordle hints and answers for September 13" arrived on the feed with six
  // sources behind it. The same test that keeps chores out of the single-source
  // queue applies here; it is announced rather than silent, because a headline
  // that merely reads like a chore is a story this drops.
  const titleOf = d.prepare(
    'SELECT title FROM articles WHERE cluster_id = ? ORDER BY published_at LIMIT 1');
  const newsworthy = targets.filter((t) => {
    const row = titleOf.get(t.id) as unknown as { title: string } | undefined;
    if (!row || !CHORE.test(row.title)) return true;
    console.log(`  skipped as routine: ${row.title.slice(0, 60)}`);
    return false;
  });
  targets.length = 0;
  targets.push(...newsworthy);

  // Corroborated stories first, always; single-source ones fill whatever the
  // run has left.
  if (targets.length < limit) targets.push(...worthWriting(d).slice(0, limit - targets.length));

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
    const category = (CATEGORIES as readonly string[]).includes(s.category) ? s.category : 'Others';
    // Models hand back "USA" or "United States" as often as "US"; the feed
    // compares this against the reader's two-letter home country. isoCountry
    // also folds UK onto GB, which is the same country under two codes.
    const cc = isoCountry(s.country);
    // A model writing JSON as text hands back the word "null" as readily as the
    // value, and `?? null` cannot see the difference: the story bar then prints
    // `null · 3d ago · 2 outlets`, and the place resolver goes looking for a
    // town called null. A placeholder name is no place at all.
    const named = (v: unknown) => {
      const t = typeof v === 'string' ? v.trim() : '';
      return t && !/^(null|undefined|none|nil|n\/?a|unknown|-{1,2})$/i.test(t) ? t : null;
    };
    const place = named(s.place);
    // The free text stays exactly as the model wrote it — it is what the story
    // bar shows. place_id is the canonical row it points at, resolved from the
    // parts the model separated for us, most specific first, and falling back
    // to the prose when it gave none. NULL when nothing matches.
    const resolved = [named(s.city), named(s.region), place]
      .filter((v): v is string => !!v)
      .reduce<{ place_id: string | null; country: string | null }>(
        (hit, name) => (hit.place_id ? hit : resolvePlaceLocal(d, name, cc)),
        { place_id: null, country: cc },
      );
    // A one-sentence field the model padded to a paragraph is still useful, but
    // an empty string is not — it renders as a side that said nothing.
    const framing = (v: unknown) => (typeof v === 'string' && v.trim().length > 15 ? v.trim() : null);
    save.run(s.headline, s.crux, category, place, resolved.country, resolved.place_id,
             Math.max(1, Math.min(5, Math.round(s.importance) || 3)),
             framing(s.framing_left), framing(s.framing_centre), framing(s.framing_right),
             Date.now(), t.article_count, t.id);
    resetAttempts.run(t.id);
    markDirty('cluster', [t.id]);
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
