# Model options

Everything here is measured against this app's real workload, not vendor
marketing. The unit that matters is **one summary** = one cluster of up to six
articles turned into a headline, a 4–6 sentence crux, a category, a place and an
importance score.

**Measured cost of one summary: ~3,450 input tokens, 100–830 output.**
Averaged over the multi-source clusters actually summarised. An earlier figure
of 1,116 input tokens averaged over *all* clusters including single-source
singletons, which are never summarised under `SUMMARISE_MIN_SOURCES=2` — the
real prompts are three times bigger, and cost scales with them.

Two workload sizes, from 39 feeds:

| Workload | Summaries/day |
|---|---|
| `SUMMARISE_MIN_SOURCES=2` — stories at least two outlets ran | **~152** |
| Every cluster, singletons included | ~1,172 |

---

## The options, ranked by fit

| Option | Ceiling | Cost | Account? | Verdict |
|---|---|---|---|---|
| **Cloudflare Workers AI** | ~390/day free | free | **yes**, key in use | **Current default** |
| **LM Studio / Ollama, local** | ~360/hour, uncapped | free | installed | Best if the machine is on |
| **DeepSeek** | uncapped | ~$3.60/mo | **yes** | Fallback; no caps, no fuss |
| Groq (GroqCloud) | ~150/day | free | **yes** | Token cap bites before the request cap |
| OpenRouter `:free` | 50/day → 1,000/day | free / $10 once | **yes** | Fine after the one-time top-up |
| Google AI Studio | **20/day** | free | **yes**, key in use | Unusable — see below |

Accounts already held: **DeepSeek**, **OpenRouter**, **GroqCloud**, **Google AI
Studio**, plus LM Studio locally. Only DeepSeek and Gemini keys are in
`.env.local` today; OpenRouter and Groq need their keys adding before those rows
can be selected.

---

## Local — LM Studio, Ollama, llama.cpp

Free, uncapped, private, no key. Measured on an M3 Max:

