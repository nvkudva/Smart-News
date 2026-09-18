import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { slug } from '../../shared/taxonomy'
import { coverageOf } from '../../shared/coverage'
import type { Coverage, Outlet, Story, StoryPayload } from '../../shared/types'
import { CategoryStrip } from '../components/CategoryStrip'
import { CoverageSplit } from '../components/CoverageSplit'
import { SaveButton } from '../components/SaveButton'
import { StoryCard } from '../components/StoryCard'
import { ago } from '../lib/format'
import { TabBar } from '../components/TabBar'
import { Back, Photo } from '../components/icons'
import { load } from '../lib/load'
import { savedIds } from '../lib/saved'
import { heldWorld, sectionFrom, storyFrom } from '../lib/world'

/** What the page renders, whichever of the two sources answered. */
type StoryView = {
  cluster: Story; outlets: Outlet[]; related: Story[]; coverage: Coverage; saved: boolean;
  /** The story after this one in its own section, when the world holds it. */
  next: string | null;
}

/**
 * From the world the browser already holds, when the story is in it.
 *
 * The world ships each story's body, its outlets with their lean, and every
 * ordering, which is everything this page shows: the outlet list is one per
 * masthead, coverage is a function of the outlets, and Related is the six
 * most recent in the same category. Opening a story - and every hover that
 * warmed one - used to be a Worker invocation and four D1 reads for a payload
 * the client had. Only a world already held counts: a cold shared link must
 * not download the feed to show one story.
 */
function fromWorld(id: string): Promise<StoryView | null> {
  return Promise.all([heldWorld(), savedIds()]).then(([w, saved]) => {
    const s = w && storyFrom(w, id)
    if (!s) return null
    const section = sectionFrom(w, s.cslug).stories
    const related = section
      .filter((r) => r.id !== id)
      .sort((a, b) => b.last_seen - a.last_seen)
      .slice(0, 6)
    const at = section.findIndex((r) => r.id === id)
    return { cluster: s, outlets: s.outlets, related, coverage: coverageOf(s.outlets),
             saved: saved.has(id),
             next: at >= 0 && at < section.length - 1 ? section[at + 1]!.id : null }
  })
}

/** The server's answer, for a story outside the window: a shared link, a
 *  saved story from last week. */
async function fromServer(id: string, signal: AbortSignal): Promise<StoryView> {
  const p = await load<StoryPayload>(`/api/story/${encodeURIComponent(id)}`, { signal })
  const outlets = [...new Map(p.articles.map((a) => [a.source, a])).values()]
    .map((a) => ({ source: a.source, url: a.url, bias: a.bias }))
  return { cluster: p.cluster, outlets, related: p.related, coverage: p.coverage, saved: p.saved,
           next: null }
}

/**
 * Back goes back, not home.
 *
 * It was a Link to "/", so a reader who reached a story from Sports or from a
 * ?sub= filter was returned to the top of the feed instead of the place they
 * had been reading - and on a second story the browser's own back button and
 * this one disagreed about where "back" was.
 *
 * Still an anchor with a real href: that is what a reader who landed on the
 * story directly - a shared link, a cold tab - needs, and it keeps middle-click
 * and cmd-click opening the feed in a new tab. The href is the fallback, the
 * handler is the behaviour.
 */
function BackLink() {
  const router = useRouter()
  return (
    <a href="/" className="story__back" aria-label="Back"
       onClick={(e) => {
         if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
         if (!router.history.canGoBack()) return
         e.preventDefault()
         router.history.back()
       }}>
      <Back />
    </a>
  )
}

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
  loader: async ({ params, abortController }) =>
    (await fromWorld(params.id)) ?? fromServer(params.id, abortController.signal),
  pendingComponent: LoadingStory,
  notFoundComponent: StoryNotFound,
  component: StoryPage,
})

function StoryPage() {
  const { cluster, outlets, related, coverage, saved, next } = Route.useLoaderData()
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
          <BackLink />
          <div className="story__meta">
            {cluster.place && <><span>{cluster.place}</span><span className="sep">·</span></>}
            <span>{ago(cluster.first_seen)}</span>
            <span className="sep">·</span>
            <span>{outlets.length} outlet{outlets.length === 1 ? '' : 's'}</span>
          </div>
          {next && (
            <nav className="story__nav" aria-label="Next story">
              <Link to="/story/$id" params={{ id: next }} className="story__nav__btn story__nav__btn--next" aria-label="Next story"><Back /></Link>
            </nav>
          )}
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
            {/* Not "Sources". The list is not a citation to be checked - it is
                where the reporting is, and this page is a summary of it. The
                title says what tapping one gets you. */}
            <h2 className="sectitle">Read the full story at</h2>
            <ul className="sources">
              {outlets.map((a) => (
                <li key={a.url}>
                  <a href={a.url} target="_blank" rel="noreferrer noopener">{a.source}</a>
                </li>
              ))}
            </ul>
          </div>

          <section className="story__coverage">
            <CoverageSplit coverage={coverage} articleCount={cluster.article_count} framing={framing} />
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
          <BackLink />
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
