# smartnews

World news, clustered from many sources and summarised into one neutral paragraph.

## Run it

```bash
npm install
cp .env.local.example .env.local   # add a model key
npm run ingest                     # pull ~39 RSS feeds, extract full text
npm run pipeline 60                # cluster, then summarise the top 60 clusters
npm run dev                        # http://localhost:3000
```

`ingest` is safe to re-run: it skips URLs already stored. `pipeline` only
summarises clusters that are new, or that have grown 40% since last time.

## How a story is made

1. **Ingest** — `scripts/ingest.ts` reads the feeds in `src/lib/sources.ts`,
   normalises URLs (strips `utm_*` and friends), and pulls the full article text
   with Readability. Summaries come from that text, not from the RSS one-liner.
2. **Cluster** — `src/lib/cluster.ts` builds a TF-IDF vector per article
   (headline weighted 3×, body excluded — it is mostly boilerplate) and does
   single-link agglomeration inside a 48-hour window. Similarity threshold
   `0.19`, tuned against real feeds: `0.16` merged a liquor-poisoning story into
   a building collapse, `0.30` split one German election across six clusters.
3. **Summarise** — `src/lib/summarise.ts` picks up to six articles, one per
   source, longest first, and asks the model for a headline, a 4–6 sentence
   crux, a category, a place and an importance score. The prompt requires
   attribution ("the health ministry says") rather than assertion.
4. **Rank** — `src/lib/feed.ts` scores on recency × corroboration × importance ×
   interest, and reserves every fourth slot for a story *outside* the user's
   stated categories. That exploration budget is the point, not a garnish.

## Choosing a model

Set these in `.env.local`. Any OpenAI-compatible server works — OpenRouter,
Together, vLLM, Ollama, LM Studio — by pointing `LLM_BASE_URL` at it.

| Variable       | Meaning                                                    |
|----------------|------------------------------------------------------------|
| `LLM_PROVIDER` | `gemini` (default), `deepseek`, or `openai`                |
| `LLM_MODEL`    | Model id; each provider has a working default              |
| `LLM_BASE_URL` | With `provider=openai`, any OpenAI-compatible endpoint     |
| `LLM_API_KEY`  | Overrides `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` |
| `LLM_RPM`      | Requests per minute to pace at — free tiers are strict     |
| `LLM_JSON_MODE`| `schema` (default) · `object` (DeepSeek) · `text`          |
| `LLM_CONCURRENCY` | In-flight requests; pacing still applies               |

### Running it for nothing, locally

LM Studio (or any OpenAI-compatible local server) needs no key and has no caps:

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=ornith-1.5-9b-mlx
LLM_RPM=600
LLM_CONCURRENCY=2
```

Measured on an M3 Max: a 9B does a cluster in ~10s, a 27B in ~35s, and both
write summaries indistinguishable from DeepSeek's for this task. A full cycle
summarised 12 clusters with zero failures. Nothing about reading six short
articles and writing five sentences needs a frontier model.

`LLM_JSON_MODE` exists because structured output is where these servers differ:
LM Studio and OpenAI want `json_schema` and reject `["string","null"]` union
types, DeepSeek wants `json_object`, and `text` is the escape hatch for servers
with neither.

### Hosted free tiers

**DeepSeek is the default, and Gemini's free tier is not usable here.** AI
Studio's free quota is `GenerateRequestsPerDayPerProjectPerModel` = **20
requests per day**, not per minute — against the ~150/day this feed needs. Use
Gemini only with billing enabled on the Google Cloud project.

Measured on DeepSeek `v4-flash`: 662 summaries in 16 minutes for about $0.55,
and a steady-state cycle of ~16 summaries in 63 seconds. `llm.ts` paces to
`LLM_RPM` and honours whatever retry delay the API returns rather than fighting
the quota.

With no key at all the pipeline falls back to quoting the longest single source
verbatim, so the app is runnable before you sign up for anything. That fallback
is a placeholder, not the product — it does exactly the source-framing thing
this app exists to avoid.

## Running it on a schedule

`npm run cycle` is one pass: ingest, re-cluster, summarise what changed. It
takes about a minute.

```bash
sh deploy/install-schedule.sh    # launchd agent, every 15 minutes
```

Fifteen minutes, not five: the feeds produce ~31 articles/hour, so a 5-minute
cycle mostly fetches nothing while hitting 39 publishers 288 times a day each.

`SUMMARISE_MIN_SOURCES` (default 2) is the cost dial. Every cluster is ~1,170
summaries/day; two-or-more independent sources is ~150/day, roughly $3.60/month
on DeepSeek — and it is the better feed, since a story only one outlet ran is
what a corroboration-ranked product should be sceptical of anyway.

A cluster that fails three times is given up on, so a story the model always
chokes on cannot be retried forever at cost.

## Deployed

**https://smartnews.nvkudva.workers.dev** — Cloudflare Workers via
`@opennextjs/cloudflare`, reading a D1 database.

The split matters: the **site** is hosted and always up, but the **pipeline
that fetches news runs on a Mac**. Full-text extraction uses jsdom and
Readability, which need a real DOM that the Workers runtime does not have, and
dropping to RSS excerpts would make every summary thinner. So:

```bash
npm run cycle     # on the Mac: fetch, cluster, summarise into local SQLite
npm run sync      # push finished rows up to D1
npm run deploy    # only when the code changes
```

While the Mac is asleep the site stays up and fully browsable — it just stops
gaining new stories until the next cycle runs. Moving ingest somewhere always-on
(a small VM, a scheduled CI job) removes that, and needs a home for the working
database, which is the only reason it is not done here.

`sync` sends articles without their bodies. Bodies exist to be fed to the model;
the site only ever shows a title, a link and an outlet name.

## Storage

Two stores, deliberately. The pipeline works against **`node:sqlite`** at
`data/smartnews.db` — a cluster run issues thousands of statements, and over
HTTP each would be a round trip. The site reads **D1** through `src/lib/d1.ts`,
which uses the Workers binding when it really is on Workers and the D1 REST API
otherwise, so `next dev` reads exactly the rows production does. `events` is written from day one so personalisation has history to
learn from later.

## Not built yet

Reels, themes B and C, GPS-precise local news, left/centre/right coverage
breakdown, and the credibility signal. Designs for all of them are on the
canvas; `clusters` already carries the columns the first two need.
