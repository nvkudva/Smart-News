# Code review — Smart-News

An RSS ingest → TF-IDF clustering → LLM summarisation pipeline (Node + `node:sqlite`) that publishes into Cloudflare D1, read by a Next.js 16 app deployed to Workers via `@opennextjs/cloudflare`.

Read in full: `package.json`, `wrangler.jsonc`, all of `src/lib/`, all of `src/app/` routes and actions, all of `scripts/`, `.github/workflows/cycle.yml`, `deploy/`, `README.md`, `docs/MODELS.md`. Not read: `src/app/globals.css` (577 lines), `src/components/icons.tsx`, `Logo.tsx`, `TabBar.tsx`, `ExplorationDot.tsx`, `loading.tsx` files, `package-lock.json`.

## Architecture

Two stores, deliberately split, and the split is the load-bearing decision in the repo.

The **pipeline** is Node-only and writes local SQLite. `src/lib/ingest.ts:76` fans out over 39 feeds at concurrency 8, inserts articles, then re-fetches each new URL and runs jsdom + Readability (`ingest.ts:43`) at concurrency 6. `src/lib/cluster.ts:19` reads the 48-hour window, builds tf-idf vectors from `title×3 + lead` (`cluster.ts:31`), and does single-link agglomeration against every member of every existing group (`cluster.ts:41-54`). `src/lib/summarise.ts:98` picks clusters with `source_count >= 2` that are new or have grown 40%, and calls `src/lib/llm.ts:271`.

The **site** never touches SQLite. `src/lib/d1.ts:74` picks a Workers `DB` binding when `navigator.userAgent === 'Cloudflare-Workers'` and otherwise falls back to the D1 REST API, so `next dev` reads production rows. `src/lib/feed.ts` and `src/lib/library.ts` are the only query layer; every page is `force-dynamic`.

The two are joined by `scripts/hydrate-d1.ts` (pull 5-day window down, delete and rebuild the local file) and `scripts/sync-d1.ts` (push what this cycle touched back up). `.github/workflows/cycle.yml` runs hydrate → cycle → sync every 15 minutes on a runner with no persistent disk, so D1 is the only durable copy of the working set.

What the structure gets right: `d1.ts` exposing one three-method interface over both backends means dev and prod exercise the same SQL. `llm.ts` isolates every provider quirk behind `completeJson`, and its `LlmOutcome` distinguishes "the model gave a bad answer" from "the call never landed" (`llm.ts:267`), which `summarise.ts:159` uses to avoid burning a cluster's retry budget on a network blip. That distinction is the kind of thing usually learned the hard way and it is encoded correctly here.

Where it will hurt:

- **The schema is written three times and has already drifted.** `src/lib/db.ts:20` is authoritative for local, `scripts/sync-d1.ts:18` re-declares it for D1, and `scripts/hydrate-d1.ts` hardcodes column lists a fourth time. The D1 copy has no `UNIQUE` on `articles.url`, no foreign keys, and no `articles_hash` index. Adding a column means editing four places, and forgetting one is silent.
- **`sync-d1.ts:63` `push()` builds `INSERT OR REPLACE` from a column list, so any column omitted from that list is nulled on every sync.** `sources` is pushed without `bias` (`sync-d1.ts:140`) while `hydrate-d1.ts:56` pulls it — the column can never hold a value.
- **There is no user model.** `userId = 'local'` is a default parameter on every function in `feed.ts` and `library.ts` and no caller ever passes anything else. Adding real users means touching every query, both server actions, and the `prefs`/`saved`/`events` primary keys.
- **`cluster.ts:41` is all-pairs against every member of every group.** Documented as fine at ~2k articles; it is quadratic in articles and linear again in cluster size, so it degrades sharply if the source list or the window grows.
- `src/app/story/[id]/page.tsx:25` does presentation logic (splitting `crux` into paragraphs) inline in the page; fine now, but it is the only place that knows the crux is prose.

## Code quality

Error handling is unusually deliberate in `llm.ts` — `classify` (`llm.ts:109`) maps status codes and `TypeError`/`AbortError` to distinct outcomes, `backoffMs` (`llm.ts:124`) reads the provider's own retry hint, and an auth failure aborts the whole run rather than spending every cluster's budget (`summarise.ts:176`). `summarise.ts:68` validates that a parsed JSON object actually has usable fields before writing it, which is the failure smaller models actually produce. This is good and needs no change.

