import { db } from './db';

export type Story = {
  id: string; headline: string; crux: string; category: string;
  place: string | null; country: string | null; importance: number;
  image_url: string | null; article_count: number; source_count: number;
  last_seen: number; exploration: 0 | 1;
};

export type Prefs = { country: string; categories: string[]; places: string[] };

export const DEFAULT_PREFS: Prefs = {
  country: 'IN',
  categories: ['World', 'India', 'Technology', 'Science'],
  places: ['Bengaluru'],
};

export function getPrefs(userId = 'local'): Prefs {
  const row = db().prepare('SELECT country, categories, places FROM prefs WHERE user_id = ?')
    .get(userId) as unknown as { country: string; categories: string; places: string } | undefined;
  if (!row) return DEFAULT_PREFS;
  return {
    country: row.country ?? DEFAULT_PREFS.country,
    categories: JSON.parse(row.categories ?? '[]'),
    places: JSON.parse(row.places ?? '[]'),
  };
}

export function savePrefs(p: Prefs, userId = 'local') {
  db().prepare(
    `INSERT INTO prefs (user_id, country, categories, places) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET country=excluded.country,
       categories=excluded.categories, places=excluded.places`,
  ).run(userId, p.country, JSON.stringify(p.categories), JSON.stringify(p.places));
}

const HALF_LIFE_H = 9;

function score(s: Story, prefs: Prefs): number {
  const ageH = (Date.now() - s.last_seen) / 3_600_000;
  const recency = Math.pow(0.5, ageH / HALF_LIFE_H);
  const corroboration = Math.log1p(s.source_count) / Math.log(25);
  let interest = 0.55;
  if (prefs.categories.includes(s.category)) interest = 1;
  if (s.country && s.country === prefs.country) interest = Math.max(interest, 0.95);
  if (s.place && prefs.places.some((p) => s.place!.toLowerCase().includes(p.toLowerCase()))) interest = 1.15;
  return recency * (0.35 + 0.65 * corroboration) * (s.importance / 5) * interest;
}

/**
 * Ranked feed with a reserved exploration budget: one slot in four goes to a
 * story outside the user's stated categories, chosen on merit within that set.
 */
export function getFeed(limit = 30, userId = 'local'): Story[] {
  const prefs = getPrefs(userId);
  const rows = db().prepare(
    `SELECT id, headline, crux, category, place, country, importance, image_url,
            article_count, source_count, last_seen
       FROM clusters
      WHERE headline IS NOT NULL AND last_seen >= ?
      ORDER BY last_seen DESC LIMIT 400`,
  ).all(Date.now() - 48 * 3_600_000) as unknown as Story[];

  const scored = rows.map((s) => ({ s, k: score(s, prefs) })).sort((a, b) => b.k - a.k);
  const known = scored.filter(({ s }) => prefs.categories.includes(s.category));
  const novel = scored.filter(({ s }) => !prefs.categories.includes(s.category));

  const out: Story[] = [];
  let ki = 0, ni = 0;
  while (out.length < limit && (ki < known.length || ni < novel.length)) {
    const wantNovel = out.length > 0 && out.length % 4 === 3 && ni < novel.length;
    if (wantNovel) out.push({ ...novel[ni++].s, exploration: 1 });
    else if (ki < known.length) out.push({ ...known[ki++].s, exploration: 0 });
    else if (ni < novel.length) out.push({ ...novel[ni++].s, exploration: 1 });
    else break;
  }
  return out;
}

export function getStory(id: string) {
  const d = db();
  const cluster = d.prepare('SELECT * FROM clusters WHERE id = ?').get(id) as unknown as Story | undefined;
  if (!cluster) return null;
  const articles = d.prepare(
    `SELECT a.title, a.url, a.published_at, s.name AS source, s.homepage
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ? ORDER BY a.published_at ASC`,
  ).all(id) as unknown as { title: string; url: string; published_at: number; source: string; homepage: string }[];

  const related = d.prepare(
    `SELECT id, headline, source_count, last_seen FROM clusters
      WHERE category = ? AND id != ? AND headline IS NOT NULL
      ORDER BY last_seen DESC LIMIT 3`,
  ).all(cluster.category, id) as unknown as { id: string; headline: string; source_count: number; last_seen: number }[];

  return { cluster, articles, related };
}

export function logEvent(clusterId: string, kind: string, dwellMs?: number, userId = 'local') {
  db().prepare('INSERT INTO events (user_id, cluster_id, kind, dwell_ms, ts) VALUES (?, ?, ?, ?, ?)')
    .run(userId, clusterId, kind, dwellMs ?? null, Date.now());
}
