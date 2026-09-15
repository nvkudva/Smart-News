import { db, markDirty } from './db';
import { distinctByText, entities, idf, overlap, termFreq, tokenise, vector } from './text';

/**
 * How far back an unsummarised article stays in play. Four days rather than the
 * two the feed reads, because a story one outlet broke is precisely the one
 * whose second source arrives late: while it is still a candidate, a follow-up
 * joins it and the outlet that broke it gets the corroboration it earned.
 *
 * A cluster that already has a headline is not in here at all. Once a story has
 * been written it is finished — its articles are never reassigned, never
 * recategorised, and never pushed again. The cost of that is real and accepted:
 * a late article about a story already on the feed starts a cluster of its own
 * rather than joining it, so the same event can appear twice.
 */
const CANDIDATE_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * Term weights come from a month of headlines, not from the batch being
 * clustered. Computed per batch, a name's weight swings with whatever else was
 * published that day: "Rybakina" is nearly unique in a quiet window and common
 * during a final, so the same pair of articles matches on Tuesday and misses on
 * Thursday. A wider corpus makes rare names reliably heavy, which is what lets
 * two articles match on one strong name instead of needing broad overlap.
 */
const CORPUS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Nearest-member linkage is what lets a story keep matching as it accretes
 * follow-ups, but over a week of candidates it also chains: A matches B, B
 * matches C, and nothing ever asks whether A and C are the same story. One
 * 380-article cluster held the BRICS summit, a Modi-Putin meeting, a Delhi
 * fire and Mumbai traffic. So an article must also bear some resemblance to
 * the group as a whole — a floor far below the pairwise threshold, which a
 * genuine follow-up clears easily and a story linked through two intermediate
 * articles does not.
 */
const CENTROID_FLOOR = 0.10;

/**
 * How much of a match must survive the loss of its strongest single term. A
 * real pair shares the who, the where and the what; a coincidence shares one
 * rare word and collapses to nothing without it.
 */
const RESIDUAL_FLOOR = 0.04;

/**
 * How many names two articles must have in common before similarity alone is
 * allowed to decide. One was not enough: "medicare" appears in an Australian
 * rebate review and a US fraud indictment, and the body text of both is full of
 * the vocabulary of health payments, so the wording agreed even though the
 * stories had nothing to do with each other. Two names is the cheapest test
 * that distinguishes them — same event, same cast.
 */
const MIN_SHARED_NAMES = 1;

/**
 * What a group already holds is evidence about what it is, so the price of
 * joining rises with its size. Two articles pair on 0.16; the 30th needs 0.35,
 * and an article reaching a group of 300 would need more than any real pair of
 * headlines scores. Without this, every India politics story in a week of
 * candidates eventually finds some member of the largest group to link through.
 */
function thresholdFor(size: number, base: number): number {
  return base * (1 + 0.25 * Math.log2(size + 1));
}

/** A cluster this wide is taken as ground truth about what belongs together. */
const ALIAS_MIN_SOURCES = 3;
/** Seen together in this many separate stories before it counts as an alias. */
const ALIAS_MIN_CLUSTERS = 2;

export type ClusterOpts = {
  threshold?: number; entityFloor?: number;
  /** Override the candidate window, for a one-off repair over older rows. */
  windowMs?: number;
};

/** What counting a cluster needs; Row is a superset. */
type Counted = {
  id: string; source_id: string; body: string | null;
  content_hash: string | null; published_at: number;
};

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
/**
 * How many newsrooms actually covered this, which is not the same as how many
 * outlets carried it. A wire story republished by five sites is one piece of
 * reporting, and counting it five times would manufacture the corroboration
 * that decides both rank and card size.
 *
 * Compared on the body, not the headline the clustering uses: an outlet running
 * agency copy rewrites the headline and keeps the text, so the title is the one
 * part that reliably differs.
 */
function independentSources(members: Counted[]): number {
  // One per outlet first — the same outlet's follow-up is not a second source
  // however different it reads — longest body first so the comparison has text.
  const bySource = new Map<string, Counted>();
  for (const m of [...members].sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0))) {
    if (!bySource.has(m.source_id)) bySource.set(m.source_id, m);
  }
  const picked = [...bySource.values()];
  if (picked.length < 2) return picked.length;

  // Without a body there is nothing to compare, so those keep their own count
  // rather than being collapsed on a headline that was never the signal.
  const withText = picked.filter((m) => (m.body ?? '').length > 240);
  const without = picked.length - withText.length;
  if (withText.length < 2) return picked.length;

  return without + distinctByText(withText.map((m) => m.body!)).length;
}

