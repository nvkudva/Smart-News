# Architecture review

Read-only review of the deployed read path (`src/app`, `src/lib`), the pipeline
(`scripts/`, `src/lib/{ingest,cluster,summarise}.ts`), the sync boundary
(`scripts/sync-d1.ts`, `scripts/d1-schema.ts`) and the schedule
(`.github/workflows/cycle.yml`, `deploy/cron-worker`).

Everything stated as fact was read in the files cited. Where a claim depends on
SQLite/D1 query-planner behaviour or on production traffic I could not observe, it
is marked **(inferred)**. I did not run the build, the pipeline, or any query, so
no numbers here are measured by me — the measured figures quoted in comments
(131k writes/day, 2.8M rows/day, 471,808 input tokens) are the author's and I
take them as given.

---

## What is good

**The two-store split, and the fact that the reason is written down.**
`src/lib/d1.ts:8-11` and `scripts/sync-d1.ts:10-18` both state the constraint that
forces it: a cluster run issues thousands of statements, and over D1's HTTP API each
would be a round trip. Most projects discover this after shipping the wrong thing.
The split also gives the pipeline real transactions and real foreign keys
(`src/lib/db.ts:14`, `db.ts:59-68`) that D1 does not enforce.

**One `D1` interface over three backends.** `src/lib/d1.ts:30-94` gives binding,
REST and local-SQLite implementations behind the same three methods, and
`d1.ts:106-116` picks between them by sniffing the Workers runtime rather than by a
build flag. The payoff named at `d1.ts:4-6` is real: `next dev` executes the same SQL
string the Worker will. The `SMARTNEWS_LOCAL_D1` escape hatch at `d1.ts:72-81`
correctly identifies that an exhausted D1 read budget otherwise takes local
development down with production.

**The cycle stamp is derived from data, not from the clock.**
`scripts/sync-d1.ts:196-206` computes `COUNT(*)-MAX(last_seen)` over the summarised
set and leaves `sync_meta` untouched when it has not moved. The comment at
`sync-d1.ts:193-195` explains why the count is needed alongside the max — a ghost
merge deletes a row without moving the maximum. That is the kind of detail that
usually gets found in production six months later.

**Seed-table fingerprinting.** `scripts/sync-d1.ts:62-74`. `INSERT OR REPLACE`
bills a write whether or not the value changed; hashing the rows and keeping the
hash *in D1* (because the runner is stateless) is the correct fix, and it is the
difference between fitting the 100k/day write budget and not.

**`reap()` is properly paranoid.** `scripts/sync-d1.ts:87-112` releases child
articles before deleting a cluster, explicitly because D1 does not enforce the
foreign key that the local store does (`sync-d1.ts:102-106`), and refuses to delete
at all when more than 10% of remote clusters are locally absent — which is exactly
what a failed hydrate looks like. This is the single best piece of defensive design
in the repo.

**Corroboration counts newsrooms, not URLs.** `src/lib/cluster.ts:61-78` picks one
article per outlet, then collapses near-identical bodies via
`distinctByText` (`src/lib/text.ts:131`), and the comment at `cluster.ts:51-59`
states why the body and not the headline is the comparable part. Since
`source_count` feeds both ranking and card size (`src/lib/feed.ts:188`,
`feed.ts:201`), getting this wrong would have corrupted the product's core claim.
`src/lib/summarise.ts:79-85` applies the same collapse to the prompt, for tokens.

**The gazetteer as a compiled in-memory index.** `src/lib/places.ts:41-51` builds
`BY_ID` / `BY_ADMIN1` / `BY_COUNTRY` / `BY_ALIAS` once per isolate, and every
hierarchy question then becomes a map walk: `expandPlaceIds` at `places.ts:186-197`,
`geoAdjacentPlaceIds` at `places.ts:204-228`, `nearestPlace` at `places.ts:235-261`.
The fixed three-level tree (`places.ts:5-8`) is what makes a flat `IN` list
sufficient instead of a recursive CTE, and sub-city text as an alias onto the city
row (`places.ts:10-12`) is a genuinely good modelling decision.

