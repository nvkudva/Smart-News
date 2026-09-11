# Plan

Architecture, decisions and rejected alternatives. Task state lives in TODO.md.

## The problem this plan solves

Two requirements, and they pull the same way:

1. A page should feel instantaneous.
2. Calls to the Worker and to D1 should be as few as we can make them.

Today `/c/[cat]` meets both by accident of how it was built — a prerendered
shell, one JSON call, a module-scope map, and a hover prefetch in
`StripScroller`. Nothing else does. `/` and `/story/[id]` are `force-dynamic`
server renders, so a click waits on the whole render, and the story route
deliberately has no `loading.tsx` (a Suspense fallback would commit `200`
before `notFound()` could answer `404`), so nothing paints until it lands.

Measured on the deploy: every route is 0.4–2.0s TTFB, prerendered ones
included. The latency is the distance to the edge, not the queries. So the
answer is not "make the queries faster" — it is "do not make the call".

## The stamp is the whole design

`src/lib/cycle.ts` already holds the mechanism and nothing calls it:

- `cycleStamp()` — `COUNT(*)`–`MAX(last_seen)` over summarised clusters,
  written by `sync-d1.ts` at the end of each run, memoised 60s per isolate.
- `etagFor(stamp, scope)` — a weak validator, correct because two renders of
  one cycle are equivalent rather than byte-identical.
- `matches(request, etag)` — the conditional-request half.

It is derived from data, not from the clock, so it moves only when the
readable feed could actually have changed — at most every fifteen minutes and
usually less. That makes it the right cache key for every layer at once: the
isolate map, the HTTP response, the service worker, and IndexedDB.

**Decision:** the stamp, not a TTL, is what expires a cached thing anywhere in
this app. A TTL guesses; the stamp knows.

## Loading only what is new

The stamp answers "did anything change". It does not answer "what changed", so
a moved stamp would still cost a whole section payload. The delta:

    GET /api/section/:cat   If-None-Match: W/"<stamp>"   ?since=<cursor>
    → 304, or { stamp, ids: [...], stories: [only rows newer than cursor] }

Three decisions inside that shape:

- **The cursor is `last_seen`, not `first_seen`.** A cluster that gained a
  source has a new headline, crux and counts without being new, and `last_seen`
  catches the appeared and the grown in one comparison. It is also what the
  stamp is built from, so the two can never disagree.
  `clusters_live_category(category, last_seen DESC) WHERE headline IS NOT NULL`
  serves it directly.
- **The ordered id list always ships in full.** Sections are ranked against the
  reader's preferences, not sorted by time, so a delta of bare rows cannot be
  merged client-side without shipping the scorer to the browser. Forty-eight
  short ids is a couple of KB; the bodies are what cost.
  *Rejected:* re-ranking in the client. The scorer reads prefs, the gazetteer
  and a novelty mix; duplicating it is two implementations of one rule.
- **Deletions come free from that list.** `reap()` deletes merged-away clusters
  and `prune()` deletes aged-out ones. An id that stops appearing is evicted.
  A `since`-only delta could never express a removal.

When the browser has evicted a body the id list still names, it backfills with
`GET /api/stories?ids=…` rather than refetching the section.

## Layers, and what each is allowed to do

| Layer | Keyed on | Holds |
|---|---|---|
| `sections.ts` isolate map | `cat + stamp + prefs fingerprint` | query results, per Worker isolate |
| HTTP | `ETag: W/"<stamp>"` | 304 with no body |
| Service worker `data-*` | request URL | last good JSON, revalidated only when the stamp moves |
| IndexedDB | `stamp` | section id lists and story bodies, across sessions |

## Rejected

- **A TTL on top of the stamp.** Two expiry rules for one fact; the shorter
  always wins and the stamp becomes decoration.
- **`s-maxage` / shared-cache tuning.** There is no shared cache on
  `workers.dev` to honour it, and the bodies are reader-specific.
- **`loading.tsx` on `/story/[id]`.** It would commit `200` before the route
  could answer `404`. The static-shell shape removes the conflict instead: the
  shell is `200` because it is a shell, and the client renders "not found" from
  the payload.
- **Prefetching every category up front.** Fourteen sections at 48 rows is a
  megabyte to serve a reader who will open two. Hover and idle warm instead.

## Revisions
