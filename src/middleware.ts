import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, COOKIE_MAX_AGE, looksLikeUserId, newUserId } from '@/lib/session';

/**
 * Give every visitor an id, once.
 *
 * It has to happen here because a Server Component cannot set a cookie — only
 * middleware, a Route Handler or a Server Action can — and the first thing a
 * new reader does is render a page, not submit a form.
 *
 * httpOnly: nothing in the browser needs to read it, and the less script can
 * touch it the better. Lax rather than Strict so arriving from a shared link
 * still carries the reader's own settings.
 */
export function middleware(req: NextRequest) {
  if (looksLikeUserId(req.cookies.get(COOKIE)?.value)) return NextResponse.next();

  const id = newUserId();
  // Also on the request, so the very first render sees the same id the browser
  // is about to be given rather than falling back to the defaults.
  req.cookies.set(COOKIE, id);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(COOKIE, id, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
    secure: req.nextUrl.protocol === 'https:',
  });
  return res;
}

/**
 * Static assets are the point of the prerendered shells — routing them through
 * middleware would spend a Worker invocation on each and undo that.
 *
 * /c/* is skipped for the same reason and is the only page route that can be:
 * it is the one prerendered page, it holds nothing belonging to a reader, and
 * the section data it draws comes from /api/*, which does run this. Every other
 * page is force-dynamic and already costs an invocation, so naming it here adds
 * nothing — and those are exactly the ones whose first render needs the id.
 */
export const config = {
  matcher: ['/((?!c/|_next/static|_next/image|cdn-cgi|favicon.ico|icon|splash|manifest.webmanifest|sw.js|BUILD_ID).*)'],
};
