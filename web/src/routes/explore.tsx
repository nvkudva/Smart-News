import { Link, createFileRoute } from '@tanstack/react-router'
import type { ExplorePayload } from '../../shared/types'
import { CategoryTile, PlaceTile } from '../components/ExploreTiles'
import { StoryCard, variantFor } from '../components/StoryCard'
import { TabBar } from '../components/TabBar'
import { fetchJson } from '../lib/api'

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
  loader: ({ deps, abortController }) => {
    const q = new URLSearchParams()
    if (deps.category) q.set('category', deps.category)
    if (deps.country) q.set('country', deps.country)
    if (deps.place) q.set('place', deps.place)
    const qs = q.toString()
    return fetchJson<ExplorePayload>(
      qs ? `/api/explore?${qs}` : '/api/explore', abortController.signal)
  },
  pendingComponent: LoadingExplore,
  component: Explore,
})

function Explore() {
  const data = Route.useLoaderData()

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

  const { categories, places } = data

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Explore</h1>
          <p>Everything covered in the last 48 hours, by subject and by place.</p>
        </div>

        <div className="explorestack">
          <section className="exploresec">
            <div className="label">Categories</div>
            <div className="tiles">
              {categories.map((c) => (
                <CategoryTile key={c.category} name={c.category} stories={c.stories} lead={c.lead} />
              ))}
            </div>
          </section>

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
        </div>
      </main>
      <TabBar active="explore" />
    </>
  )
}

/** What explore/loading.tsx was. */
function LoadingExplore() {
  return (
    <>
      <main className="shell">
        <div className="pagehead"><h1>Explore</h1></div>
        <div className="feed" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skel skel--compact" />)}
        </div>
      </main>
      <TabBar active="explore" />
    </>
  )
}
