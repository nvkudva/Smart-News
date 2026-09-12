import { ACTION_PATH } from '../shared/actions'
import { runAction } from './actions'
import { withRequestCache } from './lib/cache'
import { setD1 } from './lib/d1'
import { logError, requestContext, withLogContext } from './lib/log'
import { SYSTEM_USER, currentUserId, issue, newUserId } from './lib/session'
import * as read from './read'

/**
 * The write side: one path, the action named in the body.
 *
 * Never cached and never conditional - every one of these mutates the caller's
 * own prefs row and the answer is the new state, which is what lets the control
 * that called it render from the result rather than guess at it.
 */
async function action(request: Request, userId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405, headers: { allow: 'POST' } })
  }

  let body: { name?: unknown; args?: unknown }
  try {
    body = (await request.json()) as { name?: unknown; args?: unknown }
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const result = await runAction(userId, body.name, body.args)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

  // { value } rather than the bare answer: three of these resolve to void, and
  // Response.json(undefined) writes a body that will not parse.
  return Response.json({ value: result.value }, {
    headers: { 'cache-control': 'no-store' },
  })
}

function route(request: Request, url: URL, userId: string): Promise<Response> {
  const p = url.pathname

  if (p === ACTION_PATH) return action(request, userId)
  if (p === '/api/stamp') return read.stamp(request)
  if (p === '/api/world') return read.world(request, url, userId)
  if (p === '/api/place') return read.place(request, userId)
  if (p === '/api/local') return read.local(request, userId)
  if (p === '/api/saved') return read.saved(request, userId)
  if (p === '/api/reels') return read.reels(request, userId)
  if (p === '/api/explore') return read.explore(request, url)
  if (p === '/api/profile') return read.profile(request, userId)
  if (p.startsWith('/api/story/')) return read.story(request, url, userId)

  return Promise.resolve(new Response('Not found', { status: 404 }))
}

export default {
  async fetch(request, env) {
    setD1(env.DB)

    const url = new URL(request.url)

    return withLogContext(requestContext(request, url), () => withRequestCache(async () => {

      // Everything else is a static asset. run_worker_first in wrangler.jsonc
      // scopes this Worker to /api/*, so a page view never arrives here.
      if (!url.pathname.startsWith('/api/')) {
        return new Response('Not found', { status: 404 })
      }

      // Give every visitor an id, once. middleware.ts did this in the Next
      // tree; resolving it here means the handlers below and the cookie the
      // browser is about to be given cannot disagree, which is what that
      // middleware needed its req.cookies.set() to achieve.
      const held = currentUserId(request)
      const minted = held === SYSTEM_USER ? newUserId() : null
      const userId = minted ?? held

      try {
        const response = await route(request, url, userId)
        if (!minted) return response

        const headers = new Headers(response.headers)
        headers.append('set-cookie', issue(minted, url.protocol === 'https:'))
        return new Response(response.body, { status: response.status, headers })
      } catch (err) {
        // The boundary. Without it a thrown handler returns Cloudflare's own
        // error page - HTML, to a caller that asked for JSON, with nothing on
        // our side saying what happened. Cloudflare records the exception
        // either way; this is what makes the answer usable and names the route.
        //
        // Nothing from the error reaches the client: the message could name a
        // column or a query, and the reader can do nothing with either.
        logError('request.unhandled', err)
        return Response.json({ error: 'Internal server error' }, {
          status: 500,
          headers: { 'cache-control': 'no-store' },
        })
      }
    }))
  },
} satisfies ExportedHandler<Env>