**Streaming and HTTP status, handled correctly.** `src/app/story/[id]/page.tsx:19-23`
and `src/app/c/[cat]/page.tsx:22-24` both record that Next commits the status when the
body starts streaming, so a `loading.tsx` above a `notFound()` turns a 404 into a
200. Both routes are structured around it — the taxonomy lookup in `c/[cat]` happens
before any `await` (`page.tsx:32-34`) precisely so the `Suspense` boundary below it
cannot flush first.

**Promise caching rather than result caching, with negative-result eviction.**
`src/lib/sections.ts:76-87` and `src/components/SectionFeed.tsx:28-40` both cache the
in-flight promise, so concurrent readers share one query, and both delete the entry
on rejection so a failure is not remembered as the answer for a minute
(`sections.ts:82-83`, `SectionFeed.tsx:38`). Adequate rather than excellent — see
the staleness stacking in *Improvement 6*.

**Keyset paging in hydrate.** `scripts/hydrate-d1.ts:28-43`, with the cost of the
`OFFSET` version written down at `hydrate-d1.ts:30-32`.

**`BOOT` is deliberately not a client module.** `src/lib/boot.ts:1-11` explains that
a string exported from a `'use client'` module becomes a client reference by the time
a server component reads it, which is why the theme previously flashed. Paired with
`next/script strategy="beforeInteractive"` and the reason for not using a bare
`<script>` at `src/app/layout.tsx:61-66`.

**Valid JSON is not a usable summary.** `src/lib/summarise.ts:100-106` rejects an
object that parses but omits or truncates fields, instead of writing `undefined`
into a headline.

---

## Areas for improvement

Ranked by impact.

### 1. There is exactly one user, and any visitor can rewrite their preferences

Every read and write defaults to `userId = 'local'`: `getPrefs`/`savePrefs`
(`src/lib/feed.ts:76`, `feed.ts:94`), `isSaved`/`toggleSaved`/`getSaved`
(`src/lib/library.ts:12`, `library.ts:17`, `library.ts:28`), `logEvent`
(`feed.ts:403`). No caller ever passes anything else — `src/app/actions.ts:53-73`,
`actions.ts:86-124` and every page call it with no argument. The `prefs` and `saved`
tables are keyed on `user_id` (`scripts/d1-schema.ts:39-44`) but only ever hold the
row `'local'`.

The server actions in `src/app/actions.ts` are publicly reachable POST endpoints.
So any visitor to the deployed site can: change the home country and interests that
rank *everyone's* feed (`savePrefsAction`, `actions.ts:53`), toggle consent and
write a geo place (`setGeoConsentAction`, `actions.ts:86`), and add or remove rows
from the shared `saved` list (`toggleSavedAction`, `actions.ts:16`). Each of those is
a D1 write against a 100k/day budget with no rate limit in front of it, and
`savePrefsAction` additionally does a read-modify-write (`actions.ts:55` then
`actions.ts:71`) with no concurrency control, so two visitors racing silently drop
one of the two edits.

This also constrains the planned ETag work: a single cycle stamp is a sound
validator for `/api/section` only while sections are not reader-specific. Today
`getFeed`/`getLocalSection`/`getNationalSection` all depend on `prefs`
(`src/lib/sections.ts:104-107`), so the stamp does not change when prefs change, and
a 304 would serve a feed ranked for the previous preferences. With one global user
that is merely confusing; with real identities it is a correctness bug.

**Fix:** mint an opaque id into an `HttpOnly` cookie on first request and thread it
through as `userId`; scope the `warm` map key in `sections.ts:102` (it already
interpolates `userId`) and the ETag scope (`etagFor`'s unused `scope` argument,
`src/lib/cycle.ts:38`) to it. If a single-reader site is the deliberate design, then
the write actions need an auth gate instead — the current state is neither.

### 2. The cron worker's `fetch` handler is an unauthenticated pipeline trigger

