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
 * Named routes rather than everything-but: the list of pages that need the
 * reader's id while they render is short, and it is now the minority.
 *
 * / and /c/* are prerendered shells. They hold nothing belonging to a reader
 * and are served straight out of static assets without invoking the Worker at
 * all — putting them through middleware to hand them a cookie they never read
 * would spend an invocation to undo the reason they were built that way. Their
 * rows come from /api/*, which does run this, so a first-time visitor is given
 * an id by the first call the page makes.
 *
 * Everything below is force-dynamic and already costs an invocation, and every
 * one of them reads prefs or saved state on the server.
 */
export const config = {
  matcher: [
    '/api/:path*',
    '/story/:path*',
    '/explore',
    '/local',
    '/profile',
    '/saved',
    '/reels',
  ],
};