/**
 * Document frequencies over a month of headlines, for idf that does not move
 * with the batch. Falls back to the batch when the corpus is thin — a fresh
 * database has nothing else to weigh with.
 */
function corpusIdf(batch: Map<string, number>[]): Map<string, number> {
  const d = db();
  const docs = d.prepare(
    'SELECT title, lead FROM articles WHERE published_at >= ?',
  ).all(Date.now() - CORPUS_MS) as unknown as { title: string; lead: string | null }[];
  if (docs.length < batch.length) return idf(batch);
  return idf(docs.map((r) => termFreq(tokenise(`${r.title} ${r.lead ?? ''}`))));
}

/**
 * Names that keep turning up in the same story, learned from stories that are
 * already beyond doubt: three newsrooms agreeing is the closest thing to a
 * label this pipeline has. "Amodei" and "Anthropic" co-occur in enough separate
 * clusters to be treated as the same handle on a story, so an outlet that puts
 * only one of them in its headline still matches one that used the other.
 *
 * This is the part that improves on its own. Every week of clusters widens the
 * table, and the threshold for a second source drops accordingly.
 */
function aliasIndex(): { alias: Map<string, Set<string>>; common: Set<string> } {
  const d = db();
  const rows = d.prepare(
    `SELECT a.cluster_id AS cid, a.title AS title
       FROM articles a JOIN clusters c ON c.id = a.cluster_id
      WHERE c.source_count >= ? AND a.published_at >= ?`,
  ).all(ALIAS_MIN_SOURCES, Date.now() - CORPUS_MS) as unknown as { cid: string; title: string }[];

  const perCluster = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = perCluster.get(r.cid);
    if (!set) perCluster.set(r.cid, set = new Set());
    for (const e of entities(r.title)) set.add(e);
  }

  // "delhi" and "india" appear in a tenth of Indian stories, so pairing on them
  // would alias every story in the country to every other. Only names specific
  // enough to identify a story get to stand in for one another.
  const seenIn = new Map<string, number>();
  for (const set of perCluster.values()) for (const e of set) seenIn.set(e, (seenIn.get(e) ?? 0) + 1);
  const tooCommon = Math.max(3, perCluster.size * 0.02);

  const pairs = new Map<string, number>();
  for (const set of perCluster.values()) {
    const es = [...set].filter((e) => (seenIn.get(e) ?? 0) <= tooCommon);
    // A cluster about one story is a handful of names; the pair count stays
    // small. A runaway merge would be quadratic, so cap what it can teach.
    if (es.length > 12) continue;
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        const key = es[i] < es[j] ? `${es[i]}\u0000${es[j]}` : `${es[j]}\u0000${es[i]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const alias = new Map<string, Set<string>>();
  for (const [key, n] of pairs) {
    if (n < ALIAS_MIN_CLUSTERS) continue;
    const [a, b] = key.split('\u0000');
    (alias.get(a) ?? alias.set(a, new Set()).get(a)!).add(b);
    (alias.get(b) ?? alias.set(b, new Set()).get(b)!).add(a);
  }
  const common = new Set([...seenIn].filter(([, n]) => n > tooCommon).map(([e]) => e));
  return { alias, common };
}

/**
 * Does this article name the same thing the group is about?
 *
 * One shared name used to be enough, and a place name is a name: an Australian
 * Medicare review, a US Medicare fraud case and a piece on Social Security all
 * shared "medicare" and were written up as one story. So a name common enough
 * to appear across a fiftieth of all clusters — "delhi", "medicare",
 * "chhattisgarh" — no longer carries a match by itself; it needs a second name
 * beside it, or one specific enough to identify the story on its own.
 */
function sharesName(
  ents: Set<string>, groupEnts: Set<string>, idx: { alias: Map<string, Set<string>>; common: Set<string> },
): boolean {
  let shared = 0, specific = 0;
  for (const e of ents) {
    if (groupEnts.has(e)) {
      shared++;
      if (!idx.common.has(e)) specific++;
    } else {
      const also = idx.alias.get(e);
      // Aliases are mined only from names specific enough to be mined, so a
      // match through one is as good as a specific name of its own.
      if (also) for (const a of also) if (groupEnts.has(a)) { shared++; specific++; break; }
    }
    if (shared >= MIN_SHARED_NAMES || (specific && MIN_SHARED_NAMES <= 1)) return true;
  }
  return false;
}

/** Cosine against the group's mean direction, normalised on the fly. */
function centroidSim(vec: Map<string, number>, group: { members: number[]; sum: Map<string, number> }): number {
  let norm = 0;
  for (const w of group.sum.values()) norm += w * w;
  norm = Math.sqrt(norm) || 1;
  let dot = 0;
  for (const [t, w] of vec) {
    const o = group.sum.get(t);
    if (o) dot += w * (o / norm);
  }
  return dot;
}

/** The few terms an article is most about — its keys in the blocking index. */
function keysOf(vec: Map<string, number>, ents: Set<string>): string[] {
  const top = [...vec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  return [...new Set([...top, ...ents])];
}

export function clusterRecent(opts: ClusterOpts = {}): { clusters: number; assigned: number } {
  // 0.16, down from 0.19: swept over a 48-hour window of ~2900 articles, the
  // looser setting turns 1760 single-source clusters into 1696 and lifts the
  // clusters two or more newsrooms cover from 146 to 162 — a sixth of the feed
  // again, at no model cost. Below 0.12 the merges stop being the same story
  // (a Swiss AI paper joined West Bengal madrassa closures on "education"),
  // so the entity floor below is what keeps this honest, not the threshold.
  const THRESHOLD = opts.threshold ?? 0.16;
  const ENTITY_FLOOR = opts.entityFloor ?? 0.52;
  const d = db();
  const since = Date.now() - (opts.windowMs ?? CANDIDATE_MS);
  // Four days of everything that has not been written up yet. Articles already
  // in a summarised cluster are excluded outright: re-reading them was what let
  // a cluster absorb whatever chained into it run after run — one id collected
  // 388 articles across five days, a BRICS summit with a Delhi fire and Mumbai
  // traffic attached — and reassigning them would rewrite rows D1 has already
  // been paid for.
  const rows = d.prepare(
    `SELECT a.id, a.source_id, a.title, a.lead, a.body, a.image_url, a.published_at,
            a.content_hash, a.cluster_id
       FROM articles a LEFT JOIN clusters c ON c.id = a.cluster_id
      WHERE a.published_at >= ? AND (a.cluster_id IS NULL OR c.headline IS NULL)
      ORDER BY a.published_at ASC`,
  ).all(since) as unknown as Row[];

  // Stories already written up come in as anchors, not candidates. They can be
  // joined — a late article about a summarised story belongs to it, and letting
  // it start a cluster of its own is how the same event ends up on the feed
  // twice — but nothing in them ever moves, they are never recounted, and no
  // second headline is ever written. Joining one costs exactly what the new
  // article row costs, which is owed to D1 either way.
  const anchored = d.prepare(
    `SELECT a.id, a.source_id, a.title, a.lead, a.body, a.image_url, a.published_at,
            a.content_hash, a.cluster_id
       FROM articles a JOIN clusters c ON c.id = a.cluster_id
      WHERE c.headline IS NOT NULL AND a.published_at >= ?
      ORDER BY a.published_at ASC`,
  ).all(since) as unknown as Row[];

  if (!rows.length && !anchored.length) return { clusters: 0, assigned: 0 };

  const all = [...anchored, ...rows];
  const firstCandidate = anchored.length;
  const tfs = all.map((r) => termFreq(tokenise(`${r.title} ${r.title} ${r.title} ${r.lead ?? ''}`)));
  const idfs = corpusIdf(tfs);
  const vecs = tfs.map((tf) => vector(tf, idfs));
  const ents = all.map((r) => entities(r.title));
  const alias = aliasIndex();

  type Group = { members: number[]; ents: Set<string>; sum: Map<string, number>; frozen?: string };
  const groups: Group[] = [];

  // An article is only weighed against groups that already carry one of its
  // strongest terms or one of its names. Comparing with every group was
  // affordable over two days of articles; the week-long singleton window makes
  // that quadratic enough to threaten the cycle's timeout, and a group sharing
  // no heavy term with the article was never going to clear the threshold.
  const index = new Map<string, Set<number>>();
  function indexGroup(g: number, keys: string[]): void {
    for (const k of keys) {
      let set = index.get(k);
      if (!set) index.set(k, set = new Set());
      set.add(g);
    }
  }

  /** Best group for article i, or -1. `skip` excludes the group it sits in. */
  function bestGroup(i: number, skip: number): number {
    let best = -1, bestSim = 0;
    const seen = new Set<number>();
    for (const k of keysOf(vecs[i], ents[i])) {
      for (const g of index.get(k) ?? []) {
        if (g === skip || seen.has(g) || !groups[g].members.length) continue;
        seen.add(g);
        // Nearest member, not the centroid: a centroid drifts as a story
        // accretes follow-ups, and stops matching the next article about it.
        let sim = 0, residual = 0;
        for (const m of groups[g].members) {
          const o = overlap(vecs[i], vecs[m]);
          if (o.sim > sim) { sim = o.sim; residual = o.residual; }
        }
        // One word in common is a coincidence, not a story.
        if (residual < RESIDUAL_FLOOR) continue;
        if (sim < thresholdFor(groups[g].members.length, THRESHOLD) || sim <= bestSim) continue;
        if (sim < ENTITY_FLOOR && !sharesName(ents[i], groups[g].ents, alias)) continue;
        if (centroidSim(vecs[i], groups[g]) < CENTROID_FLOOR) continue;
        best = g; bestSim = sim;
      }
    }
    return best;
  }

  function join(i: number, g: number): void {
    for (const e of ents[i]) groups[g].ents.add(e);
    for (const [t, w] of vecs[i]) groups[g].sum.set(t, (groups[g].sum.get(t) ?? 0) + w);
    groups[g].members.push(i);
    indexGroup(g, keysOf(vecs[i], ents[i]));
  }

  const byCluster = new Map<string, number>();
  for (let i = 0; i < firstCandidate; i++) {
    const id = all[i].cluster_id!;
    let g = byCluster.get(id);
    if (g === undefined) {
      byCluster.set(id, g = groups.length);
      groups.push({ members: [], ents: new Set(), sum: new Map(), frozen: id });
    }
    join(i, g);
  }

  for (let i = firstCandidate; i < all.length; i++) {
    const g = bestGroup(i, -1);
    if (g === -1) {
      groups.push({ members: [i], ents: new Set(ents[i]), sum: new Map(vecs[i]) });
      indexGroup(groups.length - 1, keysOf(vecs[i], ents[i]));
    } else {
      join(i, g);
    }
  }

  // The pass above judges each article against only the groups that existed
  // when it arrived, so whoever published first can end up alone beside the
  // group that formed around the same story an hour later. Offer every
  // singleton one more chance now that every group exists: this is where the
  // ordering losses come back, and it costs one extra sweep.
  for (let g = 0; g < groups.length; g++) {
    if (groups[g].frozen || groups[g].members.length !== 1) continue;
    const i = groups[g].members[0];
    const into = bestGroup(i, g);
    if (into === -1) continue;
    join(i, into);
    groups[g].members = [];
  }
  const live = groups.filter((g) => g.members.length);

  const insert = d.prepare(
    `INSERT INTO clusters (id, image_url, image_source, article_count, source_count, first_seen, last_seen)
     VALUES (?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       image_url    = COALESCE(excluded.image_url, clusters.image_url),
       image_source = COALESCE(excluded.image_source, clusters.image_source)`,
  );
  const assign = d.prepare('UPDATE articles SET cluster_id = ? WHERE id = ?');
  const sourceNames = new Map(
    (d.prepare('SELECT id, name FROM sources').all() as unknown as { id: string; name: string }[])
      .map((s) => [s.id, s.name]),
  );

  // Identity must survive re-runs: a group reuses whichever id its members
  // already carry, so a story keeps the id — and the summary already paid for —
  // as new articles join it.
  //
  // But an id can only belong to one group. When a cluster comes apart, every
  // fragment sees that same old id as its own majority and claims it, so all of
  // them write to one row and the split never happens: three unrelated
  // Chhattisgarh stories stayed filed as one for as long as the rows existed.
  // The largest claim keeps the id; the rest are new stories and are given new
  // ids, which is what they are.
  const claims = live.map((g) => {
    const members = g.members.map((i) => all[i]);
    const tally = new Map<string, number>();
    for (const m of members) if (m.cluster_id) tally.set(m.cluster_id, (tally.get(m.cluster_id) ?? 0) + 1);
    const [id, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? [undefined, 0];
    return { g, members, want: g.frozen ?? id, votes: g.frozen ? Infinity : n };
  });
  const winner = new Map<string, { votes: number; members: number }>();
  for (const c of claims) {
    if (!c.want) continue;
    const held = winner.get(c.want);
    if (!held || c.votes > held.votes || (c.votes === held.votes && c.members.length > held.members)) {
      winner.set(c.want, { votes: c.votes, members: c.members.length });
    }
  }
  const taken = new Set<string>();

  let assigned = 0;
  const touched = new Set<string>();
  // Written-up stories that gained an outlet. Their counts move; nothing else
  // does. The reader sees the extra source in the outlet list — that is read
  // live off the articles — and the corroboration number catches up with it.
  const grown = new Set<string>();
  const movedArticles: string[] = [];
  for (const { g, members, want, votes } of claims) {
    const held = want ? winner.get(want) : undefined;
    const keeps = want && !taken.has(want)
      && held!.votes === votes && held!.members === members.length;
    if (keeps) taken.add(want!);
    const id = keeps ? want! : `c_${members[0].id}`;
    if (!g.frozen) {
      const image = bestImage(members);
      insert.run(id, image?.image_url ?? null, image ? sourceNames.get(image.source_id) ?? null : null,
                 Math.min(...members.map((m) => m.published_at)),
                 Math.max(...members.map((m) => m.published_at)));
    }
    // Only articles that actually moved are written, and only those are owed to
    // D1. Re-stamping a row with the cluster id it already had was most of what
    // the sync used to upload.
    for (const m of members) {
      if (m.cluster_id === id) continue;
      assign.run(id, m.id);
      movedArticles.push(m.id);
      assigned++;
      if (m.cluster_id) touched.add(m.cluster_id);
      if (g.frozen) grown.add(id);
    }
    if (!g.frozen) touched.add(id);
  }

  // Count over every article the cluster holds, not the ones this run happened
  // to look at. The counts came from the candidate window before, so a story
  // whose early coverage had aged out of it was having its own corroboration
  // rewritten downward as it got older — reading as single-source, and so
  // dropping out of a feed that ranks on exactly that number.
  const allOf = d.prepare(
    'SELECT id, source_id, body, content_hash, published_at FROM articles WHERE cluster_id = ?',
  );
  const stored = d.prepare(
    'SELECT article_count, source_count, first_seen, last_seen FROM clusters WHERE id = ?',
  );
  const recount = d.prepare(
    'UPDATE clusters SET article_count = ?, source_count = ?, first_seen = ?, last_seen = ? WHERE id = ?',
  );
  const changed: string[] = [];

  // A written-up story keeps the timestamps it was written with: it must not
  // climb back up a feed ranked on recency for having gained a seventh article
  // saying what the first six said. Only the counts move.
  const recountFrozen = d.prepare(
    'UPDATE clusters SET article_count = ?, source_count = ? WHERE id = ?',
  );
  for (const id of grown) {
    const members = allOf.all(id) as unknown as Counted[];
    if (!members.length) continue;
    const articles = new Set(members.map((m) => m.content_hash ?? m.id)).size;
    const sources = independentSources(members);
    const was = stored.get(id) as unknown as { article_count: number; source_count: number } | undefined;
    if (was && was.article_count === articles && was.source_count === sources) continue;
    recountFrozen.run(articles, sources, id);
    changed.push(id);
  }

  for (const id of touched) {
    const members = allOf.all(id) as unknown as Counted[];
    if (!members.length) continue;
    const counts = {
      article_count: new Set(members.map((m) => m.content_hash ?? m.id)).size,
      source_count: independentSources(members),
      first_seen: Math.min(...members.map((m) => m.published_at)),
      last_seen: Math.max(...members.map((m) => m.published_at)),
    };
    const was = stored.get(id) as unknown as typeof counts | undefined;
    if (was && was.article_count === counts.article_count && was.source_count === counts.source_count
        && was.first_seen === counts.first_seen && was.last_seen === counts.last_seen) continue;
    recount.run(counts.article_count, counts.source_count, counts.first_seen, counts.last_seen, id);
    changed.push(id);
  }
  markDirty('article', movedArticles);
  markDirty('cluster', changed);

  d.exec('DELETE FROM clusters WHERE id NOT IN (SELECT DISTINCT cluster_id FROM articles WHERE cluster_id IS NOT NULL)');
  return { clusters: live.length, assigned };
}