`deploy/cron-worker/src/index.ts:34-40` dispatches the GitHub workflow on any POST,
with no shared secret, no signature, and no IP or header check. The comment at
`index.ts:33` describes it as a hand-trigger for checking the wiring. Anyone who
learns the worker URL can fire the full cycle repeatedly: GitHub Actions minutes,
D1 reads and writes, and Workers AI neurons (the 10k/day budget) all spend on each
run. `concurrency.group` in `.github/workflows/cycle.yml:13-15` serialises the runs
but does not discard them.

**Fix:** require a secret in a header (`wrangler secret put TRIGGER_TOKEN`, compared
with a timing-safe equality) or delete the `fetch` handler and trigger manually from
the Actions tab, which `cycle.yml:10` already allows.

### 3. `/reels` issues one D1 statement per story

`src/app/reels/page.tsx:15`: `await Promise.all(stories.map((s) => isSaved(s.id)))`.
`isSaved` is one `SELECT` each (`src/lib/library.ts:12-15`), so a 20-story reel is
21 statements. `Promise.all` does not help much here: the `D1` interface exposes only
`all`/`get`/`run` (`src/lib/d1.ts:16-20`), so there is no `batch()`, and on the REST
backend each is a separate HTTPS request with a 30s timeout
(`d1.ts:50-56`) **(inferred: on the binding the driver may pipeline these; over
HTTP it certainly cannot)**.

**Fix:** one statement — `SELECT cluster_id FROM saved WHERE user_id = ? AND
cluster_id IN (...)` — and a `Set`. Worth adding `batch(statements)` to the `D1`
interface while you are there; `profile` (`src/app/profile/page.tsx:17-21`) and every
`getPrefs` + query pair would use it.

### 4. `getStats()` scans two whole tables on every profile render

`src/lib/library.ts:118-126` runs `COUNT(*) FROM articles`, `COUNT(*) FROM clusters`,
a filtered count, plus `MAX(last_seen)`. D1 bills rows read, and an unindexed
`COUNT(*)` reads every row **(inferred from SQLite's planner: there is no covering
count shortcut, and no index on `articles` that the planner can count from)**. The
article bodies are synced (`scripts/sync-d1.ts:17`, `sync-d1.ts:171-182`) and
nothing ever deletes them (see *Improvement 11*), so this cost grows monotonically
for the life of the database. `src/app/profile/page.tsx:14` is `force-dynamic`, so
there is no cache in front of it.

**Fix:** have `sync-d1.ts` write the six counts into `sync_meta` beside the cycle
stamp — it already holds the local SQLite file open and can count there for free —
and make `getStats` one `SELECT ... FROM sync_meta WHERE key IN (...)`.

### 5. The D1 schema has silently drifted from the local schema it claims to mirror

`scripts/d1-schema.ts:12` states "Mirrors migrate() in src/lib/db.ts. Both must
change together." Comparing `d1-schema.ts:55-64` against `src/lib/db.ts:70-72`,
`db.ts:121` and `db.ts:154`, D1 is missing:

- `clusters_place ON clusters(place_id, last_seen DESC)` (`db.ts:154`)
- `articles_hash ON articles(content_hash)` (`db.ts:72`)
- `events_user ON events(user_id, ts DESC)` (`db.ts:121`)
- `articles.url UNIQUE` and both foreign keys (`db.ts:59-68`, `db.ts:91`)

The first one is load-bearing on the read path. `getLocalFeed` filters
`c.place_id IN (...)` (`src/lib/feed.ts:303-308`) and so does `getByPlace`
(`src/lib/library.ts:86-88`); with no index on `place_id`, D1 must fall back to the
partial `last_seen` index or a table scan and filter **(inferred)**. That is the
Local tab and every Explore place tile.

`articles_hash` matters to the pipeline only, but the pipeline reads `articles` out
of the local file, so its absence in D1 is harmless — which is precisely why the
drift went unnoticed. The missing `UNIQUE` on `url` means D1 cannot reject a
duplicate the local store would have rejected.

**Fix:** add the three indexes to `SCHEMA` (they are `IF NOT EXISTS`, so idempotent),
and make the mirroring checkable rather than aspirational — e.g. derive both from one
exported list of index DDL, or add a `build:check` step that diffs the index names.

