import { createFileRoute } from '@tanstack/react-router'
import { TabBar } from '../components/TabBar'

/** Not ported yet - placeholder so links and the tab bar type-check. */
export const Route = createFileRoute('/reels')({ component: Placeholder })

function Placeholder() {
  return (
    <>
      <main className="shell">
        <div className="pagehead"><h1>reels</h1><p>Not ported yet.</p></div>
      </main>
      <TabBar active="home" />
    </>
  )
}
