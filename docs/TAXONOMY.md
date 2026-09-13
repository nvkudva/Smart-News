# Proposed taxonomy

Status: **proposal, not built.** Replaces the current ten topics + four scopes in
`web/shared/taxonomy.ts`. Nothing here is stored except `category` — every scope
and every lens is derived from columns a cluster already carries.

## The two axes

A story has a **subject** (what it is about) and a **scope** (whose news it is).
They are independent: a Bengaluru metro fire is Disasters & Accidents *and*
National *and* Local, all at once.

The strip mixes both because a reader thinks in both. The rule that keeps it
honest:

> **A category's sub-row is the other axis.**
> A subject section is sliced by scope. A scope section is sliced by subject.

So under Sports you get Local / National / International; under National you get
Sports / Politics / Business. A "National" pill under National would be a no-op,
and it never appears.

## Scope sub-set

Offered under every **subject** category:

- **Local** — `place_id` within the reader's places, via the gazetteer subtree.
- **National** — `country = ` the reader's country.
- **International** — `country IS NOT NULL AND country <> ` the reader's country.
- **Others** — `country IS NULL`. Unplaced; 27 of today's World clusters are this.

Recency is not a pill. The list breaks at a "Stories older than 24h" divider
instead, which keeps every pill in the row a filter.

## The tree

The thirteen entries a reader sees: three scopes and ten subjects. Four more
subjects exist in the store without a pill — see Stored, not on the strip.

Counts are measured against the local store (735 live clusters). Bracketed
counts on the new subjects are from a keyword partition of the 318 India +
World clusters — a lower bound, since the summariser choosing from an enum will
do better than regexes.

```
Trending                         scope · the ranked mixed feed, `/`
└─ (subject pills, by volume)

Technology                       70
├─ Local · National · International · Others
├─ AI
├─ Gadgets
├─ Security & Privacy
├─ Platforms & Policy
├─ Chips & Data Centres
├─ Crypto
├─ Space & Satellites
└─ Cars & EVs

National                         scope · country = reader's country
└─ (subject pills, by volume)

International                    scope · country is set and is not the reader's
└─ (subject pills, by volume)

Politics                         62
├─ Local · National · International · Others
├─ Parties & Leaders
├─ Elections
├─ World Politics
├─ Parliament & Assemblies
├─ Protest & Rights
└─ Probes & Scandals

Business                         46
├─ Local · National · International · Others
├─ Companies & Jobs
├─ Markets
├─ Economy
├─ Crypto
├─ Energy & Commodities
└─ Trade & Tariffs

Science                          33
├─ Local · National · International · Others
├─ Life Sciences
├─ Earth Sciences
├─ Space & Astronomy
├─ Animals & Wildlife
├─ Archaeology
└─ Physics & Materials

Health                           22
├─ Local · National · International · Others
├─ Conditions & Treatment
├─ Nutrition
├─ Hospitals & Care
└─ Mental Health

Education                        [22] new · nothing in the current ten holds it
├─ Local · National · International · Others
├─ Schools
├─ Higher Education
├─ Exams & Admissions
├─ Policy & Funding
└─ Research & Faculty

Sports                           102
├─ Local · National · International · Others
├─ Cricket
├─ Football
├─ American Sports
├─ Combat Sports
├─ Rugby & AFL
├─ Motorsport
├─ Olympics & Athletics
└─ Tennis

Entertainment                    68
├─ Local · National · International · Others
├─ Indian Cinema
├─ TV & Streaming
├─ Film Festivals
├─ Music
└─ Books & Arts

Climate                          14
├─ Local · National · International · Others
├─ Warming & Emissions
├─ Extreme Weather
└─ Nature & Adaptation

Others                           [19] residual, human interest
└─ Local · National · International
```


## Stored, not on the strip

These four are valid values of `category` — the summariser files to them and
they keep the catch-all at ~19 clusters instead of ~250 — but they get no
top-level pill. A reader meets them as subject pills under Trending, National and
International, which is free: scope sections already render subject pills.

The lenses below are the summariser's definition of each subject, not a rendered
strip. They become a sub-row only if one of these is ever promoted.