### 6. `revalidatePath` does nothing, and three independent 60-second caches do

`src/app/actions.ts:10-20` calls `revalidatePath` for `/`, `/local`, `/profile` and
`/saved`. All four are `force-dynamic` (`src/app/(feed)/page.tsx:9`,
`local/page.tsx:8`, `profile/page.tsx:14`, `saved/page.tsx:5`), so there is nothing
cached to revalidate, and the incremental cache is the read-only static-assets one
(`open-next.config.ts:16-22`), which cannot be written to at runtime — the file says
so at `open-next.config.ts:11-12`. These calls are ceremony.

What actually delays a preference change from appearing is three caches that the save
does not touch, and which compose additively:

- the per-isolate `warm` map, 60s (`src/lib/sections.ts:73-74`)
- the per-tab module-scope `cache`, 60s (`src/components/SectionFeed.tsx:21-22`)
- the service worker's stale-while-revalidate on `/api/*`, 60s (`public/sw.js:74`)

Worst case a reader saves interests and the Technology section still reflects the old
ranking nearly three minutes later, having returned a stale body from the SW, which
was filled from a stale client entry, which was filled from a stale isolate entry.

**Fix:** drop the `revalidatePath` calls, and give the prefs write a way to punch
through: bump the cycle stamp (or a second `prefs` stamp) on save and key the
`sections.ts` map and the `SectionFeed` map on it, so a save invalidates by changing
the key rather than by waiting out three TTLs.

### 7. `cache-control: public` on responses that depend on preferences

`src/app/api/section/[cat]/route.ts:40` sends `public, max-age=15, s-maxage=60,
stale-while-revalidate=300`, and `src/app/api/place/route.ts:21` sends
`public, max-age=60, stale-while-revalidate=600`. Both bodies are derived from the
`prefs` row: `/api/place` returns the reader's own resolved location
(`place/route.ts:14-19`), and `/api/section` delegates to `getFeed` /
`getLocalSection` / `getNationalSection` for four of the fourteen slugs
(`src/lib/sections.ts:104-107`). Marking reader-specific data `public` is the bug
that becomes a cross-reader leak the moment *Improvement 1* is fixed, and is
currently masked only by there being one reader.

Separately, `s-maxage=60` is inert: the site is on `workers.dev`, so there is no
shared cache to honour it. It reads as working edge caching and is not.

**Fix:** `private` on both (and drop `s-maxage`), or move the prefs-dependent slugs
to a separate route that is never marked `public`.

### 8. The most-visited route is the only expensive one

`/c/[cat]` is a prerendered shell served from Workers Static Assets and costs no
invocation (`src/app/c/[cat]/page.tsx:9-25`), while `/` — the app's entry point, the
SW's precached shell (`public/sw.js:21`) and the PWA start URL — is `force-dynamic`
(`src/app/(feed)/page.tsx:9`) and renders 30 cards server-side off a 150-row query
(`src/lib/feed.ts:220-225`). So does `/local`, `/explore`, `/reels`, `/saved`,
`/profile` and `/story/[id]`. The architecture that was built for categories was not
applied to the route that gets the traffic.

**Fix:** give `/` the same shape as `/c/[cat]` — a static shell plus
`/api/section/top` through `SectionFeed` — which also removes the "Top is the one
section rendered on the server" special case at `(feed)/page.tsx:29-32`. `/explore`
and `/reels` are equally derivable from the taxonomy plus an API call.

### 9. Two defects in the service worker's stale-while-revalidate

`public/sw.js:44`:

```js
const age = Date.now() - Date.parse(hit.headers.get('date') || '') || 0;
```

`Date.parse('')` is `NaN`, so the subtraction is `NaN`, so `||` yields `0` — an
unknown age is treated as *brand new*, and `sw.js:45` then skips the background
refresh entirely. The entry is returned from cache forever. This is unreachable for
same-origin `/api/*` responses (the runtime sets `Date`) but is the normal case for
cross-origin publisher images, whose opaque responses expose no headers at all
(`sw.js:59`). Unknown age should default to stale, not fresh.

