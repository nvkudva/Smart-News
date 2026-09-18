import pLimit from 'p-limit';
import { CATEGORIES, db, markDirty } from './db';
import type { Bias } from '../../web/shared/sources';
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
crux:       6 to 8 sentences of plain declarative prose. What happened, who says
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
importance: 5 for a story a world newspaper leads its front page with, 1 for routine.`;

/**
 * Asked for whenever any picked article carries a lean. A single-lean story
 * still gets its one sentence: the page shows each side that spoke, and
 * "how the left-leaning outlets framed it" reads as a description of the
 * coverage, not a claim that another side disagreed. Only a cluster with no
 * rated outlet at all skips it, since there is nothing to write.
 */
const FRAMING = `

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
  },
  required: ['headline', 'crux', 'category', 'importance'],
};

const FRAMING_SCHEMA: JsonSchema = {
  ...SCHEMA,
  properties: {
    ...SCHEMA.properties,
    framing_left:   { type: 'string', nullable: true },
    framing_centre: { type: 'string', nullable: true },
    framing_right:  { type: 'string', nullable: true },
  },
};

/**
 * A framing is only kept for a lean that has an outlet on the story. Small
 * models fill every framing_<lean> they are shown, and file a sentence under
 * the wrong one: a story carried by two right-leaning papers came back with a
 * "left" line, and one outlet's single account came back as three near-identical
 * sides. On a story with exactly one lean the sentence is that lean's, whatever
 * key it arrived under, so it is filed there.
 */
export function keepPresent(f: Record<Bias, string | null>, present: Set<Bias>): Record<Bias, string | null> {
  const out: Record<Bias, string | null> = { left: null, centre: null, right: null };
  if (present.size === 1) {
    const [only] = present;
    out[only] = f[only] ?? f.centre ?? f.left ?? f.right;
  } else {
    for (const b of present) out[b] = f[b];
  }
  return out;
}

