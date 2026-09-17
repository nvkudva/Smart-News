# Cutting the summarisation bill without cutting the feed

Analysis only. Nothing here has been implemented, and the two questions it
answers are separable: **what a summary costs** and **how many summaries we
buy**. The second is the larger number and the one to fix first.

Cron has been stopped since 16 Sep 23:15 IST. `wrangler.jsonc` still declares
`*/30` for `smartnews-cycle-cron`, so any redeploy of that Worker silently
re-arms it — whatever is decided here, decide it before the next deploy.

---

## 1. The arithmetic that constrains everything else

| | |
|---|---|
| Free Workers AI allowance | 10,000 neurons/day (`scripts/usage.ts`, `FREE_DAILY`) |
| Measured spend, 16 Sep | 20,173 neurons — **2.0×** over |
| Measured cost per summary | ~17.8 neurons (`llm.ts`, llama-3.2-3b on real clusters) |
| Implied volume | ~1,130 summaries/day against an affordable ~560 |

Two levers multiply to that number: `cost per summary × summaries per day`. A
model swap moves the first by at most ~3× (§2) and volume moves the second by
whatever we choose (§3). Volume is the one that is currently unbounded, so it
is the one to bound.

### A discrepancy to resolve before optimising input

`summarise.ts` states that input is **84% of what a summary costs**, measured
over a day as 471,808 input tokens against 90,021 output — and the 1,800-char
`MAX_CHARS_EACH` trim exists because of it. But that is a ratio of *tokens*,
and Workers AI prices output ~6.6× input. Applying the published prices to
those same token counts:

- input: 0.472 M × $0.0509/M = **$0.024**
- output: 0.090 M × $0.335/M = **$0.030**

which makes output the larger half, not the smaller. One of the two readings is
wrong, and which one decides whether to trim prompts or trim responses.

**Settled, 17 Sep.** `usage.ts` cannot answer it — its
`aiInferenceAdaptiveGroups` query returns `sum { totalNeurons }` per model and
no token split. Measured instead over 15 real clusters on llama-3.2-3b:
**35,259 input tokens against 4,367 output**, so input is 89% of the *tokens* —
the comment's ratio is right. But at the published prices that is $0.00179 of
input against $0.00146 of output: a **55/45 cost split, not 84/16**.

So `MAX_CHARS_EACH` is a real lever and worth about half what `summarise.ts`
claims for it. Output is too large a share to ignore, and crux length is the
knob there. `tokenTally` in `llm.ts` now prints both counts per run, so this
stays measured rather than re-derived.

---

## 2. A cheaper model on Cloudflare

Live catalogue, queried from the account's own `/ai/models/search` on 17 Sep.
Prices are USD per million tokens; the ratio column is against the model we run
today.

| Model | in | out | in-ratio | ctx |
|---|---|---|---|---|
| `@cf/meta/llama-3.2-3b-instruct` **(current)** | 0.0509 | 0.335 | 1.00× | 80k |
| `@cf/ibm-granite/granite-4.0-h-micro` | **0.017** | **0.112** | **0.33×** | 131k |
| `@cf/meta/llama-3.2-1b-instruct` | 0.027 | 0.201 | 0.53× | 60k |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 0.0485 | 0.676 | 0.95× | 128k |
| `@cf/zai-org/glm-4.7-flash` | 0.0605 | 0.400 | 1.19× | 131k |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 0.0509 | 0.335 | 1.00× | 32k |

`granite-4.0-h-micro` is **~3× cheaper on both input and output**. At identical
volume that is 20,173 → ~6,700 neurons/day, which is inside the allowance on
its own. That is the single largest lever in this document and the cheapest to
test, because `LLM_MODEL` in `cycle.yml` is the whole change.

It is also the lever most likely to cost quality, and quality is what the
product is. `llama-3.2-3b` was chosen on a measured 4/4 against real clusters,
and `llama-3.2-1b` is small enough that the JSON-shape failures `summarise.ts`
already guards against (`whole()`, the field-presence check, the schema-echo
rescue) would plausibly go from rare to routine.

### Measured, 17 Sep — 15 real clusters, single-source and corroborated

| model | usable | failed | headlines > 70 chars | longest | mean |
|---|---|---|---|---|---|
| llama-3.2-3b **(current)** | 15 | 0 | 4 | 95 | 64 |
| granite-4.0-h-micro | 15 | 0 | **8** | 92 | 70 |
| llama-3.2-1b | 4 | **11** | 1 | 95 | 70 |

**`llama-3.2-1b` is out.** Eleven of fifteen produced nothing usable — three
returned unparseable JSON and the rest failed the field or crux-length checks
in `summariseCluster`. The 0.53× price is irrelevant at that failure rate.

