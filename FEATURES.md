# Features and fixes worth doing next

Everything here came out of a three-lens review (product, design, architecture)
that produced 21 proposals. Six were implemented — see the commit "Improvements
from a PM/design/architect review". The rest are recorded here rather than
dropped, most of them because they straddled the file boundaries that let the
implementers run concurrently, not because they were weak.

Ordered by value. Each says what is wrong now, so the case survives without the
conversation that produced it.

---

## Features

### 1. The first run pretends to know the reader
`getPrefs()` silently returns `DEFAULT_PREFS` when no prefs row exists — country
`IN`, categories World/India/Technology/Science, place Bengaluru. A brand new
reader in Berlin gets a feed tuned to Bengaluru and a header that says
"Bengaluru", with nothing indicating these were assumed rather than chosen.

Return a `configured` flag that is true only when a row exists. When it is
false, drop the geographic weighting, and offer a one-tap strip on Home to pick
interests and a country. `src/lib/feed.ts`, `src/app/(feed)/page.tsx`,
`src/app/profile/page.tsx`.

### 2. There is no search
Nothing in the app searches stories. A reader who half-remembers something from
Tuesday has no way back to it, and Saved has no search either. `searchStories(q)`
over `headline` and `crux` with `LIKE`, or D1 FTS5 if that proves too blunt, plus
a `/search` route. `src/lib/library.ts`, new `src/app/search/page.tsx`.

### 3. Only the surprise stories explain themselves
`score()` knows exactly why each story ranked — category match, home country,
named place, heavy corroboration — and discards all of it, returning a bare
number. The exploration dot explains one card in four; the other twenty-three
explain nothing. Have `score()` return `{ k, reason }` and show the reason in the
card footer. `src/lib/feed.ts`, `src/components/StoryCard.tsx`.

### 4. Saved is a pile
No grouping, no filter, no unsave from the list, and cards show the story's age
rather than when it was saved. Bites once the list passes about ten items. Group
by saved-at bucket, show "Saved 3d ago", add inline unsave.
`src/lib/library.ts`, `src/app/saved/page.tsx`, `src/components/SaveButton.tsx`.

### 5. The 48-hour cliff is invisible, and Explore mislabels what it shows
`getFeed`, `getCategoryFacets`, `getPlaceFacets` and `getReels` all cut at 48
hours; `getByCategory` and `getByCountry` have no time filter at all. So Explore
says "in the last 48 hours" above a list that is not limited to 48 hours. Extract
the window to one constant, pass it everywhere, and add an "Earlier" toggle
rather than a silent cut. `src/lib/library.ts`, `src/app/explore/page.tsx`.

### 6. Categories stop at ten fixed buckets — there is no topic layer
`CATEGORIES` in `src/lib/db.ts` is a hardcoded list of ten: World, India,
Politics, Business, Technology, Science, Health, Sports, Entertainment, Climate.
Every story is forced into one of them, and Explore can offer nothing below that
level. "Technology" is 67 stories with no way to say *which* technology.

Particle — the reference this app was modelled on — runs a second level under
each category that is **derived from the stories rather than declared in
advance**: under Technology it surfaces Data Centers, AI Agents, Machine
Learning, Open Source, Graphics Processing Units; under Politics, Midterm
Elections, Redistricting, Conventions. Those are not a fixed taxonomy someone
maintains, they are what the week's coverage actually clustered into.

We already have most of what this needs and throw it away. The summariser sees
the full text of every article in a cluster and the entity extraction in
`src/lib/text.ts` already pulls proper nouns for the clustering step. Ask the
model for two or three topic tags per cluster alongside the category, store them
in a `topics` table joined to clusters, and rank them by cluster count over the
window. Then Explore gets a second row under each category, and a topic becomes
something a reader can follow the way they follow a place.

Worth doing after the place hierarchy lands, because it is the same shape of
problem — free-text labels from a model that need canonicalising before they are
useful — and the same table pattern will serve both.

A smaller adjunct: Particle also has editor-curated lenses at `/featured/*`
("Top News", "Iran War Headlines") over the same cluster pool. Cheap to add once
topics exist, since a lens is just a saved query.

---

## Fixes

### 7. Reels issues 20 saved-lookups per render
`src/app/reels/page.tsx` does `Promise.all(stories.map((s) => isSaved(s.id)))` —
twenty separate `SELECT 1` round trips to D1 per page view. Add
`getSavedIds(ids)` returning a Set from one `WHERE cluster_id IN (…)`. Home also
calls `getPrefs()` twice per render. Invisible at current volume, embarrassing at
any other.