Gaps:

- `src/lib/d1.ts:51` never checks `res.ok`. A 500 with an HTML body throws a JSON parse error rather than an HTTP error, and when `success` is false with no `errors` array the message is literally `D1: undefined`.
- `src/lib/feed.ts:24` `JSON.parse(row.categories ?? '[]')` is unguarded; one malformed `prefs` row takes down every page.
- `src/lib/llm.ts:110` dereferences `err` without a null guard inside the catch — a thrown `undefined` becomes a `TypeError` inside the error handler.
- `src/lib/llm.ts:94` `nextSlot` is module-global, so RPM pacing holds within one process only. Correct for the scripts, wrong the moment summarisation runs inside a Worker.
- **No tests of any kind.** No test runner in `package.json`, no test files. `text.ts` (tokenise, idf, cosine, `normaliseUrl`) and `feed.ts:39` `score` are pure functions with tuned constants and are exactly what a regression test should pin.
- **No lint config and no typecheck in CI.** `build:check` exists in `package.json:10` but `.github/workflows/cycle.yml:33` never runs it, and no workflow builds or deploys the site.
- Dead code: `logEvent` (`src/lib/feed.ts:108`) is exported and never called, so the `events` table README claims is "written from day one" is empty. `sources.bias` is declared in three schemas and read by nothing.
- Duplication: `scripts/pipeline.ts` is `scripts/cycle.ts` minus the ingest call and the `.t0` stamp.
- Secrets handling is correct — `.env*` is gitignored with an explicit `!.env.local.example` exception, keys are read from env only, and the D1 id in `wrangler.jsonc` is inert without a token (reasoned about at `cycle.yml:24`).
- Dependency hygiene is good: nine runtime deps, all load-bearing, `allowScripts` pinned per package.
- **Documentation contradicts the code and itself.** `README.md:43` says the default provider is `gemini`, `README.md:76` says "DeepSeek is the default", `src/lib/llm.ts:58` defaults to `cloudflare`, and `.env.local.example:5` says `gemini` and does not mention the `cloudflare` provider at all. Only `docs/MODELS.md` matches the code. Separately `README.md:115` says "the pipeline that fetches news runs on a Mac" three lines before saying it runs on GitHub Actions. `CLAUDE.md:1` imports `@AGENTS.md`, which does not exist.

## Risks

- **No authentication on a publicly deployed site.** `smartnews.nvkudva.workers.dev` serves `savePrefsAction` (`src/app/actions.ts:14`) and `toggleSavedAction` (`actions.ts:8`), both of which write rows keyed `user_id = 'local'`. Any visitor rewrites the single shared preference row and the single shared saved list for everyone.
- **Prompt injection from ingested content.** `src/lib/summarise.ts:52` interpolates scraped article bodies into a pseudo-XML `<article>` wrapper with no escaping and no delimiter check. A page containing `</article>` followed by instructions can steer the headline, `crux`, `importance` and `country` that the ranker and the front page then use. This is the highest-value attack surface in the repo: the input is arbitrary third-party HTML by design.
- **`reap()` can permanently delete good rows.** `scripts/sync-d1.ts:91` deletes every D1 cluster absent from the freshly hydrated local file. The local file is scratch built by a paged `hydrate` (`hydrate-d1.ts:26`); if that pull is short for any reason the deletion is unrecoverable, and the only guard is a 10% heuristic (`sync-d1.ts:100`).
- **Saved stories can be silently destroyed.** `saved` rows reference `cluster_id` with no foreign key in D1. `cluster.ts:95` deletes merged-away clusters locally and `reap` propagates that to D1, orphaning saved rows — while `src/app/saved/page.tsx:22` promises "Saved stories stay here".
- **Unbounded D1 growth.** Nothing prunes articles or clusters outside the 5-day window; `sync` only ever inserts. Article bodies up to 8,000 chars (`ingest.ts:54`) are pushed for rows the site never displays.
- **Unmetered read path.** `src/app/api/feed/route.ts` is public, `force-dynamic`, and every call runs a 400-row D1 read plus in-process ranking (`feed.ts:56`). No cache, no rate limit.
- Remote image URLs from feeds render directly (`StoryCard.tsx:45`, `story/[id]/page.tsx:51`) with `images.unoptimized` and no CSP, so every publisher's CDN gets a per-view beacon on your readers.