export async function summariseCluster(members: Member[], signal?: AbortSignal): Promise<LlmOutcome<Summary>> {
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

  const framed = picked.some((m) => m.bias);
  const corpus = picked.map((m, i) =>
    `<article n="${i + 1}" source="${m.name}"${framed && m.bias ? ` lean="${m.bias}"` : ''}>\n<title>${m.title}</title>\n` +
    `${(m.body ?? m.lead ?? '').slice(0, MAX_CHARS_EACH)}\n</article>`).join('\n\n');

  const out = await completeJson<Summary>(
    framed ? SYSTEM + FRAMING : SYSTEM,
    `${members.length} articles cover this one event. Here are ${picked.length} of them.\n\n${corpus}`,
    framed ? FRAMING_SCHEMA : SCHEMA,
    undefined,
    signal,
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
 * A same-day safety net, no more. Recurrence below is the real test, and it
 * needs three days before it can fire; without this a new puzzle column gets
 * three days of the feed first. Deliberately short — every pattern here is one
 * I have to keep guessing at, and a headline that merely reads like a chore is
 * a real story this refuses.
 */
const CHORE = /^(how to|q&a|watch:|live updates|\d+ things)\b|\b(hints and answers|team of the week|daily quiz|horoscope)\b/i;

/**
 * Three shapes the rhythm test cannot see, from the labelled sample in
 * docs/labels.md. All three were stories the two labellers flatly disagreed
 * about, and all three disagreements are the same question wearing different
 * clothes: is a package of several small items one story?
 *
 * Each is anchored rather than stated as a keyword, because the unanchored
 * version of every one of them refuses real news. The survey that produced
 * these:
 *
 *   BRIEF    "HT Morning Brief September 12: Xi Jinping headed to India, …"
 *            An outlet's daily package. routineShapes should have caught it by
 *            rhythm and cannot: `signature` keeps the whole title, and the tail
 *            after the colon is a different set of stories every morning, so the
 *            signature never repeats. Anchored near the start, because "CIA
 *            releases dozens of presidential daily briefs on Bin Laden" is a
 *            story about briefs rather than one of them.
 *
 *   BUNDLE   "Zomato's Latest Fee, Weekly Funding Rundown & More"
 *            A list of unrelated items under one headline: there is no event to
 *            summarise, so the model invents a through-line. Only the ampersand
 *            form, because "a $110 million deal includes a school, water
 *            reclamation, and more" is one story that happens to end that way.
 *
 *   POSTING  "Sonia Rovai Appointed Disney Italy VP of Original Production"
 *            A trade appointment. The discriminator is the sentence shape, not
 *            the word: a headline that OPENS with a person's name in title case
 *            and goes on to name the job is written for the industry, while
 *            "Trump-Appointed Judge Rules…", "Operator to be appointed soon"
 *            and "Vijayan challenges CM Satheesan to release list of 787
 *            personal staff appointed" all put the news first.
 *
 *            Deliberately not case-insensitive, which is the whole of how it
 *            tells those apart — with /i the first draft took five real stories
 *            out of nine matches. A job title has to follow the verb too, or
 *            "Aditya Thackeray named in Disha Salian case", "Kolkata Roads
 *            Named After Marx, Lenin" and every footballer who joins a club
 *            come with it. Chief executives are carved out: that move is news
 *            outside the trade press.
 *
 * Checked against all 9,699 titles in the store: ten, seven and two matches
 * respectively, and nothing in any of them is a story. Run that again before
 * widening any of these - each one is narrow because its unanchored version
 * was measured and was not.
 */
const BRIEF = /^.{0,24}\b(morning|evening|daily|weekly)\s+(brief|briefing|digest|wrap|rundown|roundup)\b/i;
const BUNDLE = /&\s*more\s*$/i;
const POSTING = /^[A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){1,3}\s+(?:Appointed|Named|Promoted [Tt]o|Elevated [Tt]o|Joins [Aa]s)\s+[^:]{0,60}?\b(?:VP|SVP|EVP|Vice President|President|Managing Director|Director|Head|Editor|Chief|Partner|Officer)\b/;
/** A chief executive changing company is news, not a trade posting. */
const NOT_POSTING = /\b(CEO|Chief Executive)\b/;

const PERIODIC = /\b(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

/** A headline with everything that changes daily taken out of it. */
function signature(title: string): string {
  return title.toLowerCase().replace(PERIODIC, ' ').replace(/[0-9]+/g, ' ')
    .replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Headline shapes an outlet publishes on a schedule.
 *
 * A chore is not identifiable by its words — every keyword list is a guess that
 * needs maintaining — but it is identifiable by its rhythm: Euronews files
 * "Latest news bulletin" three times a day, TechRadar posts Quordle hints every
 * morning, BBC Sport runs a daily quiz. Nothing that happened once can look
 * like that, so a real story cannot trip this however its headline reads.
 *
 * Corroboration cannot see any of it. Several outlets run the day's puzzle
 * hints and they agree with each other perfectly, which is how Quordle reached
 * the feed with six sources behind it.
 */
function routineShapes(d: DatabaseSync): Set<string> {
  const rows = d.prepare(
    `SELECT source_id, title, DATE(published_at / 1000, 'unixepoch') AS day
       FROM articles WHERE published_at >= ?`,
  ).all(Date.now() - 7 * 86_400_000) as unknown as
    { source_id: string; title: string; day: string }[];

  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.source_id}|${signature(r.title)}`;
    (days.get(key) ?? days.set(key, new Set()).get(key)!).add(r.day);
  }
  // Three separate days. Twice is a coincidence, and a story that genuinely
  // runs two days running is a story.
  const out = new Set<string>();
  for (const [key, seen] of days) if (seen.size >= 3) out.add(key);
  return out;
}

/** Is this article one instalment of something its outlet files on a schedule? */
function isRoutine(routine: Set<string>, sourceId: string, title: string): boolean {
  return CHORE.test(title) || BRIEF.test(title) || BUNDLE.test(title)
    || (POSTING.test(title) && !NOT_POSTING.test(title))
    || routine.has(`${sourceId}|${signature(title)}`);
}

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
/**
 * How many single-source stories one outlet may have written in a day.
 *
 * Three feeds were 45% of single-source writes over three days - Yahoo Finance
 * 372, The Hindu 364, Times of India 231 - and the run's cap never bound (8 to
 * 10 singles a run against a cap of 30), so heat alone let a high-volume feed
 * take whatever it produced. A share per outlet is what makes the cut land on
 * single-ticker analysis and broadsheet filler rather than on the desk nobody
 * else covers.
 *
 * A day, not a run: a story refused this run is still inside the six-hour
 * window next run, so a per-run share only defers and the outlet writes
 * everything over the window anyway. Against a trailing day it ages out
 * unwritten. Measured on 16 Sep, 30 a day would have refused 205 of 512
 * singles; on the 17th, 56 of 418.
 */
const PER_SOURCE_DAY = Number(process.env.SUMMARISE_PER_SOURCE ?? 30);

/**
 * Slots each outlet has left today, from what it has already had written in
 * the last 24 hours against its share.
 *
 * The share is halved for an outlet whose single-source stories the model
 * itself has rated below importance 3 on average over the last week. It is
 * the model's own rating, so it moves with the model - a prior for allocating
 * slots, not a verdict on the outlet - and an outlet with under ten samples
 * keeps the full share rather than being judged on a handful. An outlet
 * absent from the map has written nothing today and gets the full share.
 */
function sourceAllowance(d: DatabaseSync): Map<string, number> {
  const now = Date.now();
  const rows = d.prepare(
    `SELECT source_id,
            SUM(CASE WHEN summarised_at >= ? THEN 1 ELSE 0 END) AS today,
            AVG(importance) AS imp, COUNT(*) AS n
       FROM (SELECT DISTINCT c.id, a.source_id, c.importance, c.summarised_at
               FROM clusters c JOIN articles a ON a.cluster_id = c.id
              WHERE c.source_count = 1 AND c.summarised_at >= ?)
      GROUP BY source_id`,
  ).all(now - 86_400_000, now - 7 * 86_400_000) as unknown as
    { source_id: string; today: number; imp: number; n: number }[];
  const left = new Map<string, number>();
  for (const r of rows) {
    const share = r.n >= 10 && r.imp < 3 ? Math.max(1, Math.floor(PER_SOURCE_DAY / 2)) : PER_SOURCE_DAY;
    left.set(r.source_id, Math.max(0, share - r.today));
  }
  return left;
}

function worthWriting(d: DatabaseSync): { id: string; article_count: number }[] {
  const since = Date.now() - 48 * 3_600_000;
  // Heat is measured against two days of headlines, but only fresh articles are
  // eligible to be written. An older singleton has had longer to accumulate
  // matching names, so scoring the whole window picked day-old stories every
  // time — and the feed only considers the last 24 hours, so they were written
  // and then never seen. Six hours leaves a story most of its half-life.
  const fresh = Date.now() - 6 * 3_600_000;
  // And a floor beneath it, because writing is what ends a story's chances.
  // Once a cluster has a headline it is frozen: a late article can still join
  // it, but two written-up clusters can never be merged into one, and nothing
  // in the clusterer ever compares two anchors. So the half-hour cycle was
  // freezing a scoop about thirty minutes after it landed, and when the second
  // outlet's version failed to match on wording it started a cluster of its
  // own, was written up in turn, and the split became permanent.
  //
  // Two hours, measured rather than chosen: of 196 pairs in a 48-hour window
  // that score as one story but sit in two written-up clusters, 34 were
  // published within two hours of each other. Four hours would reach 60, and
  // costs every single-source story another two hours of a 24-hour feed's
  // attention — a worse trade than it looks, because the mass is at the short
  // end (22 of those 34 are inside one hour) and 87 of the 196 are 12 hours
  // apart, which no floor under the freshness ceiling above can reach.
  //
  // What makes the wait worth anything is that the second look is not the same
  // look: 131 of the 196 had one side gain a member between the two publishing
  // times, so a cluster left unfrozen is re-scored against a group that has
  // actually changed, not re-asked a question already answered.
  const settled = Date.now() - 2 * 3_600_000;
  const heat = heatIndex(d, since);
  const routine = routineShapes(d);
  const rows = d.prepare(
    `SELECT c.id, c.article_count, a.source_id, a.title, a.published_at
       FROM clusters c JOIN articles a ON a.cluster_id = c.id
      WHERE c.headline IS NULL AND c.source_count = 1 AND c.attempts < ?
        AND a.published_at >= ? AND a.published_at <= ?
        AND LENGTH(COALESCE(a.body, '')) > 800`,
  ).all(MAX_ATTEMPTS, fresh, settled) as unknown as
    { id: string; article_count: number; source_id: string; title: string; published_at: number }[];

  const scored: { id: string; article_count: number; source_id: string; heat: number; at: number }[] = [];
  for (const r of rows) {
    if (isRoutine(routine, r.source_id, r.title)) continue;
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
    scored.push({ id: r.id, source_id: r.source_id, heat: others.size, at: r.published_at,
                  article_count: r.article_count });
  }
  // Heat still sorts, so if the run's limit binds it binds on the weakest
  // stories rather than on whichever desk happened to be queried first.
  scored.sort((a, b) => b.heat - a.heat || b.at - a.at);
  // One entry per cluster: the join above yields a row per fresh article, and
  // a cluster with two of them was queued, and paid for, twice in one run.
  const left = sourceAllowance(d);
  const seen = new Set<string>();
  const out: { id: string; article_count: number }[] = [];
  for (const s of scored) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const slots = left.get(s.source_id) ?? PER_SOURCE_DAY;
    if (slots <= 0) continue;
    left.set(s.source_id, slots - 1);
    out.push({ id: s.id, article_count: s.article_count });
  }
  return out;
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
  const routine = routineShapes(d);
  const titleOf = d.prepare(
    `SELECT source_id, title FROM articles WHERE cluster_id = ? ORDER BY published_at LIMIT 1`);
  const newsworthy = targets.filter((t) => {
    const row = titleOf.get(t.id) as unknown as { source_id: string; title: string } | undefined;
    if (!row || !isRoutine(routine, row.source_id, row.title)) return true;
    console.log(`  skipped as routine: ${row.title.slice(0, 60)}`);
    return false;
  });
  targets.length = 0;
  targets.push(...newsworthy);

  // Corroborated stories first, always; single-source ones fill whatever the
  // run has left - but only up to a cap of their own.
  //
  // Without one this was the entire bill. The run limit is 150 and corroborated
  // supply is about 117 clusters a DAY, so the corroborated queue can fill
  // roughly 2% of the 7,200 slots 48 runs offer and worthWriting took the rest:
  // 20,173 neurons on 16 Sep against a 10,000 free allowance.
  //
  // The default is set from the allowance rather than from taste, and since
  // granite replaced llama at about a quarter of the cost it is set from supply
  // as well - the two now answer differently, and supply answers first.
  //
  // Measured over four full days: ~946 single-source clusters a day clear the
  // body floor, which is 20 a run, and ~120 corroborated ones. Writing every
  // single one of them costs ~5,200 neurons against the 10,000 allowance. So
  // there is no cap in the 20s or 30s that refuses work we would otherwise do;
  // 36 is a CEILING rather than a limit, the point at which a day of unusual
  // supply would be stopped at ~87% of the allowance instead of going past it.
  //
  // That is the whole change in what this constant is for. At six a run it was
  // refusing about two thirds of the queue every run because the model made
  // that necessary. At 36 it refuses nothing on a normal day and still cannot
  // overspend on an abnormal one.
  //
  // It also settles what heat is for. worthWriting sorts by heat and refuses
  // nothing, which was right while nothing else bounded the work; with a cap,
  // the cap refuses the tail and heat decides which stories are in it.
  const singleMax = Number(process.env.SUMMARISE_SINGLE_MAX ?? 36);
  if (targets.length < limit) {
    targets.push(...worthWriting(d).slice(0, Math.min(singleMax, limit - targets.length)));
  }

  // Title-tier members are excluded: we never fetched their article, so the
  // only text they could contribute is an RSS blurb, and they are not counted
  // as sources anywhere else either. They put the story on a front page; that
  // is a ranking fact, not something the write-up may attribute to them.
  const membersOf = d.prepare(
    `SELECT a.source_id, s.name, s.bias, a.title, a.lead, a.body
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ? AND COALESCE(s.tier, 'full') <> 'title'`,
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

  /**
   * When this run has to be over, whatever the queue still holds.
   *
   * A call that never answers costs 90 seconds, and llm.ts spends five of them
   * with backoff before giving up - eight minutes on one cluster, in silence,
   * because a transport failure is deliberately not an attempt against the
   * cluster and so prints nothing and records nothing. Four of those at a time
   * is how a run that had already written 436 of 471 stories sat for another
   * half hour looking like it had hung.
   *
   * Eight minutes by default, under cycle.yml's twelve-minute job timeout, so a
   * cycle that overruns ends itself and syncs what it has rather than being
   * killed with its work unpushed. Whatever it did not reach is still pending
   * and is simply the next run's queue.
   */
  const stop = AbortSignal.timeout(Number(process.env.SUMMARISE_DEADLINE_MS ?? 8 * 60_000));

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
    if (authFailure || stop.aborted) { skipped++; return; }
    const members = membersOf.all(t.id) as unknown as Member[];
    const r = config ? await summariseCluster(members, stop) : extractive(members);
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
    const framed = keepPresent(
      { left: framing(s.framing_left), centre: framing(s.framing_centre), right: framing(s.framing_right) },
      new Set(members.map((m) => m.bias).filter((b): b is Bias => !!b)),
    );
    save.run(s.headline, s.crux, category, place, resolved.country, resolved.place_id,
             Math.max(1, Math.min(5, Math.round(s.importance) || 3)),
             framed.left, framed.centre, framed.right,
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
  // Said out loud, because the whole reason for the deadline is that the
  // alternative looked like a hang rather than like work.
  if (stop.aborted) {
    process.stdout.write(`  ! deadline reached with ${targets.length - done - skipped} still queued — they stay pending
`);
  }

  return { done, skipped, using: config ? describe(config) : 'extractive placeholder (no API key)' };
}
