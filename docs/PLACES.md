# Places

The model writes `clusters.place` as free text — "Bengaluru", "New Delhi",
"Satya Niketan, Delhi", "Karnataka", "India". Two hundred and forty-two distinct
strings for four hundred and fifty stories, with the same city arriving under
two spellings. The gazetteer turns that text into one canonical row per place so
a local feed does not silently miss half its stories.

The free text is never rewritten. `clusters.place_id` is additive: a story whose
string resolves to nothing keeps a NULL `place_id` and ranks exactly as it did
before the gazetteer existed.

## The id scheme

Three levels, fixed depth, one table:

```
n:in                        country
a:in.karnataka              admin1  (state, province, region)
c:in.karnataka.bengaluru    city
```

`kindLetter ':' dot-joined slugs`, where a slug is lowercased, stripped of
diacritics, and has every run of non-alphanumerics collapsed to `-`. A city
whose admin1 is unknown drops that segment: `c:fr.paris`.

Because the depth is fixed, every hierarchy question is a flat `IN` list rather
than a recursive CTE — which matters when the store is D1 and each statement is
a network round trip.

**Ids are opaque outside `src/lib/places.ts`.** Never parse one; call
`expandPlaceIds`, `geoAdjacentPlaceIds` or `getPlaces` instead.

There is no fourth level. Sub-city text ("Whitefield", "Satya Niketan") is an
*alias* onto the city row, which is what makes "a story in Whitefield counts as
Bengaluru" true without any extra work.

## The two tables

`places` — one row per place, carrying `kind`, `name`, a precomputed `label`
("Bengaluru, Karnataka, India", so nothing has to join to display a place),
`country` (ISO 3166-1 alpha-2, uppercase), `admin1_id`, `parent_id`, and
nullable `lat` / `lon` / `population`. Coordinates exist because GPS resolution
and geo-adjacency need them; `population` only ever breaks a tie.

`place_aliases` — `(alias, country)` is the primary key. `alias` is
`normaliseAlias()` output: lowercased, NFD with combining marks stripped, every
run of anything else collapsed to a single space. `country` is the two-letter
code the alias is scoped to, or `''` meaning "any country" — so "Hyderabad" can
mean different cities in `IN` and `PK`.

Resolution tries, in order: the whole string scoped to the cluster's country,
the whole string unscoped, then the same two for the last comma-separated
segment, then for the first. The last segment before the first is deliberate —
it is the broader place, and the one an alias is most likely to exist for.

## Adding a place or an alias by hand

`data/gazetteer.seed.json` is the source of truth — not the database, and not
the build script. Edit it, then:

```
npm run gazetteer
```

The run upserts both tables from the seed, deletes rows the seed no longer
carries (places still referenced by a cluster are kept), backfills
`clusters.place_id` for every cluster whose text resolves, and prints a coverage
line plus the strings it could not place, most frequent first. It is idempotent:
running it twice produces identical output.

To add an alias, append to `aliases`:

```json
{ "alias": "Whitefield", "country": "IN",
  "place_id": "c:in.karnataka.bengaluru", "source": "seed", "confidence": 1 }
```

`alias` is normalised on load, so write it however reads best. Use `""` for
`country` only when the string means exactly one place worldwide.

To add a place, append to `places` with an `id` built by the scheme above, a
`parent_id` that already exists in the file, and a `label` written out in full.
Leave `lat`/`lon` null rather than guessing — a wrong coordinate sends the GPS
opt-in to the wrong city, whereas a null one simply makes that place
unreachable by GPS.

`GAZETTEER_LLM=1 npm run gazetteer` asks the configured model about the
leftovers and writes its answers back into the seed with `"source": "llm"`. That
is a proposal, not a result: read the diff before running again. Model guesses
are never resolved on the fly at query time.

The seed is tracked in git: `.gitignore` ignores `data/*` (not `data/`, which
git would refuse to descend into) and then negates `!data/gazetteer.seed.json`.
The database and any other `data/` file stay ignored.

## Where the code lives

| file | runs where | for |
| --- | --- | --- |
| `src/lib/places.ts` | Worker and Node | everything the web app asks — resolve, search, expand, adjacency, nearest. Imports only `./d1`; never node builtins. |
| `src/lib/places-local.ts` | pipeline only | the same matching order, synchronous, over the local SQLite handle. Exists because summarising a cycle cannot afford one awaited D1 round trip per cluster. |
| `scripts/build-gazetteer.ts` | one-off / on demand | loads the seed, backfills, reports coverage. |

## Deploy order

The gazetteer has to land before any code that reads it:

```
npm run gazetteer && npm run sync    # then deploy the web app
```

`sync-d1.ts` pushes `places` and `place_aliases` whole on every run, and ALTERs
`place_id` into the live `clusters` table — the schema block is all
`CREATE TABLE IF NOT EXISTS`, which is a no-op against tables that already
exist, so new columns need their own explicit step.
