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

Google AI Studio's free tier allows 5 requests/minute on `gemini-3.8-flash` and
20 on `gemini-2.5-flash`, so a large batch takes a while. `llm.ts` paces to
`LLM_RPM` and honours the retry delay the API returns; it does not fight the
quota. DeepSeek has no such cap and is the cheaper way to backfill in bulk.

With no key at all the pipeline falls back to quoting the longest single source
verbatim, so the app is runnable before you sign up for anything. That fallback
is a placeholder, not the product — it does exactly the source-framing thing
this app exists to avoid.

## Storage

`node:sqlite`, no service to run, database at `data/smartnews.db`. The schema in
`src/lib/db.ts` is plain SQL and ports to Postgres when this needs to leave one
machine. `events` is written from day one so personalisation has history to
learn from later.

## Not built yet

Reels, themes B and C, GPS-precise local news, left/centre/right coverage
breakdown, and the credibility signal. Designs for all of them are on the
canvas; `clusters` already carries the columns the first two need.