Second, nothing bounds the `media-v2` cache: `sw.js:26-30` deletes caches whose
*name* changed, and `MEDIA` never changes name, so it accumulates every story
photograph the reader has ever scrolled past until the browser evicts the origin's
storage wholesale — taking `shell-v2` and the offline fallback with it.

**Fix:** `const parsed = Date.parse(...); const age = Number.isNaN(parsed) ? Infinity
: Date.now() - parsed;` and cap `MEDIA` with a simple FIFO trim on `put`.

### 10. `placesReady()` re-probes D1 on every call until it succeeds, and is called repeatedly

`src/lib/places.ts:107-121` caches only the `true` answer (deliberately, per
`places.ts:104-105`). A `false` — the unmigrated case, and also the case where D1 is
*unreachable*, which `places.ts:117-118` collapses into the same `false` — means
every subsequent call re-issues the three-subquery `sqlite_master` probe. A single
`getFeed` calls it at `feed.ts:77` (via `getPrefs`) and again at `feed.ts:219`;
`bySql` calls it per section query (`sections.ts:33`); `library.ts` calls it in six
more places. So the degraded path, which exists to keep the site up, is also the path
that multiplies D1 statements.

Conflating "not migrated" with "cannot reach D1" is the worse half: a transient D1
error makes the site serve pre-v1.5 shapes with no place data rather than retrying.

**Fix:** memoise the `false` for a short TTL the way `cycleStamp` does
(`src/lib/cycle.ts:17-21`), and distinguish the thrown case from the genuinely
unmigrated case so a transient failure does not silently downgrade the schema the
whole request tree assumes.

### 11. Nothing ever deletes an article from D1

`scripts/sync-d1.ts:23` pushes a 5-day window and `scripts/hydrate-d1.ts:19` reads
the same window back, but the only `DELETE` against D1 anywhere is `reap`'s cluster
deletion (`sync-d1.ts:109`). Article rows — including full bodies, up to 8000
characters each (`src/lib/ingest.ts:83`) — accumulate permanently. At the stated
~5.5k articles per working set (`hydrate-d1.ts:32`) this is roughly a 5-day window of
live data sitting inside an ever-growing table.

Consequences: `getStats` gets slower and more expensive forever (*Improvement 4*);
`hydrate`'s `PRAGMA table_info` and windowed pulls stay cheap, so nothing in the
cycle notices; and D1's free storage ceiling is eventually the wall.

**Fix:** a prune step at the end of `sync`, deleting `articles WHERE published_at <
?` in `MAX_PARAMS`-sized batches outside the window, and clearing `cluster_id`
references first for the same reason `reap` does (`sync-d1.ts:102-106`).

### 12. The clusterer is quadratic in articles and cubic-ish in group size

`src/lib/cluster.ts:100-122`: for each article, loop over every existing group, and
within each group over every member, computing a cosine. With `n` articles in one
group that is O(n²) comparisons for that group alone, and the outer loop makes the
whole pass O(n²) in the window's article count. `cluster.ts:46-50` acknowledges
exactly this ("good enough while a run only ever sees ~2k articles"), and the 48-hour
window at `cluster.ts:4` is what holds `n` down.

It matters because the budget is already tight: `cycle.yml:20` sets
`timeout-minutes: 15` against a 15-minute cron, so the clustering pass competes for
the same wall clock as ingest and summarisation. Doubling the source list
(`src/lib/sources.ts`, 14.6KB of them) roughly quadruples this loop.

**Fix:** block candidates by shared entity before scoring — `ents` is already
computed at `cluster.ts:95`, so an inverted index from entity to group ids turns the
group scan into a lookup over a handful of candidates. Nearest-member rather than
centroid (`cluster.ts:103-105`) is a good decision and survives this change.

### 13. The cycle is one unmonitored job with a timeout equal to its period

