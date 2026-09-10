import { db } from './db';
import { cosine, entities, idf, termFreq, tokenise, vector } from './text';

const WINDOW_MS = 48 * 60 * 60 * 1000;

export type ClusterOpts = { threshold?: number; entityFloor?: number };

type Row = {
  id: string; source_id: string; title: string; lead: string | null;
  body: string | null; image_url: string | null; published_at: number;
  content_hash: string | null; cluster_id: string | null;
};

const THUMB = /(thumb|thumbnail|[/_-]small[/_-]|[/_-]s\.|icon|logo|sprite|placeholder|avatar|[/_-]150x|[/_-]?square)/;

/**
 * Ranks candidates by what the URL admits about the file. Feeds routinely ship
 * a 90px thumbnail for the same event another source publishes at 1200px, and
 * the cluster only gets to show one, so prefer the one that will not blur.
 */
function imageScore(url: string): number {
  const u = url.toLowerCase();
  let px = 0;
  const q = u.match(/[?&](?:w|width|maxwidth|imwidth|resize)=(\d{2,5})/);
  if (q) px = Number(q[1]);
  const dim = u.match(/[/_-](\d{2,5})x(\d{2,5})[._/-]/);
  if (dim) px = Math.max(px, Number(dim[1]));
  let score = px ? Math.min(px, 2400) / 100 : 0;
  if (THUMB.test(u)) score -= 8;
  if (u.includes('.svg')) score -= 8;
  if (u.includes('.gif')) score -= 4;
  if (!u.startsWith('https:')) score -= 1;
  return score;
}

function bestImage(members: Row[]): Row | null {
  let best: Row | null = null, bestScore = -Infinity;
  for (const m of members) {
    if (!m.image_url) continue;
    const s = imageScore(m.image_url);
    if (s > bestScore) { best = m; bestScore = s; }
  }
  return best;
}

/**
 * Greedy single-pass agglomeration. Each article joins the nearest existing
 * centroid above threshold, otherwise starts a cluster. Cheap, order-dependent,
 * and good enough while a run only ever sees ~2k articles.
 */
export function clusterRecent(opts: ClusterOpts = {}): { clusters: number; assigned: number } {
  const THRESHOLD = opts.threshold ?? 0.19;
  const ENTITY_FLOOR = opts.entityFloor ?? 0.52;
  const d = db();
  const since = Date.now() - WINDOW_MS;
  const rows = d.prepare(
    `SELECT id, source_id, title, lead, body, image_url, published_at, content_hash, cluster_id
       FROM articles WHERE published_at >= ? ORDER BY published_at ASC`,
  ).all(since) as unknown as Row[];

  if (!rows.length) return { clusters: 0, assigned: 0 };

  const tfs = rows.map((r) => termFreq(tokenise(`${r.title} ${r.title} ${r.title} ${r.lead ?? ''}`)));
  const idfs = idf(tfs);
  const vecs = tfs.map((tf) => vector(tf, idfs));
  const ents = rows.map((r) => entities(r.title));

  type Group = { members: number[]; ents: Set<string> };
  const groups: Group[] = [];

  for (let i = 0; i < rows.length; i++) {
    let best = -1, bestSim = 0;
    for (let g = 0; g < groups.length; g++) {
      // Nearest member, not the centroid: a centroid drifts as a story accretes
      // follow-ups, and stops matching the next article about the same event.
      let sim = 0;
      for (const m of groups[g].members) {
        const s = cosine(vecs[i], vecs[m]);
        if (s > sim) sim = s;
      }
      if (sim < THRESHOLD || sim <= bestSim) continue;
      let shared = 0;
      for (const e of ents[i]) if (groups[g].ents.has(e)) shared++;
      if (shared === 0 && sim < ENTITY_FLOOR) continue;
      best = g; bestSim = sim;
    }
    if (best === -1) {
      groups.push({ members: [i], ents: new Set(ents[i]) });
    } else {
      for (const e of ents[i]) groups[best].ents.add(e);
      groups[best].members.push(i);
    }
  }

  const upsert = d.prepare(
    `INSERT INTO clusters (id, image_url, image_source, article_count, source_count, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       image_url    = COALESCE(excluded.image_url, clusters.image_url),
       image_source = COALESCE(excluded.image_source, clusters.image_source),
       article_count = excluded.article_count,
       source_count  = excluded.source_count,
       last_seen     = excluded.last_seen`,
  );
  const assign = d.prepare('UPDATE articles SET cluster_id = ? WHERE id = ?');
  const sourceNames = new Map(
    (d.prepare('SELECT id, name FROM sources').all() as unknown as { id: string; name: string }[])
      .map((s) => [s.id, s.name]),
  );

  let assigned = 0;
  for (const g of groups) {
    const members = g.members.map((i) => rows[i]);
    // Identity must survive re-runs: reuse whichever id the members already
    // carry (most common wins when two clusters merge), and only mint a new one
    // for a genuinely new story. Deriving it from the earliest article instead
    // loses the id — and the paid-for summary — the moment a backdated article
    // joins and becomes the new earliest.
    const tally = new Map<string, number>();
    for (const m of members) if (m.cluster_id) tally.set(m.cluster_id, (tally.get(m.cluster_id) ?? 0) + 1);
    const inherited = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const id = inherited ?? `c_${members[0].id}`;
    const sources = new Set(members.map((m) => m.source_id));
    const hashes = new Set(members.map((m) => m.content_hash ?? m.id));
    const image = bestImage(members);
    upsert.run(id, image?.image_url ?? null, image ? sourceNames.get(image.source_id) ?? null : null,
               hashes.size, sources.size,
               Math.min(...members.map((m) => m.published_at)),
               Math.max(...members.map((m) => m.published_at)));
    for (const m of members) { assign.run(id, m.id); assigned++; }
  }

  d.exec('DELETE FROM clusters WHERE id NOT IN (SELECT DISTINCT cluster_id FROM articles WHERE cluster_id IS NOT NULL)');
  return { clusters: groups.length, assigned };
}