```
Governance                       [39] civic and administrative news
├─ Ministries & Cabinet
├─ Civic Bodies
├─ Schemes & Welfare
├─ Regulators & Commissions
└─ Public Sector & Appointments

Crime & Courts                   [90] largest single piece of the old catch-all
├─ Policing & Arrests
├─ Courts & Verdicts
├─ Violent Crime
├─ Fraud & Financial Crime
└─ Investigations & Raids

Disasters & Accidents            [85]
├─ Fires & Explosions
├─ Building Collapses
├─ Transport Accidents
├─ Floods & Storms
├─ Earthquakes & Volcanoes
└─ Rescue & Relief

Conflict & Diplomacy             [55]
├─ Wars & Strikes
├─ Ceasefires & Talks
├─ Sanctions & Restrictions
├─ Alliances & Summits
└─ Refugees & Displacement
```

Ten subjects reach the strip, which is also the answer to Particle's argument
about volume: fourteen stored, ten browsed.

## What changes from today

| | Today | Proposed |
|---|---|---|
| Subjects stored | 10, incl. India (191) and World (127) | 14, no geography among them |
| Subjects on the strip | all 10 | 10 of the 14 |
| Scopes | Top, Local, National, International | Trending, National, International — Top renamed, Local becomes a sub |
| Catch-all | 318 clusters, 43% | ~19, 3% |
| Subject subs | keyword lenses only | keyword lenses + the scope set |
| Scope subs | 5 topic pills, capped | all 14 subjects present, by volume |
| Recency | ranked into the list | a "Stories older than 24h" divider |

India and World are removed as subjects. They were scopes wearing a subject's
clothes: 187 of India's 191 clusters are `country = IN`, which is the National
tab by another name, while 11 of World's are also `country = IN` and 27 have no
country at all, so World leaked into National and vanished from both.

Local moves from a top-level scope to a sub of every subject. It is still
reachable at `/local`, and it stops being the only place a reader can ask "what
is happening here" — that question now has an answer inside Sports and Business
too.

## Multi-category

A story keeps **one primary subject** — indexed, what the partition uses and
what the card prints — and may carry **secondary subjects** in a
`cluster_categories` join table.

This is why: `clusters.category` is a single `TEXT` column behind
`clusters_live_category (category, last_seen DESC)`, and `getTopicSection` is an
equality read against it. Making it a set turns every topic query into a join,
changes `cslug` in the world payload to a list, and changes the known/novel
split in the ranker, which is what orders Trending. A primary plus a join table keeps
the hot path an indexed equality and lets the backfill set primary from today's
value, with secondaries added later rather than in one re-summarise.

The other two levels are already multi-valued and need nothing: scope filters on
`country`, never on subject, and the lenses were built as overlapping sets by
design.

## Migration

1. Add the five subjects to the enum; keep India and World readable but unissued.
2. Backfill the 318 existing India/World clusters — keyword partition first, LLM
   pass over whatever it leaves unfiled.
3. Re-point `DEFAULT_PREFS.categories`, which names World today.
4. Add `cluster_categories`, empty. Nothing reads it until step 5.
5. Teach the summariser to emit secondaries.

Steps 1–3 are the whole visible change. 4–5 can wait.

## Prior art: particle.news

Worth reading before settling this, because they answer the same question
differently.

**Nine top-level subjects, no geography at all:** Popular, Technology, Sports,
Entertainment, Science, Politics, Crime, Economics, Video Games. Crime is
top-level, which is the same conclusion our own counts push us to. There is no
Health, no Climate and no Education — those fold into Science, whose sub-tags
include Epidemiology, Hurricanes and Seismology.

**Sub-pills are entities and themes, not a curated partition:** SpaceX,
Nintendo, Donald Trump, Premier League, AI Safety, Mobile Operating Systems.
About ten per category, derived from the stories, and they rotate. Nobody
maintains a keyword list.

**Geography enters only as a named collection.** `/featured/arizona-2026-midterms`
and `/featured/iran-war-headlines` are real routes, each with a named author and
a one-line definition in plain English — Iran's reads *"All stories with
headlines about the war in Iran - does not need to include stories with
references to Iran in later bulletin the overview"*. A category defined as a
prompt, evaluated against each cluster. Followable, and embeddable elsewhere.

