# Architecture

Smart News has two runtimes and one durable store. A GitHub Actions job is the
only writer of news; a Cloudflare Worker serves the site and is the only writer
of reader state. Cloudflare D1 sits between them.

```mermaid
---
config:
  theme: base
  themeVariables:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 14px
    lineColor: '#8a8f98'
    primaryTextColor: '#1b1f23'
    edgeLabelBackground: '#ffffff'
    nodeSpacing: 150
    rankSpacing: 80
  layout: fixed
---
flowchart LR
 subgraph IN["Sources & scheduling"]
        RSS("38 RSS feeds")
        W("Worker cron<br>every 15 min")
  end
 subgraph CI["GitHub Actions runner · ephemeral"]
        S("sync")
        C("cycle")
        H("hydrate")
        L[("local SQLite<br>scratch")]
  end
 subgraph CF["Cloudflare"]
        D[("D1 · durable")]
        AI("Workers AI")
        A("Next.js on Workers")
  end
    H --> C
    C --> S & AI
    C -.- L
    W -- dispatch --> H
    RSS --> C
    D -- pull window --> H
    S -- push changes --> D
    D --> A
    A --> U("Reader")

     RSS:::ext
     W:::cloud
     S:::runner
     C:::runner
     H:::runner
     L:::scratch
     D:::store
     AI:::cloud
     A:::cloud
     U:::ext
    classDef ext fill:#eceff1,stroke:#78909c,color:#263238
    classDef runner fill:#fdf0d5,stroke:#b8860b,color:#3d2c00
    classDef cloud fill:#e3f0fb,stroke:#2c6fad,color:#10314d
    classDef store fill:#e4f3e7,stroke:#3f8f52,stroke-width:1.5px,color:#14361f
    classDef scratch fill:#f4f4f5,stroke:#b0b4ba,color:#3f4145,stroke-dasharray:3 3
    style IN fill:#fafafa,stroke:#c8ccd1,color:#263238
    style CI fill:#fffdf6,stroke:#e3cf9a,color:#3d2c00
    style CF fill:#f7fbff,stroke:#bcd7ee,color:#10314d
```

## Why the pipeline is not in the Worker

Clustering issues thousands of statements per run. Over HTTP each one is a
round trip, and free-tier Workers give ~10ms CPU per invocation. So the
pipeline runs against local `node:sqlite` on a runner that has real CPU and a
real file, and D1 holds the result. The runner keeps nothing between runs —
hence hydrate at the start and push at the end.

## Why the clock is a Worker

GitHub queues a `*/15` schedule and drops most firings when its shared pool is
busy: runs were landing every two to four hours at unaligned times. The Worker
holds the clock and calls `workflow_dispatch`, which GitHub honours. The
workflow has no `schedule` trigger at all.

```mermaid
sequenceDiagram
  autonumber
  participant W as Worker cron
  participant G as GitHub Actions
  participant D as D1
  W->>G: workflow_dispatch (ref main)
  G->>D: hydrate — pull 5-day window
  G->>G: cycle — ingest, cluster, summarise
  G->>D: sync — push what changed
  Note over G: concurrency group news-cycle<br/>queues, never clobbers
```

## One cycle

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'ui-sans-serif, system-ui, sans-serif','fontSize':'14px','lineColor':'#8a8f98','primaryTextColor':'#1b1f23','edgeLabelBackground':'#ffffff'}}}%%
flowchart TB
  F[38 feeds]:::ext --> I[ingest<br/>newer than 72h]:::runner
  I --> R[Readability + jsdom<br/>full text where reachable]:::runner
  R --> AR[(articles)]:::store
  AR --> CL[clusterRecent<br/>48h window]:::runner
  CL --> G[greedy agglomeration<br/>cosine ≥ 0.19 · entities ≥ 0.52]:::runner
  G --> CS[(clusters)]:::store
  CS --> SU{≥ 2 sources<br/>and changed?}:::gate
  SU -->|no| SK[skip]:::scratch
  SU -->|yes| LLM[llama-3.2-3b · Workers AI<br/>≤ 6 articles · 2600 chars each<br/>≤ 40 clusters per cycle]:::cloud
  LLM --> OUT[headline · crux · framing by lean]:::runner
  LLM -.->|3 attempts, still failing| GIVE[left unsummarised]:::gate
  OUT --> CS

  classDef ext fill:#eceff1,stroke:#78909c,color:#263238
  classDef runner fill:#fdf0d5,stroke:#b8860b,color:#3d2c00
  classDef cloud fill:#e3f0fb,stroke:#2c6fad,color:#10314d
  classDef store fill:#e4f3e7,stroke:#3f8f52,stroke-width:1.5px,color:#14361f
  classDef gate fill:#fbe6e6,stroke:#b5504f,color:#4a1414
  classDef scratch fill:#f4f4f5,stroke:#b0b4ba,color:#3f4145,stroke-dasharray:3 3
