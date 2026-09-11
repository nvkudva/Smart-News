const STOP = new Set(`a about after all also an and any are as at be been but by can could did do does for from had has have he her his how i if in into is it its just like may me more most new no not of on one only or other our out over said say says she should so some such than that the their them then there these they this those to up was we were what when where which who will with would you your says year years new news first two three after before during under than more most been being`.split(/\s+/));

export function tokenise(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'’-]{2,}/g) ?? [])
    .map((w) => w.replace(/['’]s$/, ''))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Term-frequency map, sub-linearly scaled so a repeated word can't dominate. */
export function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, n] of tf) tf.set(t, 1 + Math.log(n));
  return tf;
}

export function idf(docs: Map<string, number>[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const out = new Map<string, number>();
  for (const [t, c] of df) out.set(t, Math.log((n + 1) / (c + 0.5)));
  return out;
}

/** L2-normalised tf-idf vector. */
export function vector(tf: Map<string, number>, idfs: Map<string, number>): Map<string, number> {
  const v = new Map<string, number>();
  let norm = 0;
  for (const [t, f] of tf) {
    const w = f * (idfs.get(t) ?? 0);
    if (w <= 0) continue;
    v.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const o = large.get(t);
    if (o) dot += w * o;
  }
  return dot;
}

/** Rare, capitalised-in-source words carry most of a news story's identity. */
export function entities(title: string): Set<string> {
  const out = new Set<string>();
  for (const m of title.matchAll(/\b([A-Z][a-z’'-]{2,}(?:\s+[A-Z][a-z’'-]{2,})*)\b/g)) {
    const phrase = m[1].toLowerCase();
    if (!STOP.has(phrase)) out.add(phrase);
  }
  return out;
}

export function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|cmp|CMP|at_|ito|smid|partner)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

/** Cheap, order-insensitive fingerprint of a headline, for syndication collapse. */
export function titleFingerprint(title: string): string {
  const t = tokenise(title).sort();
  return t.slice(0, 12).join('.');
}

/**
 * Above this, two articles are the same piece of journalism rather than two
 * accounts of one event. See distinctByText for why it is Jaccard and not the
 * cosine the clustering uses.
 */
export const NEAR_DUPLICATE = 0.5;

const SHINGLE = 5;

/** Overlapping word n-grams. Republished copy shares long exact runs; two
 *  newsrooms writing up the same event essentially never do. */
function shingles(text: string): Set<string> {
  const t = tokenise(text);
  if (t.length < SHINGLE) return new Set(t.length ? [t.join(' ')] : []);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= t.length; i++) out.add(t.slice(i, i + SHINGLE).join(' '));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Indices of the texts that are not republications of an earlier one.
 *
 * Wire copy is the case this exists for: an agency story carried by five
 * outlets is one newsroom's work, and counting it five times would inflate
 * corroboration — which decides both a story's rank and the size of its card.
 * Order matters, so callers should pass their preferred article first; the
 * survivor of a duplicate pair is the earlier index.
 *
 * Deliberately NOT the TF-IDF cosine the clustering uses. IDF is computed over
 * the documents in hand, and here that is a handful from one cluster — so the
 * text they share, which is the entire signal, is the text IDF weights toward
 * zero. Three copies of one wire story scored as unrelated under it. Jaccard
 * over five-word shingles asks the question directly and does not care how many
 * documents it is given.
 */
export function distinctByText(texts: string[], threshold = NEAR_DUPLICATE): number[] {
  if (texts.length < 2) return texts.map((_, i) => i);
  const grams = texts.map(shingles);
  const kept: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (kept.every((k) => jaccard(grams[i], grams[k]) < threshold)) kept.push(i);
  }
  return kept;
}
