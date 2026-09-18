# D1 usage and the plan to cut it

Measured 2026-09-18 over 24h: **3.05M rows read, 59k rows written**, ~42 pipeline cycles.
Free tier: 5M reads / 100k writes per day, 100k Worker requests per day.
Numbers come from `wrangler d1 insights smartnews --sort-by reads|writes|count --timePeriod 1d`
and `EXPLAIN QUERY PLAN` against the live database.

## Where it goes

### Reads — the pipeline is ~95%

| Rows/day | Runs | Query | Why it scans |
|---:|---:|---|---|
| 793k | 39 | `prune` orphan sweep: `SELECT id FROM clusters WHERE last_seen < ? AND id NOT IN (SELECT cluster_id FROM articles …)` | `SCAN clusters` (the `last_seen` indexes are partial on `headline IS NOT NULL`) plus every article `cluster_id` materialised — 20k rows to find a handful |
| 525k | 53 | `prune` paging: `SELECT id FROM articles WHERE published_at < ? AND id > ? ORDER BY id LIMIT 400` | `ORDER BY id` walks the primary key; `articles_published` exists and is never used. 1% efficiency |
| 490k | 42 | `hydrate` topUp: `SELECT … FROM articles WHERE fetched_at > ?` | No index on `fetched_at` → `SCAN articles` (11.6k rows, 565 ms) to return what is almost always nothing |
| 437k | 1,097 | `reap`: `SELECT id FROM clusters WHERE last_seen >= ? AND id > ? ORDER BY id LIMIT 400` | Honest reads (99% efficient) — pages every in-window cluster id each cycle to diff against the local store |
| 130k | 42 | checkpoint: `SELECT COUNT(*), MAX(last_seen) FROM clusters WHERE headline IS NOT NULL` | Counts 3,111 live rows to write one number |

Table sizes: 12,865 articles, 8,295 clusters (3,350 live).

### Reads — the app is ~65k/day

The feed's section queries ran 407 times (155 rows each). That is the count of cold isolates,
not readers: shared answers are memoised per isolate on the cycle stamp (`worker/lib/cache.ts`),
and a Worker-built response never enters Cloudflare's edge cache, so nothing is shared between
readers except isolate memory.

Per reader, per day, today:

- Each poll (every 15 min while visible, plus every tab return) is one `/api/stamp` request and
  ~0 D1 rows — the stamp is memoised per isolate for 60 s. `/api/world` is asked only when the
  stamp moved, so at most once a cycle.
- Navigating asks `/api/stamp` once per 5 minutes (`STAMP_TTL_MS` in `src/lib/store.ts`);
  world, place, explore, reels and local are keyed on it and re-fetched only when it moves.
- A story opened from the feed is answered from the held world (`fromWorld` in
  `story.$id.tsx`), no request. A story from explore, reels, local or saved is 1 Worker
  request + 4 statements, `no-store`, never cached (`getStory` in `worker/lib/feed.ts` +
  `isSaved`). Linear in readers.
- `StoryWarm` preloads the story route on hover (120 ms dwell) and on touch — for a story
  outside the held feed that was a `/api/story` request per pointer, up to 40 a session,
  whether or not the reader tapped.
- **The first wall on Free is Worker requests, not D1.** 1,000 active readers ≈ 106k
  requests/day; D1 would be at ~6% of its read limit.

### Writes — honest work

41.5k of the 59k is the sync's upserts: 20,510 cluster rows and 18,219 article rows. Divided by
their index counts (clusters: 4 + autoindex, articles: 2 + autoindex) that is ~4,100 and ~4,500
real upserts a day, in line with ~1,500 new articles plus re-files. The rest is index
maintenance. Cutting it means fewer indexes, not different queries — leave it.

### Neurons — already fixed

Free tier is 10,000/day. 13, 15 and 16 Sept ran 20.7k / 21.8k / 20.2k on
`@cf/meta/llama-3.2-3b-instruct`. Since the switch to `@cf/ibm-granite/granite-4.0-h-micro`
on the 17th: 7.9k, then 1.5k. Granite does the same token volume for about a quarter of the
neurons.

## Plan of action

### Safe and quick wins

Each is one function or one constant, no schema change, no new index, no behaviour change
readers can see.

- [x] **Prune: page on `published_at`, delete as you go.** `WHERE published_at < ? ORDER BY
  published_at LIMIT 400`, each page deleted before the next is asked for — no cursor. Plan:
  `SEARCH articles USING INDEX articles_published`. ~15 rows a cycle instead of 9,913.
  −525k/day.