`.github/workflows/cycle.yml:20` sets a 15-minute timeout; the cron fires every 15
minutes (`deploy/cron-worker/src/index.ts:29-32`); `concurrency.cancel-in-progress:
false` (`cycle.yml:13-15`) queues rather than drops. A slow run therefore overlaps
its successor's dispatch, and there is no `if: failure()` step, no notification, and
nothing that surfaces a dead cycle to the site — the only signal a reader gets is
`stats.newest` on the profile page (`src/app/profile/page.tsx:109`).

The failure mode that actually loses work: `hydrate` → `cycle` → `sync` are three
separate steps (`cycle.yml:43-50`) and the runner's disk is scratch
(`hydrate-d1.ts:14-16`). If `sync` fails, everything `cycle` just paid Workers AI
neurons for is gone, and the next run re-summarises from D1's older state. The `.t0`
stamp (`scripts/cycle.ts:29`) is written to that same scratch disk, so it cannot
carry a retry across runs either.

**Fix:** add a retry on the `sync` step, and a cheap liveness signal — the cycle
stamp is already in `sync_meta`, so a staleness check against it (or a dead-man
ping) turns a silent stall into something you find out about. Dropping the job
timeout below the cron period would make overlap impossible rather than merely
unlikely.

---

## Code organisation

**Module boundaries are mostly right, and the rules are written down where they
matter.** `src/lib/places.ts:14-16` states that the module may import only `./d1`
and web globals, with the pipeline's synchronous twin in `places-local.ts` — that is
the correct seam for a codebase where half the files run on Node and half in a
Worker. `src/lib/d1.ts:8-11` draws the same line for the pipeline.

**Dead code, all of it verified by grep across `src` and `scripts`:**

- `src/lib/cycle.ts` — no importer. `cycleStamp`, `etagFor` and `matches` are
  unreferenced, so the stamp `sync-d1.ts:196-206` computes is currently written and
  never read. Groundwork for planned work, but it is untested dead code until the
  routes use it.
- `logEvent` (`src/lib/feed.ts:403-407`) — no caller. The `events` table and its
  index exist in both schemas (`src/lib/db.ts:113-121`, `scripts/d1-schema.ts:45-47`)
  for a feature that does not exist.
- `src/app/api/feed/route.ts` — no caller anywhere in `src` or `public`. It is a
  public endpoint that costs a 150-row query and a Worker invocation per hit
  (`feed.ts:220-225`) with no cache headers at all, unlike its `/api/section`
  sibling. Delete it or point `/` at it (*Improvement 8*).
- `getLocalSection` (`src/lib/sections.ts:46-48`) is a pure alias for `getLocalFeed`;
  the comment justifies it as a single definition of "local", but the indirection
  buys nothing a direct re-export would not.

**Things in the wrong place:**

- `CATEGORIES` lives in `src/lib/db.ts:157-160`, a Node-only module
  (`node:sqlite`, `node:fs`). It is imported by `src/app/actions.ts:6` and
  `src/app/profile/page.tsx:8`, i.e. by Worker code, purely for a string list, and
  by `src/lib/summarise.ts:62` for the LLM schema enum. It belongs in `taxonomy.ts`
  beside `TAXONOMY`.
- `storyCols` / `storyFrom` / `withPlaceLabels` are exported from `feed.ts:40-56` and
  consumed by `sections.ts:3` and `library.ts:2`. They are the shared row contract,
  not part of the ranked feed; a `rows.ts` (or `story.ts`) would stop `library.ts`
  importing the ranker to get a column list.
- `coverageOf` and the blindspot constants (`feed.ts:350-401`) are used by
  `getStory` only. They are presentation logic about bias ratings, sitting in the
  ranking module.

**Duplication worth noting:** `BLINDSPOT_MIN_OUTLETS` and
`MIN_OUTLETS_TO_CLAIM_SILENCE` (`feed.ts:365`, `feed.ts:374`) are both `5`, are both
documented as if distinct, and are used in the same two expressions
(`feed.ts:392`, `feed.ts:396-398`). One of them is redundant or the two should differ.

The schema duplication between `src/lib/db.ts:19-155` and `scripts/d1-schema.ts:15-65`
is intentional (different dialects, different lifetimes) but has already drifted —
see *Improvement 5*.

