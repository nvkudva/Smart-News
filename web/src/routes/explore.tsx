import { Link, createFileRoute } from '@tanstack/react-router'
import type { ExplorePayload, PlaceFacet } from '../../shared/types'
import { PageSkeleton } from '../components/PageSkeleton'
import { PlaceTile, SubTile } from '../components/ExploreTiles'
import { StoryCard, variantFor } from '../components/StoryCard'
import { TabBar } from '../components/TabBar'
import { load } from '../lib/load'
import { loadWorld } from '../lib/world'
import { SCOPE_SUBS } from '../../shared/taxonomy'

/** Local / National / International / Others ride along in every topic's
 *  subs as scope filters; they are places to the reader, not subjects. */
const SCOPES = new Set(SCOPE_SUBS.map((s) => s.slug))

/**
 * Two pages behind one path, as the Next version had it: the facet index when
 * nothing is asked for, and a filtered list when something is.
 *
 * The search params are the whole input, so the loader depends on them and
 * nothing else - switching facet is a new loader run, and coming back to the
 * index is the one the router already has.
 */
export const Route = createFileRoute('/explore')({
  validateSearch: (search: Record<string, unknown>): {
    category?: string; country?: string; place?: string;
  } => ({
    category: typeof search.category === 'string' ? search.category : undefined,
    country: typeof search.country === 'string' ? search.country : undefined,
    place: typeof search.place === 'string' ? search.place : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, abortController }) => {
    const q = new URLSearchParams()
    if (deps.category) q.set('category', deps.category)
    if (deps.country) q.set('country', deps.country)
    if (deps.place) q.set('place', deps.place)
    const qs = q.toString()
    const data = await load<ExplorePayload>(qs ? `/api/explore?${qs}` : '/api/explore', {
      persist: true, signal: abortController.signal,
    })
    if ('stories' in data) return { data, subs: [] as SubTileData[] }
    data.places = await leadWithHere(data.places)
    // The subjects inside each topic, with today's counts, come from the world
    // the feed already holds: a keyword bucket with nothing in it is not a way in.
    const w = await loadWorld()
    const subs: SubTileData[] = Object.entries(w.sections)
      .filter(([, sec]) => sec.kind === 'topic')
      .flatMap(([cat, sec]) => sec.subs
        .filter((sub) => sub.count > 0 && !SCOPES.has(sub.slug))
        .map((sub) => ({ cat, category: sec.name, name: sub.name, slug: sub.slug, count: sub.count })))
      .sort((a, b) => b.count - a.count)
    return { data, subs }
  },
  pendingComponent: () => <PageSkeleton title="Explore" tab="explore" />,
  component: Explore,
})

type GeoTile = Pick<PlaceFacet, 'place_id' | 'label' | 'kind'>

/** The reader's GPS city, then its nation, ahead of the rest - tiles with no
 *  stories today still lead, at zero. A failed lookup leaves the order alone. */
async function leadWithHere(places: PlaceFacet[]): Promise<PlaceFacet[]> {
  const geo = await fetch('/api/place')
    .then((r) => (r.ok ? r.json() as Promise<{ geo?: GeoTile[] }> : { geo: [] }))
    .then((r) => r.geo ?? [])
    .catch((): GeoTile[] => [])
  if (!geo.length) return places
  const lead = geo.map((g) => places.find((p) => p.place_id === g.place_id)
    ?? { ...g, name: g.label, country: '', stories: 0 })
  const ids = new Set(geo.map((g) => g.place_id))
  return [...lead, ...places.filter((p) => !ids.has(p.place_id))]
}

type SubTileData = { cat: string; category: string; name: string; slug: string; count: number }

function Explore() {
  const { data, subs } = Route.useLoaderData()

  // The filtered shape carries `stories`; the index carries the two facet
  // lists. Narrowing on the field rather than on the search params means the
  // markup can never read a key the payload does not have.
  if ('stories' in data) {
    const { stories, title, category } = data
    return (
      <>
        <main className="shell">
          <div className="pagehead exploretint" data-cat={category ?? undefined}>
            <Link to="/explore" search={{}} className="kicker exploreback">← Explore</Link>
            <h1 className="exploretitle">{title}</h1>
            <p>{stories.length} {stories.length === 1 ? 'story' : 'stories'} in the last 48 hours</p>
          </div>
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        </main>
        <TabBar active="explore" />
      </>
    )
  }

  const { places } = data

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Explore</h1>
          <p>What the news is about, and where it happened.</p>
        </div>

        <div className="explorestack">
          {places.length > 0 && (
            <section className="exploresec">
              <div className="label">Places</div>
              <div className="exploreplaces">
                {places.map((p) => (
                  <PlaceTile key={p.place_id} placeId={p.place_id} label={p.label}
                             kind={p.kind} stories={p.stories} />
                ))}
              </div>
            </section>
          )}

          {subs.length > 0 && (
            <section className="exploresec">
              <div className="label">Subjects</div>
              <div className="exploreplaces">
                {subs.map((t) => <SubTile key={`${t.cat}/${t.slug}`} {...t} />)}
              </div>
            </section>
          )}
        </div>
      </main>
      <TabBar active="explore" />
    </>
  )
}

