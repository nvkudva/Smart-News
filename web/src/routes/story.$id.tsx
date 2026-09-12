import { createFileRoute } from '@tanstack/react-router'

/** Not ported yet - placeholder so StoryCard's links type-check. */
export const Route = createFileRoute('/story/$id')({ component: Placeholder })

function Placeholder() {
  const { id } = Route.useParams()
  return (
    <main className="shell">
      <div className="pagehead"><h1>Story</h1><p>{id} - not ported yet.</p></div>
    </main>
  )
}