```

The extractive placeholder in `summarise.ts` is *not* a failure fallback: it
runs only when no LLM provider is configured at all, so the app is usable
before anyone signs up for a key. It quotes one source verbatim, which is
exactly what the product exists not to do — and never runs in production,
where the workflow always sets `LLM_PROVIDER`.

Clustering is order-dependent and re-runs from scratch each cycle over the
48-hour window: an article joins the nearest centroid above threshold, or
starts its own cluster. Two clusters that merge leave the loser's id behind in
D1 — see reaping below.

## Windows

Three different horizons, widest first, and they must stay ordered.

| Stage | Window | Why |
|---|---|---|
| hydrate / sync | 5 days | must be wider than clustering, or a cluster loses its own articles |
| ingest | 72 hours | feed items older than this are dropped on arrival |
| cluster | 48 hours | what a run actually re-groups |

## Sync mechanism

The expensive direction is the push, because D1 bills row writes and
`INSERT OR REPLACE` bills whether or not the value moved. Three mechanisms
keep it small.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'ui-sans-serif, system-ui, sans-serif','fontSize':'14px','lineColor':'#8a8f98','primaryTextColor':'#1b1f23','edgeLabelBackground':'#ffffff'}}}%%
flowchart TB
  T{.t0 stamp present?}:::gate
  T -->|no — cycle died, or SYNC_FULL=1| FULL[push the whole 5-day window]:::scratch
  T -->|yes| INC[push only what this cycle touched]:::runner

  INC --> SEED{seed fingerprint<br/>changed?}:::gate
  SEED -->|no| SKIP[skip · 0 writes]:::store
  SEED -->|yes| PUSHSEED[push whole table<br/>store hash in sync_meta]:::runner

  INC --> TOUCH[clusters — re-summarised,<br/>last_seen moved, or gained<br/>an article fetched this run]:::runner
  TOUCH --> ART[articles — fetched this run,<br/>or inside a touched cluster]:::runner
  ART --> REAP[reap ghost clusters]:::runner

  classDef ext fill:#eceff1,stroke:#78909c,color:#263238
  classDef runner fill:#fdf0d5,stroke:#b8860b,color:#3d2c00
  classDef cloud fill:#e3f0fb,stroke:#2c6fad,color:#10314d
  classDef store fill:#e4f3e7,stroke:#3f8f52,stroke-width:1.5px,color:#14361f
  classDef gate fill:#fbe6e6,stroke:#b5504f,color:#4a1414
  classDef scratch fill:#f4f4f5,stroke:#b0b4ba,color:#3f4145,stroke-dasharray:3 3
```

**1 · The `.t0` stamp.** `cycle` writes its start time next to the database on
the way out, and writes it *last*: a cycle that dies leaves no stamp, and the
next sync safely falls back to the full window. With a stamp, sync pushes only
rows the cycle touched — roughly 2,800 rows becomes a few dozen.

**2 · Seed fingerprints.** `sources`, `places` and `place_aliases` change only
when someone edits the seed, but they were going up whole every cycle: 1,372
rows × 96 cycles = 131k writes a day, past D1's 100k free daily limit on its
own. Each is now hashed and pushed only on a change, with the hash kept in
`sync_meta` in D1 because the runner remembers nothing between cycles.

**3 · Reaping.** When two clusters merge, the loser vanishes locally but
survives in D1 as a ghost story — a second card for an event that already has
one, opening on an empty article list. `reap` deletes remote cluster ids absent
locally, nulling `articles.cluster_id` first because D1 does not enforce the
foreign key. It refuses when more than a tenth of the window looks absent: a
store that was never hydrated is indistinguishable from "everything merged".

## Who writes what

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'ui-sans-serif, system-ui, sans-serif','fontSize':'14px','lineColor':'#8a8f98','primaryTextColor':'#1b1f23','edgeLabelBackground':'#ffffff'}}}%%
flowchart TB
  P[pipeline]:::runner
  A[web app]:::cloud
  T1[(sources · places · place_aliases<br/>clusters · articles)]:::store
  T2[(prefs · saved · events)]:::store
  P -->|writes| T1
  A -->|reads| T1
  A -->|writes| T2
  P -.->|never touches| T2

  classDef ext fill:#eceff1,stroke:#78909c,color:#263238
  classDef runner fill:#fdf0d5,stroke:#b8860b,color:#3d2c00
  classDef cloud fill:#e3f0fb,stroke:#2c6fad,color:#10314d
  classDef store fill:#e4f3e7,stroke:#3f8f52,stroke-width:1.5px,color:#14361f
  classDef gate fill:#fbe6e6,stroke:#b5504f,color:#4a1414
  classDef scratch fill:#f4f4f5,stroke:#b0b4ba,color:#3f4145,stroke-dasharray:3 3
```

`prefs` is deliberately not synced: the app is its only writer, and carrying
the hydrated copy back up would revert whatever the reader changed while the
cycle was running.

## Failure modes

- **LLM unavailable or malformed** — three attempts, then an extractive
  fallback (first five sentences, headline trimmed of the outlet suffix), so a
  cluster always has something to show.
- **D1 daily row-write limit** — the run fails on push and heals at midnight
  UTC. Watch this whenever cycle frequency or row volume rises.
- **Overlapping runs** — impossible by construction: the workflow's
  `concurrency: news-cycle` group queues rather than cancels, because two runs
  sharing one D1 would clobber each other's cluster assignments.
- **PAT expiry** — the Worker's `GITHUB_TOKEN` is a fine-grained PAT with
  Actions: write. If it lapses, dispatch 401s silently and the site simply
  stops updating.
