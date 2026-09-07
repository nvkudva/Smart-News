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