**Recency is a divider, not a pill.** The list breaks at "Stories older than 24h".

**What this argues about the tree above.** Particle runs 9 subjects at far higher
volume than ours. We propose 14 against 735 clusters per 48h, where Climate is
already 14 clusters and Health 22, and Education (22) and Governance (39) would
join them at the thin end. Their answer to a thin subject is to fold it in and
let the sub-tags carry the specificity. That is a real argument for ~10 subjects
with richer tags over 14 with sparse ones — see Open question 6.

**What does not transfer.** Video Games as a top-level subject. And their
omission of National/International is a US-market default: for a reader in
Bengaluru that distinction is the product, not an oversight.

## Trending pills

Particle's Popular row is a set of buzz terms across categories rather than a
fixed taxonomy. We can do the same, derived at read time, with no schema change
and no pipeline change.

**Extraction.** The summariser writes sentence case, so a capitalised token that
is not sentence-initial is a proper noun. That one rule, about thirty lines and
no LLM, yields `BRICS`, `Supreme Court`, `Strait of Hormuz`, `Premier League`,
`Satya Niketan`.

**Velocity.** A term's share of weight in the last quarter of the window against
the section's own baseline for that period, weighted by `log2(1 + article_count)`
so a story 130 outlets carried counts for more than one that a single outlet ran.
This is what separates *trending* from merely *frequent*.

Measured against the live D1 window, 221 clusters over 48h:

| Entity | Stories | Recency lift |
|---|---|---|
| BRICS | 9 | 2.42× |
| Pakistan | 5 | 3.35× |
| Narendra Modi | 5 | 2.73× |
| New Delhi | 7 | 2.34× |
| Iran | 8 | 1.81× |
| Kashmir | 5 | 1.71× |

"India" appears in 22 of the 221 and lifts only 1.84× — frequent, not trending,
and lift is what tells them apart.

**Where it goes.** The same place `subCategoriesFor` already sits: one pass over
rows the section is already rendering, no extra query, memoised against the
cycle stamp like everything else.

**The section is named Trending, and that carries a debt.** It is still
`getFeed` — personalised, ranked against the reader's prefs and places — so the
name currently promises something the query does not deliver. Two ways to settle
it, and one must be picked before this ships:

- Blend velocity into `getFeed`'s ranking, so the name becomes true while the
  feed stays the reader's.
- Keep the ranking as it is and let the pills carry the trending claim: the row
  under the heading is genuinely velocity-ranked and global, and the stories
  below remain personalised.

The second is cheaper and is what Particle's Popular does. The first is what the
word "Trending" means to most readers.

**Longer term** these replace the hand-written keyword lists in `TOPIC_SUBS`.
Entity tags cannot go stale the way a regex list does, and the summariser could
emit two to four per cluster for almost nothing, since it already reads the text.

## Open questions

1. ~~**"Recent" is a sort, not a filter.**~~ Settled by Particle's pattern: break
   the list with a "Stories older than 24h" divider and drop the pill. Removes
   it from every subject's sub-row above.
2. **Transport** measured 8 after Disasters took its share. Folded in as
   Transport Accidents — but flight delays and metro openings are not accidents.
   Own subject, or accept the gap?
3. **Governance vs Politics.** "Minister announces scheme" is Governance;
   "minister resigns under pressure" is Politics. Real line, hard to hold. This
   is the first place secondaries would earn their keep.
4. **Scope sub-cap.** `SCOPE_SUB_LIMIT` shows the top 5 subjects under a scope.
   With 14 subjects, 5 hides a lot. Raise it, or let the row scroll?
5. **Others** needs a rule, or it silently regrows. Suggest: if any lens inside
   it passes ~20 clusters over a fortnight, it graduates to a subject.
6. ~~**Fourteen subjects or ten?**~~ Settled: fourteen stored, ten on the strip.
   Governance, Crime & Courts, Disasters & Accidents and Conflict & Diplomacy
   classify but do not get a pill. Open sub-question: Climate (14) and Health
   (22) are thin too — do they stay on the strip, or join the stored four?
7. **Ambient entities.** "India" is background in an India-first product, not
   news. Lift suppresses it partly; a per-country ambient stoplist would finish
   the job. Where does that list live, and who maintains it?
