import { notFound } from '@tanstack/react-router';

/**
 * One GET, for a route loader.
 *
 * The pages these serve were force-dynamic server renders, so their data
 * arrived with the document and a failure was a server error page. Here the
 * loader throws and the router shows the route's errorComponent, which is the
 * same bargain a Suspense boundary made - only the boundary is now declared on
 * the route rather than nested in the markup.
 *
 * Same-origin and credentialed by default, so sn_uid rides along and the
 * Worker resolves the reader exactly as it does for /api/world.
 */
export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  // 404 is the router's, not an error: the Worker answers it for a story id
  // that is not in the feed, and notFound() renders the route's own screen.
  if (res.status === 404) throw notFound();
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}
