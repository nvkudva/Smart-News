import { withRequestCache } from './lib/cache'
import { cacheHeaders, conditional, notModified } from './lib/cycle'
import { setD1 } from './lib/d1'
import { effectivePlaceIds, getPrefs, prefsFingerprint } from './lib/feed'
import { getPlaces } from './lib/places'
import { SYSTEM_USER, currentUserId, issue, newUserId } from './lib/session'
import { getWorld } from './lib/world'

const REGION = new Intl.DisplayNames(['en'], { type: 'region' })
const countryName = (code: string) => {
  try { return REGION.of(code) ?? code } catch { return code }
}

/**
 * The version of the readable world, on its own.
 *
 * One memoised row read, and the only call a returning reader has to make: if
 * the stamp it answers with is the one they already hold, everything in their
 * IndexedDB is current and nothing else needs asking for. Public and unscoped —
 * it is the same fact for everyone, with no reader in it.
 */
async function stamp(request: Request): Promise<Response> {
  const version = await conditional(request, 'stamp')
  const headers = {
    ...cacheHeaders(version, 15, 300),
    'cache-control': 'public, max-age=15, stale-while-revalidate=300',
  }
  if (version.fresh) return notModified(headers)
  return Response.json({ stamp: version.stamp }, { headers })
}

/**
 * The one request a reader makes per cycle.
 *
 * The bodies are the same pool under every heading, so fourteen answers that
 * overlap become one that does not. A returning reader sends `since` and gets
 * back the three or four stories the last pipeline run produced.
 */
async function world(request: Request, url: URL, userId: string): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? 0) || 0

  // The bodies are the same for everyone; the fourteen orderings are not, and
  // three of them rank against the reader's preferences. The fingerprint is
  // what keeps two readers' answers off each other's validator.
  const scope = `world.${since}.${prefsFingerprint(await getPrefs(userId))}`
  const version = await conditional(request, scope)
  const headers = cacheHeaders(version, 15, 300)
  if (version.fresh) return notModified(headers)

  return Response.json(await getWorld(userId, since), { headers })
}

/** The one line of the header that cannot be static. */
async function place(request: Request, userId: string): Promise<Response> {
  const prefs = await getPrefs(userId)

  // Varies by the reader's own prefs, and by the gazetteer underneath them —
  // which only ever changes on a sync, which is what moves the cycle stamp.
  const version = await conditional(request, `place.${prefsFingerprint(prefs)}`)
  const headers = cacheHeaders(version, 60, 600)
  if (version.fresh) return notModified(headers)

  const places = await getPlaces(effectivePlaceIds(prefs).slice(0, 1))
  // A canonical place if there is one — named as the reader would write it,
  // city and two-letter country, not the full administrative label — the
  // reader's own words if that is all they gave us, and the country last.
  const found = places[0]
  const here = found
    ? `${found.name}, ${found.country}`
    : prefs.places[0] ?? countryName(prefs.country)
  return Response.json({ stamp: version.stamp, here }, { headers })
}

export default {
  async fetch(request, env) {
    setD1(env.DB)

    return withRequestCache(async () => {
      const url = new URL(request.url)

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

      const response = await (
        url.pathname === '/api/stamp' ? stamp(request)
        : url.pathname === '/api/world' ? world(request, url, userId)
        : url.pathname === '/api/place' ? place(request, userId)
        : Promise.resolve(new Response('Not found', { status: 404 }))
      )

      if (!minted) return response

      const headers = new Headers(response.headers)
      headers.append('set-cookie', issue(minted, url.protocol === 'https:'))
      return new Response(response.body, { status: response.status, headers })
    })
  },
} satisfies ExportedHandler<Env>
