import { d1 } from './d1';

export type Story = {
  id: string; headline: string; crux: string; category: string;
  place: string | null; country: string | null; importance: number;
  image_url: string | null; article_count: number; source_count: number;
  first_seen: number; last_seen: number; exploration: 0 | 1;
};

export type Prefs = { country: string; categories: string[]; places: string[] };

export const DEFAULT_PREFS: Prefs = {
  country: 'IN',
  categories: ['World', 'India', 'Technology', 'Science'],
  places: ['Bengaluru'],
};

export async function getPrefs(userId = 'local'): Promise<Prefs> {
  const row = await (await d1()).get<{ country: string; categories: string; places: string }>(
    'SELECT country, categories, places FROM prefs WHERE user_id = ?', [userId]);
  if (!row) return DEFAULT_PREFS;
  return {
    country: row.country ?? DEFAULT_PREFS.country,
    categories: JSON.parse(row.categories ?? '[]'),
    places: JSON.parse(row.places ?? '[]'),
  };
}

export async function savePrefs(p: Prefs, userId = 'local') {
  await (await d1()).run(
    `INSERT INTO prefs (user_id, country, categories, places) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET country=excluded.country,
       categories=excluded.categories, places=excluded.places`,
    [userId, p.country, JSON.stringify(p.categories), JSON.stringify(p.places)]);
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
export async function getFeed(limit = 30, userId = 'local'): Promise<Story[]> {
  const prefs = await getPrefs(userId);
  const rows = await (await d1()).all<Story>(
    `SELECT id, headline, crux, category, place, country, importance, image_url,
            article_count, source_count, first_seen, last_seen
       FROM clusters
      WHERE headline IS NOT NULL AND last_seen >= ?
      ORDER BY last_seen DESC LIMIT 400`,
    [Date.now() - 48 * 3_600_000]);

  const scored = rows.map((s) => ({ s, k: score(s, prefs) })).sort((a, b) => b.k - a.k);
  const known = scored.filter(({ s }) => prefs.categories.includes(s.category));
  const novel = scored.filter(({ s }) => !prefs.categories.includes(s.category));

  // With no stated interests nothing is "outside" them: every story would fall
  // into novel and the marker would make a claim that is false on every card.
  if (known.length === 0) return scored.slice(0, limit).map(({ s }) => ({ ...s, exploration: 0 }));

  const budget = Math.ceil(limit / 4);
  const out: Story[] = [];
  let ki = 0, ni = 0, spent = 0;
  while (out.length < limit && (ki < known.length || ni < novel.length)) {
    const wantNovel = out.length > 0 && out.length % 4 === 3 && ni < novel.length && spent < budget;
    if (wantNovel) { out.push({ ...novel[ni++].s, exploration: 1 }); spent++; }
    else if (ki < known.length) out.push({ ...known[ki++].s, exploration: 0 });
    else if (ni < novel.length) {
      // Padding past the known set: these are off-interest too, but the reserve
      // is one slot in four, so stamp only while the budget lasts.
      const e: 0 | 1 = spent < budget ? 1 : 0;
      spent += e;
      out.push({ ...novel[ni++].s, exploration: e });
    }
    else break;
  }
  return out;
}

export async function getStory(id: string) {
  const d = await d1();
  const cluster = await d.get<Story>('SELECT * FROM clusters WHERE id = ?', [id]);
  if (!cluster) return null;
  const articles = await d.all<{ title: string; url: string; published_at: number; source: string; homepage: string }>(
    `SELECT a.title, a.url, a.published_at, s.name AS source, s.homepage
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ? ORDER BY a.published_at ASC`, [id]);

  const related = await d.all<{ id: string; headline: string; source_count: number; last_seen: number }>(
    `SELECT id, headline, source_count, last_seen FROM clusters
      WHERE category = ? AND id != ? AND headline IS NOT NULL
      ORDER BY last_seen DESC LIMIT 3`, [cluster.category, id]);

  return { cluster, articles, related };
}

export async function logEvent(clusterId: string, kind: string, dwellMs?: number, userId = 'local') {
  await (await d1()).run(
    'INSERT INTO events (user_id, cluster_id, kind, dwell_ms, ts) VALUES (?, ?, ?, ?, ?)',
    [userId, clusterId, kind, dwellMs ?? null, Date.now()]);
}
