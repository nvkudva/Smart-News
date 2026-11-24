# Smart-News launch — brief and fact sheet

## Brief

- **Audience:** people who read world news daily on a phone and are tired of the same story repeated across six tabs. Engineers and markets-followers first (the feed's ranking is tuned for them).
- **Pain:** one event, many outlets, near-identical wire copy, each with its own spin. Reading it all costs time; reading one outlet gets one framing.
- **Differentiator:** Smart-News groups every report of the same event into one story, counts independent newsrooms (not URLs), and has a model write one neutral summary across all of them, plus how left, centre and right outlets framed it.
- **Proof points:** 83 outlets read; up to 6 outlets per summary in one prompt; a story is only summarised once 2 independent outlets carry it; links out to every original.
- **CTA:** Read it now at smartnews.nvkudva.workers.dev. Free, no ads, no sign-in. Source on GitHub.

## Claims and sources

| Claim | Source |
|---|---|
| Clusters the same story across many outlets and writes one neutral summary | README.md:3 |
| Reads 83 outlets | web/shared/sources.ts:8 ("the 83 outlets we read") |
| Outlet lean rated against its own country's politics (left / centre / right) | web/shared/sources.ts:2-4 |
| Groups articles within a 48-hour window, needs a shared named entity to merge | README.md (Clustering), src/lib/cluster.ts:369-376 |
| Counts newsrooms, not URLs; wire copies collapse (Jaccard over 5-word shingles) | README.md (Clustering) |
| One model call per story, never per article; up to 6 outlets, 1,800 chars each | src/lib/summarise.ts:10, :27 |
| Only summarised once 2 independent outlets carry it (default) | src/lib/summarise.ts:498 |
| Summary: headline, 6–8 sentence crux, framing per political lean | src/lib/summarise.ts:36-48 |
| Rule: "never introduce a fact no source states"; attribute contested claims | src/lib/summarise.ts:41-44 |
| Re-summarised when a story grows 40% | README.md (Summarising) |
| New stories every 30 minutes (cron) | deploy/cron-worker/wrangler.jsonc:12 |
| Four themes (Frosted, Pastel, Broadsheet, Northlight), each with dark mode | README.md (The four themes) |
| No ads, no subscriptions, no accounts, nothing to sign in to | README.md:5-7 |
| Every story credits and links to its sources; no article republished | README.md (Use of content) |
| Respects robots.txt (RFC 9309) before fetching | src/lib/robots.ts, README.md |
| Works offline from cache (service worker) | README.md (Reading and refreshing) |

## Links

- Live site: https://smartnews.nvkudva.workers.dev (README.md:12)
- Source: https://github.com/nvkudva/Smart-News — public, **no LICENSE file**. Say "source on GitHub", never "open source".

## Deliberately not claimed

- User counts, accuracy percentages, time saved: no evidence exists.
- "55 feeds" in README is stale; sources.ts says 83 outlets read. Video uses 83.
- "Bias-free": the model is instructed to be neutral; claim "neutral summary", not "unbiased truth".
- Screenshots contain third-party news photos; video uses only the mobile top card (no people) and never desktop cards with faces.
