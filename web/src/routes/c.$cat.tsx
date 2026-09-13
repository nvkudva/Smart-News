import { createFileRoute, notFound } from '@tanstack/react-router'
import { categoryBySlug } from '../../shared/taxonomy'
import { FeedError, FeedPending } from '../components/FeedBoundary'
import { FeedPage } from '../components/FeedPage'
import { loadWorld } from '../lib/world'

/**
 * Everything above the rows is derivable from the hardcoded taxonomy, so a
 * category switch is a client navigation with no request in it. The rows come
 * from /api/world, which the strip warms on hover and SectionFeed keeps in
 * IndexedDB against the cycle stamp.
 *
 * The Suspense boundary the Next version needed is gone: it existed only
 * because useSearchParams opted a static page into a per-request render.
 * SectionFeed shows its own skeleton.
 */
export const Route = createFileRoute('/c/$cat')({
  // ?sub= is a filter over rows already loaded, so it never triggers a fetch -
  // declaring it here is what makes it typed at the use site in SectionFeed.
  // The return type is annotated with an OPTIONAL sub rather than inferred.
  // Inferred, it comes out as { sub: string | undefined } - a key that is
  // present and may hold undefined - which makes `search` a required prop on
  // every Link and navigate() aimed at this route.
  validateSearch: (search: Record<string, unknown>): { sub?: string } => ({
    sub: typeof search.sub === 'string' ? search.sub : undefined,
  }),
  // A pure taxonomy lookup, before anything is loaded: an unknown slug is a
  // 404 rather than an empty section.
  beforeLoad: ({ params }) => {
    if (!categoryBySlug(params.cat)) throw notFound()
  },
  // One answer for every category, so the loader does not depend on the param:
  // the world is already in hand when the section is picked out of it.
  loader: () => loadWorld(),
  // Both faces read the param rather than hardcoding 'top': the strip is
  // derivable from the taxonomy and needs nothing loaded, so while India is
  // arriving it should say India. It highlighted Top and then jumped.
  pendingComponent: Pending,
  errorComponent: Failed,
  component: SectionPage,
})

function Pending() {
  return <FeedPending active={Route.useParams().cat} />
}

function Failed() {
  return <FeedError active={Route.useParams().cat} />
}

function SectionPage() {
  // beforeLoad has already rejected anything categoryBySlug cannot resolve.
  const category = categoryBySlug(Route.useParams().cat)!
  return <FeedPage active={category.slug} />
}