**`granite-4.0-h-micro` overruns the headline limit at twice the current
rate** — 8 of 15 over 70 characters against llama's 4, and a mean of exactly
70. Hardening the prompt (`a hard maximum of 70 characters INCLUDING spaces -
count them and rewrite if you are over`) moved granite to 6 of 15 and made
llama *worse* at 5 of 15 with a 103-character outlier: inside the noise of a
15-cluster sample, and unsurprising, because a small model cannot count
characters. That change was reverted.

Nothing in the code enforces the limit — it is requested in `SYSTEM` and never
checked, which is why llama already overruns it 27% of the time unnoticed. So
the honest framing is that granite makes an existing, unenforced softness
worse, not that it breaks something that was working. **A code-side guard is
the prerequisite for adopting granite**, and it would improve today's output
too: reject over ~85 characters and spend one retry, or trim at the last word
boundary the way `whole()` trims the crux at the last sentence.

**The 3× saving is still the largest lever available.** Order: add the headline
guard, re-measure granite against it, then switch if quality holds.

**Remaining experiment spec, for the quality half:**

1. Pick 40 already-summarised clusters from `data/smartnews.db`: 20
   single-source, 20 with `source_count >= 3`, spread across categories.
2. Re-summarise each under `granite-4.0-h-micro` and `llama-3.2-1b-instruct`,
   `LLM_REASONING=off`, everything else unchanged.
3. Record per model: neurons spent, `reason: 'content'` rate, and the rate at
   which `whole()` had to truncate — those three are mechanical and need no
   judgement.
4. Score quality blind against the existing llama-3.2-3b summary on four
   binary tests, which is what "4/4" has always meant here: the headline names
   the event; the crux states who said what rather than asserting it; the
   category is right; nothing appears that no source states.
5. Ship the cheapest model that loses nothing on (4) and does not raise (3).

---

## 3. Volume, which is the actual problem

### Why it is unbounded

Measured over the three days to 16 Sep:

| cluster size | clusters | written |
|---|---|---|
| 1 source | 2,743 | 219 |
| 2 | 228 | 173 |
| 3 | 53 | 53 |
| 4+ | 70 | 69 |

Corroborated supply is **~117 clusters/day**. The run limit in `cycle.yml` is
150 *per run*, 48 runs a day — 7,200 slots against a corroborated queue that
can fill at most ~2% of them. `summarisePending` then does this:

```ts
if (targets.length < limit) targets.push(...worthWriting(d).slice(0, limit - targets.length));
```

Single-source work has no cap of its own; it takes every slot corroboration
leaves, which is nearly all of them. That is the mechanism behind the shape
measured on 16 Sep — ingest doubles across the day with the news cycle, but
summarised-per-ingested *triples*, 0.16–0.27 in the morning to 0.41–0.70 after
20:00. The second curve is ours.

### The backlog is mostly already dead

4,648 un-summarised single-source clusters sit in the store, but `worthWriting`
filters on `a.published_at >= now - 6h` and `LENGTH(body) > 800`. Against the
snapshot's own clock only **501** of those 4,648 can ever be selected; the other
4,147 aged out and are unreachable by construction.

So "cut the single-source backlog" is not work. Either leave them (they cost
nothing) or delete them in one statement for store size. What needs fixing is
the **rate**, not the pile.

### Proposal, in order

**3a. Cap single-source summarisation separately.** One env var —
`SUMMARISE_SINGLE_MAX` — applied to the `worthWriting` slice. This makes the
daily bill predictable *independently of what the quality gate turns out to
be*, which is why it goes first. At 10/run it is 480/day; at 4/run, 192/day.
Set it from the allowance and the measured cost per summary, not from taste.

It also dissolves the objection recorded in `worthWriting`'s own comment. Heat
"orders the queue but does not guard it" was the right call when nothing else
bounded the work; with a cap, ordering *is* gating — the cap refuses the tail
and heat decides which tail.

**3b. Then a real gate**, within the cap, to decide *which* stories get the
slots. See §4.

---

## 4. Better sources in, less rubbish through

### 4a. More title-tier front pages — the one signal that costs nothing

`Tier = 'title'` feeds are read for headlines only: never fetched for body
text, never passed through Readability, never gated by robots.txt, never
counted in `source_count` or the bias split. They cost one RSS poll and zero
neurons, and they carry the single most defensible quality signal available —
*an important newsroom chose to lead with this*.

Today there are **5** of them (BBC, NYT, CNN, The Hindu, Economic Times),
supplying 182 title-only articles, and only 2 of the last 132 summarised
clusters contained one. The signal is real and simply too sparse to reach
anything.

**Proposal: take it to 25–30 front pages.** Because these skip robots.txt and
Readability entirely, outlets that are otherwise unusable become available —
Reuters, AP, WSJ, FT, Le Monde, Asahi, and the Indian dailies that refuse
automated retrieval. Once prominence is dense enough to fire, it becomes the
gate in §3b: a single-source cluster whose entities match a front-page headline
earns a slot ahead of one that matches nothing.