## Action items

| Priority | Item | File | Why |
|---|---|---|---|
| P0 | Gate the write actions behind a session, or make prefs/saved per-browser | `src/app/actions.ts:8` | Any visitor to the public deploy overwrites the one shared user's prefs and saved list |
| P0 | Filter `headline IS NOT NULL` in `getStory`, or handle a null `crux` | `src/lib/feed.ts:93` | `story/[id]/page.tsx:25` calls `cluster.crux.split` — an unsummarised cluster id 500s instead of 404ing |
| P0 | Reconcile the default-provider claim across docs and code | `README.md:43` | README says `gemini` in one place and `deepseek` in another; the code defaults to `cloudflare` |
| P1 | Escape or fence scraped bodies before they enter the prompt | `src/lib/summarise.ts:52` | Third-party HTML can close the `<article>` tag and issue instructions that reach the front page |
| P1 | Make one schema definition authoritative and generate the D1 one from it | `scripts/sync-d1.ts:18` | D1 lacks `articles.url UNIQUE`, the FKs, and `articles_hash`; four column lists must be edited in lockstep |
| P1 | Add `bias` to the `sources` push column list | `scripts/sync-d1.ts:140` | `INSERT OR REPLACE` nulls the column on every sync, so it can never hold data |
| P1 | Make `reap` refuse to delete unless hydrate reported a complete pull | `scripts/sync-d1.ts:100` | A short hydrate silently permanently deletes real clusters from the only durable store |
| P1 | Delete or re-point `saved` rows when a cluster is reaped | `src/lib/library.ts:26` | Saved stories vanish, contradicting the promise in `saved/page.tsx:22` |
| P1 | Add a retention pass that prunes D1 rows outside the window | `scripts/sync-d1.ts:131` | Nothing ever deletes old articles or bodies; storage grows without limit |
| P1 | Check `res.ok` and surface the status text in the D1 HTTP client | `src/lib/d1.ts:51` | A 5xx HTML body surfaces as a JSON parse error; empty `errors` yields `D1: undefined` |
| P1 | Wrap the `prefs` JSON parse in a try/catch with a fallback | `src/lib/feed.ts:24` | One malformed row breaks every page, since `getPrefs` is on the critical path of the feed |
| P1 | Run `npm run build:check` as a CI step | `.github/workflows/cycle.yml:33` | The only typecheck in the repo is never executed; nothing builds the site in CI either |
| P1 | Add unit tests for `text.ts` and `feed.ts` `score` | `src/lib/text.ts:3` | Tuned constants (threshold 0.19, half-life 9h, entity floor 0.52) have no regression guard |
| P1 | Rate-limit or cache `/api/feed` | `src/app/api/feed/route.ts:6` | Public, uncached, 400-row D1 read plus ranking per request |
| P2 | Remove `logEvent` or start calling it | `src/lib/feed.ts:108` | Exported, never invoked; README claims `events` is populated and it is empty |
| P2 | Drop `scripts/pipeline.ts` or make it call `cycle` with a flag | `scripts/pipeline.ts:8` | Duplicates `cycle.ts` minus ingest; two files drift on the same reporting logic |
| P2 | Guard the `err` dereference in `classify` | `src/lib/llm.ts:110` | A thrown `undefined` raises a second `TypeError` inside the error handler |
| P2 | Index by entity before the all-pairs similarity scan | `src/lib/cluster.ts:41` | Cost is quadratic in articles and linear again in cluster size |
| P2 | Fix the "runs on a Mac" paragraph and the missing `AGENTS.md` | `README.md:115` | The paragraph contradicts the next one; `CLAUDE.md:1` imports a file that is not in the repo |
| P2 | Decide whether launchd deployment is still supported | `deploy/install-schedule.sh:2` | It installs a 15-minute local cycle that would race the GitHub Actions cycle over one D1 |
| P2 | Remove or use `sources.bias` | `src/lib/db.ts:28` | Declared in three schemas, read by nothing; the story page advertises the feature as "v2" |
