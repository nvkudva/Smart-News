# Smart-News

A world-news reader that clusters the same story across many outlets and has a model write one neutral summary of it. For anyone who would rather read one corroborated account than six versions of the same wire copy.

The npm package and the deployed Worker are both named `smartnews`; the repo is `Smart-News`.

[Live site](https://smartnews.nvkudva.workers.dev) - [Model and provider notes](docs/MODELS.md)

## Requirements

- Node 22 or newer. The pipeline uses the built-in `node:sqlite` module; CI runs Node 26.
- A Cloudflare account with a D1 database. The web app never reads local SQLite — it reads D1, through the Workers binding on Workers and the D1 REST API everywhere else. `npm run dev` therefore needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_D1_ID`.
- One LLM key, for summaries: a Cloudflare API token (Workers AI), or a Gemini, DeepSeek or OpenAI key. Any OpenAI-compatible server — LM Studio, Ollama, vLLM, OpenRouter — works via `LLM_BASE_URL` and needs no hosted key.
- Ingest and clustering run without any key. Without one, summarisation falls back to quoting the longest single source verbatim.

## Run it

```bash
git clone https://github.com/nvkudva/Smart-News.git
cd Smart-News
npm install
cp .env.local.example .env.local    # fill in the variables below
npm run ingest                      # pull the RSS feeds, extract full text
npm run pipeline 60                 # cluster, then summarise the top 60 clusters
npm run dev                         # http://localhost:3000
```

`npm run ingest` prints a per-feed article count; `npm run dev` should serve a ranked feed of clustered stories at `http://localhost:3000`. `ingest` is safe to re-run — it skips URLs already stored — and `pipeline` only summarises clusters that are new or have grown 40%.

## Configuration

| Variable | Required | What it is |
|---|---|---|
| `LLM_PROVIDER` | No | `cloudflare` (the default when unset), `gemini`, `deepseek` or `openai`. The shipped `.env.local.example` sets `gemini`, so edit or delete that line to get the code default. |
| `LLM_API_KEY` | One key | Overrides the per-provider key below. |
| `CLOUDFLARE_API_TOKEN` | For `cloudflare` | Workers AI key, and the D1 REST credential. |
| `CLOUDFLARE_ACCOUNT_ID` | For `cloudflare` | Required by the Workers AI base URL and by the D1 REST client. |
| `CLOUDFLARE_D1_ID` | For `npm run dev` | D1 database id the site and the sync scripts read. |
| `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` | Per provider | Key for the chosen hosted provider. |
| `LLM_BASE_URL` | No | With `LLM_PROVIDER=openai`, any OpenAI-compatible endpoint. |
| `LLM_MODEL` | No | Model id. Each provider has a working default. |
| `LLM_RPM`, `LLM_CONCURRENCY` | No | Request pacing. Free tiers are strict. |
| `LLM_JSON_MODE` | No | `schema`, `object` or `text` — servers disagree on structured output. |
| `SUMMARISE_MIN_SOURCES` | No | Default 2. The cost dial: how many independent outlets a cluster needs before it is summarised. |
| `SMARTNEWS_DB` | No | Local SQLite path. Defaults to `data/smartnews.db`. |

## How it works

`scripts/ingest.ts` reads the feed list in `src/lib/sources.ts`, normalises URLs, and pulls full article text with jsdom and Readability — summaries come from the article, not the RSS blurb. `src/lib/cluster.ts` builds a TF-IDF vector per article (title weighted 3x) and does single-link agglomeration inside a 48-hour window. `src/lib/summarise.ts` takes up to six articles, one per source, and asks the model in `src/lib/llm.ts` for a headline, a short crux, a category, a place and an importance score. `src/lib/feed.ts` ranks on recency, corroboration, importance and stated interest, reserving every fourth slot for a story outside your chosen categories.

The pipeline and the site use different stores. The pipeline writes local SQLite because a cluster run issues thousands of statements; the site reads D1 through `src/lib/d1.ts`. `scripts/hydrate-d1.ts` pulls the working window down and `scripts/sync-d1.ts` pushes results back, which is why `.github/workflows/cycle.yml` can run `hydrate` → `cycle` → `sync` every 15 minutes on a runner with no persistent disk.

`deploy/install-schedule.sh` installs the same 15-minute cycle as a launchd agent. It is macOS only — on Linux, or anywhere else, use the GitHub Actions workflow instead. Do not run both against one D1: two concurrent cycles clobber each other's cluster assignments.

## Status

Ingest, clustering, summarisation, the D1 sync, the ranked feed, story pages and saved stories all work, and the scheduled Actions cycle runs against the live site.

Known gaps, from the code review in `REVIEW.md` (7 September 2026):

- **The deployed site has no authentication.** Every write is keyed `user_id = 'local'`, so any visitor overwrites the one shared preferences row and the one shared saved list.
- **Scraped article bodies are interpolated into the prompt unescaped.** A hostile page can steer the headline and summary the front page shows.
- `scripts/sync-d1.ts` `reap()` deletes D1 clusters missing from a freshly hydrated local file, guarded only by a 10% heuristic. A short hydrate can delete real rows irrecoverably.
- Nothing prunes D1 outside the 5-day window, so storage grows without limit.
- There are no tests and no lint config. `npm run build:check` is the only typecheck and no workflow runs it.
- Reels, theme variants, GPS-local news, the left/centre/right coverage breakdown and the credibility signal are not built. `sources.bias` is declared in the schema and read by nothing.

Provider cost and quality figures are in [docs/MODELS.md](docs/MODELS.md); treat any number there as a single measurement on one machine, not a guarantee.

## License

No licence file yet — all rights reserved.