This is also the answer to the scoop problem. Source reputation — the obvious
quality proxy — structurally punishes the outlet that got there first, which is
exactly backwards for a product about corroboration. Front-page prominence does
not: it measures what editors thought was important today, not who is
respectable.

### 4b. What the current three signals do and do not do

`worthWriting` applies a title-shape blacklist, entity heat and an
800-character body floor. Measured over three days those are ordering the queue,
not shrinking it — 219 single-source stories were written and the volume problem
persisted. Per-source, the single-source output concentrates in a handful of
outlets:

| outlet | articles (3d) | single-source stories written |
|---|---|---|
| The Economic Times | 153 | 34 |
| The Indian Express | 419 | 32 |
| Variety | 136 | 30 |
| CNA | 180 | 24 |
| ABC News (AU) | 158 | 19 |
| Times of India | 337 | 18 |
| Phys.org | 132 | 17 |
| ESPN | 87 | 13 |

Variety at 30 and ESPN at 13 are the shape to look at: high-volume verticals
where nothing is corroborated because nothing else covers that beat, which is
precisely the case `worthWriting` was built to serve and also precisely where
the spend is least defensible. A **per-source or per-category share of the cap**
is a cheaper fix than a cleverer gate, and it needs no new signal.

### 4c. Cheaper filtering before the model, not after

Everything in `worthWriting` is a string test or a map lookup by design —
choosing must not cost what writing costs. Two additions keep that property:

- **Prominence match** (§4a) — a set lookup against front-page entities.
- **Novelty against what is already written.** A cluster whose entities are
  wholly contained in a story summarised in the last 24 hours is very likely
  the same story arriving under a different headline. This is a set operation
  over data already in the store.

Neither needs an LLM, and both shrink the queue rather than reorder it.

---

## 5. Free and cheaper models off Cloudflare

**No code change is needed for any of these.** `llm.ts` already supports
`LLM_PROVIDER=openai` against any OpenAI-compatible endpoint via
`LLM_BASE_URL`, with `LLM_JSON_MODE` to match what the gateway enforces.
OpenRouter, Together, vLLM and LM Studio are all this path. Gemini is a
first-class provider already, defaulted to `rpm: 8`.

OpenRouter currently lists **24 zero-priced models**, several with very large
context windows. Three things decide whether any of them is usable here, and
none of them is the price:

1. **Requests per minute against a 12-minute job.** `cycle.yml` sets
   `timeout-minutes: 12`. At the free tiers' typical pacing, a run of even 40
   summaries may not finish. `LLM_RPM` and `LLM_CONCURRENCY` are the knobs; the
   timeout is the constraint.
2. **Daily request caps.** A free tier that allows 50 requests/day cannot serve
   a pipeline that wants 500, whatever its RPM.
3. **Data-retention terms.** Free tiers are usually free because prompts train
   the provider. That is a product decision about other people's journalism,
   not an engineering one.

**Recommendation:** treat this as the fallback, not the plan. Cloudflare with
`granite-4.0-h-micro` (§2) plus a single-source cap (§3a) very likely lands
inside the free allowance with no new dependency, no new failure mode and no
retention question. Reach for OpenRouter only if those two together still
overshoot.

### The laptop path is blocked elsewhere

Summarising locally at zero neuron cost (Ollama/LM Studio via
`LLM_PROVIDER=openai`) works today for a developer, but the result cannot be
handed to the runner: the working store lives in the Actions cache, which has
no public write API, so a locally-summarised store must go through D1 and be
hydrated back. That is the constraint TODO item 15's R2 proposal exists to
remove. Local summarisation becomes practical *after* R2, not before.

---

## 6. Suggested order

1. **Settle the input/output cost split** (§1). One day of `usage.ts` against
   token tallies. Everything about prompt size depends on it.
2. **Cap single-source summarisation** (§3a). Bounded, predictable cost, and it
   is what lets cron restart safely.
3. **Restart cron** with the cap in place, and watch one full day.
4. **Run the model experiment** (§2). If `granite-4.0-h-micro` holds quality,
   it is a 3× cut for a one-line change.
5. **Widen title-tier to 25–30 front pages** (§4a). No neuron cost, and it is
   the prerequisite for prominence being usable as a gate.
6. **Make prominence the gate within the cap** (§3b/§4a), with per-source share
   limits (§4b) as the cheaper interim.
7. Revisit OpenRouter (§5) only if 2+4 do not close the gap.

Knobs in cost order, unchanged from the TODO: the `150` in `cycle.yml`; the
six-hour freshness window in `worthWriting`; then a genuine gate.
