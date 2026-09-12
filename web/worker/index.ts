import { withRequestCache } from './lib/cache'
import { cycleStamp } from './lib/cycle'
import { setD1 } from './lib/d1'
import { currentUserId } from './lib/session'
import { getWorld } from './lib/world'

export default {
  async fetch(request, env) {
    setD1(env.DB)

    return withRequestCache(async () => {
      const url = new URL(request.url)

      // Temporary probe for the src/lib port: exercises d1, cache, session,
      // cycle, world, sections, feed, places and taxonomy against local D1.
      // Replaced by the real /api/world, /api/place and /api/stamp routes.
      if (url.pathname === '/api/health') {
        const started = Date.now()
        try {
          const userId = currentUserId(request)
          const stamp = await cycleStamp()
          const world = await getWorld(userId, 0)
          return Response.json({
            ok: true,
            userId,
            stamp,
            sections: Object.entries(world.sections).map(([key, s]) => ({ key, total: s.total, ids: s.ids.length })),
            stories: world.stories.length,
            ms: Date.now() - started,
          })
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err), stack: (err as Error)?.stack?.split('\n').slice(0, 6) },
            { status: 500 },
          )
        }
      }

      return new Response('Not found', { status: 404 })
    })
  },
} satisfies ExportedHandler<Env>