| Model | Per cluster | Quality |
|---|---|---|
| `ornith-1.5-9b-mlx` | ~10s | Indistinguishable from DeepSeek here |
| `qwen3.8-27b` | ~35s | Marginally better place extraction, 4× slower |

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=ornith-1.5-9b-mlx
LLM_RPM=600
LLM_CONCURRENCY=2
LLM_JSON_MODE=schema
```

LM Studio needs `json_schema` and rejects `json_object`. It also rejects
`["string","null"]` union types, which is why nullable fields are emitted as
*optional* rather than nullable.

## Cloudflare Workers AI

10,000 neurons/day free, then $0.011 per 1,000 neurons. Neuron costs are
published per million tokens, so cost per summary is exact:

| Model | Neurons/summary | Free summaries/day |
|---|---|---|
| llama-3.2-1b | 6.3 | 1,583 |
| **qwen3-30b-a3b-fp8** | **11.1** | **898** |
| llama-3.2-3b | 11.1 | 898 |
| llama-3.1-8b-instruct-fp8-fast | 11.4 | 875 |
| mistral-7b-instruct | 14.5 | 687 |
| gpt-oss-20b | 25.6 | 390 |
| llama-3.3-70b-instruct-fp8-fast | 69.9 | 143 |
| qwen3.8-27b | 102.6 | 97 |

**`@cf/qwen/qwen3-30b-a3b-fp8` is the pick.** Measured on real clusters, neurons
read from the API's own `usage.neurons` rather than estimated:

| Model | Quality | in / out tokens | Neurons each | Free/day |
|---|---|---|---|---|
| **`@cf/qwen/qwen3-30b-a3b-fp8`** | 3/3, ~5s | 3520 / 834 | **41.7** | **239** |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | 3/3 | 3407 / 101 | 49.6 | 201 |
| `@cf/openai/gpt-oss-20b` | 3/3, ~6s | 3427 / 491 | 75.7 | 132 |

Against a ~152/day workload, only the first two fit inside the free tier.
gpt-oss-20b loses despite writing the fewest tokens of the three that reason,
because it charges **4x more per input token** (18,182 vs 4,625 neurons/M) and
these prompts are input-heavy — ~3,450 tokens of article text against ~500 of
output.

Two traps worth knowing:

- **Reasoning models need output headroom.** qwen3 spends most of its budget in
  `message.reasoning` before emitting any `content`. A probe with
  `max_tokens: 80` returns `finish_reason: "length"` and a null `content`,
  which looks exactly like a broken model. Use `LLM_MAX_TOKENS` to raise it.
- **Do not paste JSON Schema into the prompt.** In `json_object` mode a smaller
  model may echo the schema back — qwen returned
  `{"type":"object","properties":{…}}` on two runs in three. `llm.ts` now sends
  a filled-in example shape instead, which took qwen from 2/3 to 3/3.

```bash
LLM_PROVIDER=cloudflare          # account id and token are read from env
CLOUDFLARE_ACCOUNT_ID=<id>
CLOUDFLARE_API_TOKEN=<token>
LLM_MODEL=@cf/openai/gpt-oss-20b
LLM_RPM=100
```

Workers AI accepts `response_format` but does not enforce a schema, so the
provider defaults to `LLM_JSON_MODE=object`.

**Deploying the whole app to Workers is a port, not a config change.** Two
blockers: `node:sqlite` on a local file has no equivalent (it becomes D1 — same
SQL, different client), and jsdom + Readability need a real DOM that the Workers
runtime does not have (it becomes `HTMLRewriter`, or ingest stays on Node).
Pointing only `LLM_BASE_URL` at Workers AI needs neither.

## DeepSeek — fallback, key configured

No rate cap worth worrying about. Measured: **662 summaries in 16 minutes**, and
a steady-state cycle of 16 summaries in 63 seconds.

| Model | Input $/M | Output $/M |
|---|---|---|
| deepseek-v4-flash | $0.44 peak / $0.22 off-peak | $1.32 / $0.66 |
| deepseek-v4-pro | $1.32 / $0.66 | $3.96 / $1.98 |

Peak is only 01:00–04:00 and 06:00–10:00 UTC on weekdays; everything else is
half price. Cache hits are ~3% of the miss price, and the system prompt is a
stable prefix, so it caches.

At `MIN_SOURCES=2`: **~$3.60/month**. Everything: ~$17/month peak, ~$9 off-peak.

```bash
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-v4-flash
LLM_RPM=45
LLM_CONCURRENCY=8
LLM_JSON_MODE=object      # DeepSeek rejects json_schema
```

## Groq (GroqCloud) — account held, key not yet configured

30 RPM and 1,000 requests/day sound generous, but the binding limit is
**200,000 tokens/day**. At ~1,312 tokens per summary that is **~150/day** —
exactly the `MIN_SOURCES=2` workload with no headroom. Free models include
`openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`.

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=<groq-key>
LLM_MODEL=openai/gpt-oss-20b
LLM_RPM=25
```

## OpenRouter — account held, key not yet configured

`:free` model variants: 20 requests/minute, **50/day** — rising to **1,000/day**
once the account has ever purchased $10 of credit. The $10 is not consumed by
free models, so it is a one-time unlock rather than a running cost.

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<openrouter-key>
LLM_MODEL=meta-llama/llama-3.3-70b-instruct:free
LLM_RPM=18
```

## Google AI Studio — key configured, but not viable free

The free quota is `GenerateRequestsPerDayPerProjectPerModel` = **20 requests per
day, per model**. Not per minute. Against ~152/day this is unusable. Enabling
billing on the Cloud project lifts it, at which point Gemini Flash is priced
competitively — but the free tier is a dead end for this app.

```bash
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
LLM_RPM=15
```

---

## Why `LLM_JSON_MODE` exists

Structured output is where OpenAI-compatible servers actually differ:

| Server | Mode | Notes |
|---|---|---|
| LM Studio, OpenAI | `schema` | Rejects `json_object`; rejects union types |
| DeepSeek | `object` | Rejects `json_schema` |
| Most gateways | `object` | Safest default for unknown hosts |
| Anything older | `text` | No structured output; schema goes in the prompt |

## Recompute these numbers

The measured token profile is derived from the live database, so re-derive it
whenever the prompt or `MAX_CHARS_EACH` changes rather than trusting this file.