### 8. hydrate pages without ORDER BY
`scripts/hydrate-d1.ts` pages with `LIMIT 400 OFFSET n` and no `ORDER BY`.
SQLite gives no stable ordering across separate statements, so a row can be
skipped or fetched twice. It has not bitten yet because the working set is small
enough to fit in few pages — that is luck, not correctness.

### 9. sync still pushes prefs, reverting the reader's own choices
`scripts/sync-d1.ts` pushes the `prefs` table up from the local scratch store.
The web app is the only legitimate writer of that table, so every cycle can
overwrite a preference the reader just set. Delete the prefs push.

### 10. The story page lights the wrong tab
`src/app/story/[id]/page.tsx` renders `<TabBar />` with no `active`, so the
default `home` is highlighted while the reader is on a story. Needs a `story`
variant that highlights nothing.

### 11. Two smaller ones cut for lane boundaries
The unbounded articles query in `getStory` has no `LIMIT` — a very large cluster
would fetch every row. And `src/app/story/[id]/page.tsx` still carries inline
`oklch()` values that were not included in the contrast pass, so they were never
measured against the 4.5:1 bar the tokens now meet.

---

## Explicitly not here

Left/right/centre bias breakdown, credibility scoring, GPS-precise local news,
and themes B and C are roadmap items with their own designs — see the design
canvas and `docs/MODELS.md`. They are not review findings and are not in scope
for this list.

---

## From the v2.0 product review

A product review after v1.5, the navigation override and v2.0 shipped. The
blindspot calibration it flagged was fixed in that pass rather than recorded
here; these are the rest, ordered by value.

### 12. The feed dead-ends at 30 cards, and ranks less than it claims
Home renders 30 cards with no pagination, while Explore's own facet counts over
the same 48-hour window total 631 stories. `getFeed` also pre-truncates with
`ORDER BY c.last_seen DESC LIMIT 400` *before* scoring, so a few hundred
in-window stories are cut by recency alone and can never rank however high
`score()` would put them. Rank the whole window, and page by rank rather than by
`last_seen` so slot 34 still honours the one-in-four exploration budget.
`src/lib/feed.ts`, `src/app/(feed)/page.tsx`.

### 13. Nothing knows what you have already read
The `events` table is written by nothing and read by nothing — the schema note
says it exists "so personalisation has history to learn from later", and it has
been collecting nothing. `logEvent()` was its only writer, had no call sites,
and has been deleted; anything that starts recording reads begins here. Every visit re-serves
the same cards in the same order, so a reader returning after lunch rescans
thirty headlines to find three that are new. Call it on story open, dim and
demote read cards, and show "12 new since you last looked".
`src/lib/feed.ts`, `src/app/story/[id]/page.tsx`, `src/components/StoryCard.tsx`.

### 14. Cards show a CSS-truncated paragraph, not a written short line
Every card renders the full 4-6 sentence `crux` and the CSS clamps it to 3-5
lines, so the feed is thirty summaries cut off mid-sentence. Ask the model for a
one-sentence `lede` alongside the crux — roughly 20 more output tokens on a call
that already writes 100-830 — and keep `crux` for the story page and reels.
`src/lib/summarise.ts`, `src/components/StoryCard.tsx`, `scripts/d1-schema.ts`.

### 15. "Related" is just the category's three newest
`getStory` selects `WHERE category = ? ORDER BY last_seen DESC LIMIT 3`, so a
Nepal flood story offers whatever else is filed under World this hour. Canonical
`place_id`, the proper-noun extraction in `src/lib/text.ts` that clustering
already runs, and `first_seen` are all in place to rank on entity and place
overlap instead — and to offer an "earlier" link to a prior chapter of the same
running story, which is the follow-the-thread move a clustered reader returns
for. `src/lib/feed.ts`, `src/app/story/[id]/page.tsx`.

### 16. Every outlet's own headline is fetched, then thrown away
`getStory` selects `a.title` per article; the story page renders only source
names in a "Summarised from" run of links. Showing each outlet's actual headline
side by side is the most literal way to let a reader see how coverage differs,
needs no model call, and unlike the framing sentences does not depend on the
hand-curated bias table being right. Group them by the side `coverageOf` already
computes. `src/app/story/[id]/page.tsx`, `src/lib/feed.ts`.

### 17. A stalled pipeline looks exactly like a quiet news day
The only freshness signal is on /profile, and it is developer copy — "Run
`npm run cycle` to pull the latest" — on a site whose cycle runs in GitHub
Actions where the reader can do nothing about it. If that job fails, Home keeps
serving stories whose relative timestamps age plausibly for days and nothing
says the feed stopped. Show a staleness strip on Home when `max(last_seen)`
passes about 90 minutes. `src/app/(feed)/page.tsx`, `src/lib/library.ts`.