- [x] **Prune: sweep only the candidates.** The `cluster_id`s of the articles just deleted,
  checked in batches with `NOT EXISTS` — plan: `SEARCH clusters (id=?)` + covering
  `articles_cluster` probe. −790k/day. Known edge: a run that dies between the article delete
  and the sweep leaves empty out-of-window clusters that nothing revisits.
- [x] **Checkpoint count from the local file.** The cycle stamp's `COUNT(*)`/`MAX(last_seen)`
  now reads the open SQLite store, which holds the same clusters after the pushes and both
  prunes. −130k/day.
- [x] **Overnight cadence.** `deploy/cron-worker` skips the half-hour firing between 00:00 and
  06:00 IST, so the pipeline runs hourly overnight. −25% of every pipeline number, reads and
  writes both. Needs its own `wrangler deploy` from `deploy/cron-worker`.
- [x] **`related` from the memoised topic section.** `read.ts` takes six neighbours from
  `getSection`, the same six the client derives from the held world; `getStory` no longer
  runs a query for them. A story older than the 48-hour window now gets no related list.
- [x] **Rate-limit the visibility refresh.** A tab return within 5 minutes of the last look no
  longer forgets the stamp and asks for it again (`startWorldRefresh` in
  `web/src/lib/world.ts`). The 15-minute timer is untouched.
- [x] **Preload only what is free.** `StoryWarm` now warms a story on hover or touch only when
  the held feed can answer it; a story from explore, reels, local or saved loads on tap
  instead of on every pointer. Trades ~100–300 ms on those taps for no speculative
  `/api/story` requests. Reversible if the speed is worth the requests.

### Needs a little care

- [ ] **Hydrate topUp: order, then delete.** The `fetched_at` pull is the recovery path for a
  push that died between the article push and the token write (`sync-d1.ts`, reap can throw
  after articles are up, and `cycle.yml` saves the store with `if: always()`). Move the
  `sync_meta` token write *before* the article push; a dead run then mismatches and forces a
  full rebuild (0.3% of the daily limit, already priced in TODO.md). Only then delete the pull.
  −490k/day. Do not add an index on `fetched_at` instead — that spends write rows on every
  upsert to fix a read that should not happen.
- [ ] **Hygiene: check `conditional()` before `getPrefs()`** in `world()`, `local()` and
  `place()` (`worker/read.ts`). A 304 there still reads one prefs row. The client's stamp
  gate means it rarely happens, so this is tidiness, not a number.

### Medium

- [ ] **Split `/api/story` into public + `saved`.** Cluster, articles and related are the same
  for everyone: `public`, ETag on the stamp, stored in `caches.default`. `saved` from the
  client's own local `savedIds()` (already there for offline) or a one-row endpoint. Story
  opens → ~0 D1 rows on a colo hit.
- [ ] **`caches.default` for every stamp-keyed shared answer** (sections, explore, reels,
  facets), not just isolate memory. Per-colo sharing, survives isolate eviction. Cloudflare's
  docs confirm the Cache API works on `*.workers.dev`, scoped per data centre.
- [ ] **Reap by tombstone.** Record merged and emptied cluster ids in `dirty`, push explicit
  `DELETE`s, stop paging 9.8k ids a cycle to diff them. −430k/day.

### Architectural

- [ ] **R2 as the publish target — not the working store.** Sync writes each dirty
  `story/<id>.json` plus section, explore and reels JSON every cycle (~4k puts a day, inside
  R2's free 1M Class A a month; rewriting all 3,350 stories every cycle would not be). The
  Worker composes per reader from R2 plus one prefs row. D1 per reader collapses to prefs and
  saved. TODO.md's R2 item is a different problem (Actions-cache eviction, writing the store
  from a laptop) and does not touch these numbers.
- [ ] **Workers Paid, $5/month.** D1 25B reads / 50M writes a month, 10M Worker requests.
  Removes every ceiling on this page; everything above becomes cost per reader instead of a
  wall.
- [ ] If per-reader telemetry ever lands: Workers Analytics Engine, never the `events` table.

### Do not

- KV for per-reader or per-story data: 1k writes / 100k reads a day free — worse than what is
  being reduced.
- Durable Object SQLite as a read model: billed per row too.
- An external database: latency from a Worker and the binding is lost.
- Push only changed cluster columns: all four cluster indexes carry `last_seen`, so a bump
  rewrites them anyway.
- Drop `articles_published` or `articles_cluster`: the prune fixes depend on them.
- Gate `/api/world` behind `/api/stamp` to save requests: `/api/stamp` is itself a Worker
  request, so it is invocation-neutral. It only helps as a D1 saver, and the fingerprint fix
  above does that more cheaply.
