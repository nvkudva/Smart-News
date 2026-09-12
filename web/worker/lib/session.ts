/**
 * Who is asking.
 *
 * Every reader used to be the string 'local'. That was fine while this was one
 * person's reader and wrong the moment it was reachable: one prefs row shared
 * by everyone, so any visitor's save re-ranked every other visitor's feed, and
 * one saved list they could all edit.
 *
 * No login yet. A visitor is a random id in a cookie, which is enough to give
 * them their own preferences and to hand the same ones back when they return.
 * It identifies a browser, not a person — clearing cookies starts over, and a
 * second device is a second reader. Google sign-in is the next step; see the
 * TODO in README.
 *
 * Ported from the Next tree, where currentUserId() read the cookie jar through
 * next/headers and middleware.ts minted the id. A Worker has neither, so the
 * id arrives as an argument and issue() returns the header that sets it.
 */
export const COOKIE = 'sn_uid';

/** A year: long enough that a reader's settings survive a holiday. */
export const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * `local` stays the id used by the pipeline and by anything running outside a
 * request — scripts have no cookie jar, and their prefs are the seed defaults.
 */
export const SYSTEM_USER = 'local';

/** 22 chars of base64url from 16 random bytes. Not a secret and not a
 *  capability: it names a preferences row and nothing else. */
export function newUserId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cheap sanity check before the value reaches a query. */
export function looksLikeUserId(v: string | undefined): v is string {
  return !!v && v.length >= 16 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
}

/**
 * One cookie out of a Cookie header.
 *
 * Not a general parser: it splits on `;` and takes everything after the first
 * `=`, which is right for an id of base64url and would be wrong for a value
 * holding a quoted string or an escaped separator.
 */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * The current reader's id.
 *
 * A request that arrives without a usable cookie reads the defaults rather
 * than failing, and writes nothing — same as the Next version. Minting a new
 * id is issue()'s job, not this one's, so a read stays a read.
 */
export function currentUserId(request: Request): string {
  const v = readCookie(request, COOKIE);
  return looksLikeUserId(v) ? v : SYSTEM_USER;
}

/**
 * The Set-Cookie header for a reader who arrived without one.
 *
 * Lax rather than Strict: a reader following a shared link should still be
 * recognised. Not HttpOnly — no client code reads it today, but the id is not
 * a secret and marking it so would only misstate what it protects.
 */
export function issue(id: string): string {
  return `${COOKIE}=${id}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}
