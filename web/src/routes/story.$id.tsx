import { Link, createFileRoute } from '@tanstack/react-router'
import { slug } from '../../shared/taxonomy'
import type { StoryPayload } from '../../shared/types'
import { CategoryStrip } from '../components/CategoryStrip'
import { CoverageSplit } from '../components/CoverageSplit'
import { SaveButton } from '../components/SaveButton'
import { StoryCard } from '../components/StoryCard'
import { ago } from '../lib/format'
import { TabBar } from '../components/TabBar'
import { Back, Photo } from '../components/icons'
import { load } from '../lib/load'

/**
 * The one place the port improves on the original.
 *
 * This route deliberately had no loading.tsx: a Suspense fallback commits a
 * 200 before notFound() can answer 404, so the Next version had to choose
 * between a skeleton and a correct status. Here the Worker answers 404 for an
 * id it cannot find, fetchJson turns that into notFound(), and the router
 * shows notFoundComponent - so there is a pending state AND a real 404.
 */
export const Route = createFileRoute('/story/$id')({
  loader: ({ params, abortController }) =>
    load<StoryPayload>(`/api/story/${encodeURIComponent(params.id)}`, {
      signal: abortController.signal,
    }),
  pendingComponent: LoadingStory,
  notFoundComponent: StoryNotFound,
  component: StoryPage,
})

function StoryPage() {
  const { cluster, articles, related, coverage, saved } = Route.useLoaderData()

  const outlets = [...new Map(articles.map((a) => [a.source, a])).values()]
  // Two sentences per paragraph reads better than one wall of prose.
  const paragraphs = cluster.crux.split(/(?<=\.)\s+(?=[A-Z])/)
    .reduce<string[][]>((acc, s, i) => { (acc[Math.floor(i / 2)] ??= []).push(s); return acc }, [])
  const framing = {
    left: cluster.framing_left,
    centre: cluster.framing_centre,
    right: cluster.framing_right,
  }

  return (
    <>
      <main className="shell shell--story">
        {/* The column the feed pages carry, on the page a reader lands on from
            a link: without it a shared story is a dead end on a desktop, with
            fourteen sections one click away and none of them on screen. It
            marks the story's own category rather than nothing, so the page
            says where this sits. Below 1024 it is hidden, where it would be
            the phone's sweep strip above a story that already has a back
            button and a headline. */}
        <CategoryStrip active={slug(cluster.category)} />
        {/* Back, dateline and the save control read as one line: the story's
            own metadata sits in the bar rather than repeating under the title. */}
        <header className="story__topbar">
          <Link to="/" className="story__back" aria-label="Back"><Back /></Link>
          <div className="story__meta">
            {cluster.place && <><span>{cluster.place}</span><span className="sep">·</span></>}
            <span>{ago(cluster.first_seen)}</span>
            <span className="sep">·</span>
            <span>{outlets.length} outlet{outlets.length === 1 ? '' : 's'}</span>
          </div>
          <div className="story__save">
            <SaveButton clusterId={cluster.id} initial={saved} iconOnly />
          </div>
        </header>

        <div className="detail">
          <div className="story__head">
            <div className="story__headtext">
              <h1 className="story__title">{cluster.headline}</h1>
            </div>
          </div>

          {/* The photograph sits beside the summary rather than beside the
              headline: the headline gets the width it wants, and the picture
              is next to the prose it illustrates. Below 1024 it goes back to
              being a full-width lead above the text - which is why it is
              ordered ahead of the panel there rather than after it. */}
          <div className="detail__main">
            <div className="panel">
              <div className="label">What happened</div>
              {paragraphs.map((group, i) => <p key={i}>{group.join(' ')}</p>)}
            </div>

            <div className="plate plate--detail">
              {cluster.image_url ? <img src={cluster.image_url} alt="" /> : <Photo size={30} />}
              {cluster.image_url && cluster.image_source && <span className="credit">Source : {cluster.image_source}</span>}
            </div>
          </div>

          <div className="detail__side story__rail">
            <h2 className="sectitle">Sources</h2>
            <ul className="sources">
              {outlets.map((a) => (
                <li key={a.url}>
                  <a href={a.url} target="_blank" rel="noreferrer noopener">{a.source}</a>
                </li>
              ))}
            </ul>
          </div>

          <section className="story__coverage">
            <CoverageSplit coverage={coverage} articleCount={articles.length} framing={framing} />
          </section>

          {related.length > 0 && (
            <section className="story__related">
              <h2 className="sectitle">Related</h2>
              <div className="story__relgrid">
                {related.map((r) => (
                  <StoryCard key={r.id} story={r} variant="compact" />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
      <TabBar />
    </>
  )
}

function LoadingStory() {
  return (
    <>
      <main className="shell shell--story" aria-busy="true" aria-label="Loading">
        <CategoryStrip active="" />
        <header className="story__topbar">
          <Link to="/" className="story__back" aria-label="Back"><Back /></Link>
        </header>
        <div className="detail">
          <div className="detail__main"><div className="skel" /></div>
        </div>
      </main>
      <TabBar />
    </>
  )
}

/** What not-found.tsx said, for the one route that can reach it by id. */
function StoryNotFound() {
  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Not here</h1>
          <p>That story is not in the feed.</p>
        </div>
        <div className="panel">
          <div className="label">404</div>
          <p>Stories drop out of the feed once their coverage stops updating, so a link
            from a while back may already have gone.</p>
          <Link className="btn" to="/"
                style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
            Back to the feed
          </Link>
        </div>
      </main>
      <TabBar />
    </>
  )
}
