import pLimit from 'p-limit';
import { CATEGORIES, db } from './db';
import { completeJson, describe, llmConfig, type JsonSchema } from './llm';

const MAX_ARTICLES = 6;
const MAX_CHARS_EACH = 2600;

type Member = { source_id: string; name: string; title: string; lead: string | null; body: string | null };

export type Summary = {
  headline: string; crux: string; category: string;
  place: string | null; country: string | null; importance: number;
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
importance: 5 for a story a world newspaper leads its front page with, 1 for routine.`;

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline:   { type: 'string' },
    crux:       { type: 'string' },
    category:   { type: 'string', enum: CATEGORIES },
    place:      { type: 'string', nullable: true },
    country:    { type: 'string', nullable: true },
    importance: { type: 'integer' },
  },
  required: ['headline', 'crux', 'category', 'importance'],
};

export async function summariseCluster(members: Member[]): Promise<Summary | null> {
  // One article per source, longest body first: diverse and substantive.
  const bySource = new Map<string, Member>();
  for (const m of [...members].sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0))) {
    if (!bySource.has(m.source_id)) bySource.set(m.source_id, m);
  }
  const picked = [...bySource.values()].slice(0, MAX_ARTICLES);
  if (!picked.length) return null;

  const corpus = picked.map((m, i) =>
    `<article n="${i + 1}" source="${m.name}">\n<title>${m.title}</title>\n` +
    `${(m.body ?? m.lead ?? '').slice(0, MAX_CHARS_EACH)}\n</article>`).join('\n\n');

  return completeJson<Summary>(
    SYSTEM,
    `${members.length} articles cover this one event. Here are ${picked.length} of them.\n\n${corpus}`,
    SCHEMA,
  );
}

/**
 * Stand-in used only when no provider key is configured, so the app is runnable
 * before anyone signs up for anything. It quotes one source verbatim rather than
 * synthesising across them — which is exactly what the product exists not to do.
 */
function extractive(members: Member[]): Summary | null {
  const best = [...members].sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0))[0];
  if (!best) return null;
  const text = (best.body ?? best.lead ?? '').replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'“])/).slice(0, 5).join(' ');
  if (!sentences) return null;
  return {
    headline: best.title.replace(/\s*[|–-]\s*[^|–-]{0,24}$/, '').slice(0, 90),
    crux: sentences.slice(0, 620),
    category: 'World',
    place: null,
    country: null,
    importance: Math.min(5, 1 + Math.round(Math.log2(members.length + 1))),
  };
}

/** Summarise clusters that are new, or that have grown 40%+ since last time. */
export async function summarisePending(limit = 30): Promise<{ done: number; skipped: number; using: string }> {
  const d = db();
  const config = llmConfig();
  const targets = d.prepare(
    `SELECT id, article_count FROM clusters
      WHERE summarised_at IS NULL OR article_count >= summarised_n * 1.4
      ORDER BY source_count DESC, article_count DESC
      LIMIT ?`,
  ).all(limit) as unknown as { id: string; article_count: number }[];

  const membersOf = d.prepare(
    `SELECT a.source_id, s.name, a.title, a.lead, a.body
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ?`,
  );
  const save = d.prepare(
    `UPDATE clusters SET headline=?, crux=?, category=?, place=?, country=?, importance=?,
            summarised_at=?, summarised_n=? WHERE id=?`,
  );

  const limiter = pLimit(3);  // requests are paced inside llm.ts; overlap just hides latency
  let done = 0, skipped = 0;

  await Promise.all(targets.map((t) => limiter(async () => {
    const members = membersOf.all(t.id) as unknown as Member[];
    const s = config ? await summariseCluster(members) : extractive(members);
    if (!s) { skipped++; return; }
    const category = (CATEGORIES as readonly string[]).includes(s.category) ? s.category : 'World';
    save.run(s.headline, s.crux, category, s.place ?? null, s.country ?? null,
             Math.max(1, Math.min(5, Math.round(s.importance) || 3)), Date.now(), t.article_count, t.id);
    done++;
    process.stdout.write(`  ✓ ${String(members.length).padStart(2)} src  ${s.headline.slice(0, 66)}\n`);
  })));

  return { done, skipped, using: config ? describe(config) : 'extractive placeholder (no API key)' };
}