---

## Efficiency and speed

**D1 statements per render, counted from the code.** `/` is 2 (prefs, clusters) but
strictly sequential, because `getPrefs` must resolve before the candidate query and
`placesReady` gates both (`feed.ts:212-225`). `/profile` is 3+ (`profile/page.tsx:17`
parallelises prefs and stats; `getPlaces` is in-memory). `/reels` is 21
(*Improvement 3*). `/explore`'s landing view is 2 heavier ones — a `GROUP BY` over
the live window plus a `ROW_NUMBER() OVER (PARTITION BY category)` over the same rows
(`library.ts:45-57`) — and `getPlaceFacets` adds a third (`library.ts:69-74`). The
window function is the right call versus one lead query per category, and the comment
at `library.ts:50` says so.

**Rows read.** Each `/api/section` hit reads up to 200 rows (`sections.ts:22`,
`sections.ts:38`) to render 48 (`sections.ts:27`), because the sub-category counts
need the whole section. That is a defensible trade, and at 200 rows the 5M/day
read budget allows ~25k section requests. The unbounded `COUNT(*)`s in `getStats`
(*Improvement 4*) are the only query here whose cost is not bounded by a window.

**A sort the indexes cannot serve.** `sections.ts:38` orders by
`c.importance DESC, c.last_seen DESC`, but the partial indexes are
`(last_seen DESC)` and `(category, last_seen DESC)` (`d1-schema.ts:58-60`). Leading
with `importance` means the filtered set must be materialised and sorted rather than
walked in index order **(inferred from SQLite's planner; not measured)** — 200 rows
is small, so this is a minor cost, but it is the one query whose ordering does not
match the indexes that were added for it. A
`(category, importance DESC, last_seen DESC) WHERE headline IS NOT NULL` index would
serve `getTopicSection` directly.

**Cold start.** `src/lib/gazetteer.gen.ts` is 76KB of source, and `places.ts:42-51`
eagerly parses it into five structures at module load — `ALL`, `BY_ID`, `BY_ADMIN1`,
`BY_COUNTRY`, `BY_ALIAS`. Because `feed.ts:3` imports `places.ts`, and
`library.ts`/`sections.ts` import `feed.ts`, every route in the app pays this on
every new isolate, including `/saved`, which never asks a place question. It is still
the right trade against a D1 round trip per request, but the eagerness is not free:
building only `BY_ID` at load and the other four lazily on first use would move the
cost to the routes that actually need it.

**Bundle and render path.** `src/app/globals.css` is 95KB / 1867 lines, shipped as a
single render-blocking stylesheet to every route from `layout.tsx:7`. Sixteen client
components (`src/components/*`, `src/app/{error,global-error}.tsx`) is a restrained
count for an app this size, and the heavy ones are correctly scoped — `PlacePicker`
only loads on `/profile`, `ReelKeys` only on `/reels`. `jsdom`, `@mozilla/readability`
and `rss-parser` are pipeline-only dependencies reached solely from `ingest.ts`, so
they should not be in the Worker bundle; `@supabase/supabase-js` appears in
`package.json` dependencies and I found no import of it in `src` or `scripts` — if
that is right, it is dead weight in the install and possibly in the bundle
**(inferred: I did not inspect `.open-next` output)**.

**The render path that works well:** static shell → client `SectionFeed` →
`/api/section`, warmed on hover (`SectionFeed.tsx:43-45`), with a synchronous cache
peek that skips the skeleton entirely on a revisit (`SectionFeed.tsx:50`,
`SectionFeed.tsx:99-105`). That is genuinely the fastest category switch this stack
can produce on a free tier. The gap is that `/` does not use it (*Improvement 8*).

---

## Risks

**Correctness and data integrity**

1. **Shared mutable preferences with no write protection** (*Improvement 1*). The
   read-modify-write in `actions.ts:55-71` has no optimistic concurrency, so
   concurrent saves lose edits; and any visitor can reshape every other visitor's
   feed. This is the highest-severity item in the review.

2. **`INSERT OR REPLACE` is a delete-and-insert.** `sync-d1.ts:45` uses it for
   `clusters` and `articles`. Today the column lists at `sync-d1.ts:163-167` and
   `sync-d1.ts:180-182` are complete, so nothing is lost. The risk is structural: the
   day a column is added to `clusters` and not added to that list, every synced row
   silently reverts it to the default. `ON CONFLICT DO UPDATE` with named columns
   would fail loudly instead.

3. **D1 enforces neither of the foreign keys the local store does** (`db.ts:59-68`
   versus `d1-schema.ts:35-38`). `reap` compensates for the one path that was found
   to matter (`sync-d1.ts:102-108`); any future delete path has to remember the same
   discipline unaided.

4. **A partial sync leaves D1 internally inconsistent.** `sync-d1.ts:128-207` is a
   sequence of independent `run` calls with no transaction — D1's HTTP API cannot
   give one across statements. Clusters are pushed at `sync-d1.ts:163`, `reap` runs
   at `169`, articles at `180`, and the cycle stamp last at `202`. A failure between
   163 and 180 leaves clusters whose `article_count` describes articles D1 does not
   have, and the story page renders a headline with an empty "Summarised from" list
   (`story/[id]/page.tsx:79-85`). The stamp being written last is the right ordering
   and limits the blast radius to one cycle.

5. **`fromSqlite` (`d1.ts:82-94`) opens the pipeline's database read-write** via
   `db()` (`db.ts:12`), which also runs `migrate()` (`db.ts:15`). A `next dev` with
   `SMARTNEWS_LOCAL_D1=1` running alongside a `npm run cycle` means two writers on
   one SQLite file. WAL makes that mostly survivable, but the dev server can also
   apply migrations to the pipeline's store.

**Single points of failure**

6. **The GitHub Actions runner is the whole pipeline, and it is unmonitored**
   (*Improvement 13*). D1 is the only durable copy (`hydrate-d1.ts:14-16`); if a
   `sync` fails, the neurons spent that cycle are gone.

7. **The cron worker is the only clock** (`cron-worker/src/index.ts:29-32`), and
   `cycle.yml:9-10` has no `schedule:` fallback — deliberately, per
   `cycle.yml:7-8`, because GitHub drops `*/15` firings. So a broken Worker, an
   expired PAT or a revoked `Actions: write` scope silently stops the news, and the
   only place the failure is recorded is a `console.error` in Worker logs
   (`index.ts:23-25`).

8. **A single D1 database backs both the pipeline and the site.** An exhausted daily
   read limit takes the site down until midnight UTC — `d1.ts:72-81` names this
   explicitly and mitigates it only for local development. The site has no read-only
   fallback; every route would 500 through the empty-catch paths
   (`sections.ts:109-113` returns empty sections, which a reader reads as a quiet
   news day rather than an outage).

**Breaks under growth**

9. **Unbounded `articles` growth in D1** (*Improvement 11*), which compounds
   *Improvement 4*.

10. **Quadratic clustering** (*Improvement 12*) against a 15-minute wall clock.

11. **The 100k/day Worker request budget is spent by page views, not data**, because
    seven of eight routes are `force-dynamic` (*Improvement 8*) and the service
    worker is network-first for documents (`sw.js:85-96`, correctly, per the
    hashed-chunk reasoning at `sw.js:77-84`). Each navigation is at least one
    invocation plus its RSC payload. The static-shell pattern already in the repo is
    the answer; it is applied to 14 low-traffic routes and not to the home page.

12. **`idList` inlines values into SQL** (`feed.ts:63-65`, `library.ts:85`). The
    inputs are gazetteer ids resolved through `BY_ID` (`places.ts:186-197`), so an
    attacker-supplied `?place=` on `/explore` (`explore/page.tsx:25`) cannot reach
    the string — unknown ids are dropped, and the quoting at `feed.ts:64` doubles
    single quotes as a second layer. I consider this safe as written, and fragile by
    construction: the safety depends on a caller two modules away continuing to
    launder its input.
