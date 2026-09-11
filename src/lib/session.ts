import { cookies } from 'next/headers';

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
 * The current reader's id. Middleware sets the cookie on the way in, so by the
 * time a route runs it is normally there; a request that somehow arrives
 * without one reads the defaults rather than failing, and writes nothing.
 */
export async function currentUserId(): Promise<string> {
  try {
    const v = (await cookies()).get(COOKIE)?.value;
    return looksLikeUserId(v) ? v : SYSTEM_USER;
  } catch {
    return SYSTEM_USER;   // called outside a request scope
  }
}
