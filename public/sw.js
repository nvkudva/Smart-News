/*
 * Hand-written on purpose: the whole caching policy is twelve lines of intent,
 * and a generated worker would bury it under a build step and a manifest that
 * has to be kept honest.
 *
 * Three policies, by what the thing is:
 *   · build output under /_next/static is content-hashed — cache first, forever
 *   · section data and images go stale-while-revalidate — show instantly, then
 *     replace, because a headline a minute old is not wrong
 *   · documents go network first with a cached fallback, so an offline open
 *     lands on the last page seen rather than the browser's error
 */
const VERSION = 'v4';   // bumped: /api/* is no longer cached here, see below
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const MEDIA = `media-${VERSION}`;
const KEEP = new Set([SHELL, DATA, MEDIA]);

/** Roughly a few hundred article photographs — many days of reading, and small
 *  enough that the browser is never tempted to evict the origin entire. */
const MEDIA_MAX = 300;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
    .then(() => self.skipWaiting())
    .catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function swr(req, cacheName, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);

  const network = fetch(req).then(async (res) => {
    if (res.ok) {
      await cache.put(req, res.clone());
      if (cacheName === MEDIA) await trim(MEDIA, MEDIA_MAX);
    }
    return res;
  });

  // A hit answers immediately and the refresh runs behind it. Only the age is
  // consulted to decide whether to bother refreshing at all.
  //
  // An unknown age is stale, not fresh. `Date.parse('')` is NaN, the
  // subtraction is NaN, and `NaN || 0` is 0 — so the old line read a missing
  // Date header as brand new and skipped the refresh entirely. Same-origin
  // responses always carry one; opaque cross-origin images expose no headers
  // at all, so every publisher photograph was cached and never looked at again.
  if (hit) {
    const at = Date.parse(hit.headers.get('date') || '');
    const age = Number.isNaN(at) ? Infinity : Date.now() - at;
    if (!maxAgeMs || age >= maxAgeMs) network.catch(() => {});
    return hit;
  }
  return network;
}

/**
 * Keep a cache from growing without end.
 *
 * Only names are cleaned on activate, and MEDIA never changes name, so it held
 * every story photograph the reader had ever scrolled past. Left alone it grows
 * until the browser evicts this origin's storage wholesale — which takes the
 * shell and the offline fallback with it, so the failure lands on the one thing
 * the cache exists to protect.
 *
 * Insertion order is FIFO in the Cache API, so the oldest keys are simply the
 * first ones.
 */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Story photographs come from the publishers. Worth keeping; not worth
    // letting a slow host hold up a card that has everything else it needs.
    if (request.destination === 'image') e.respondWith(swr(request, MEDIA, 86_400_000));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok) c.put(request, res.clone());
      return res;
    }));
    return;
  }

  // /api/* is network-first now, and the cache here is only the offline answer.
  //
  // It used to be stale-while-revalidate on a sixty-second clock, which was a
  // third cache guessing at freshness underneath two that know: the client
  // holds each section in IndexedDB against the cycle stamp and does not ask
  // at all while the stamp is unchanged, so by the time a request reaches here
  // it is one we actually want the answer to.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) (await caches.open(DATA)).put(request, res.clone());
        return res;
      } catch {
        const hit = await (await caches.open(DATA)).match(request);
        if (hit) return hit;
        throw new Error('offline and uncached');
      }
    })());
    return;
  }
  if (request.destination === 'image') { e.respondWith(swr(request, MEDIA, 86_400_000)); return; }

  // Documents are network-first, and this is not negotiable: an HTML page names
  // the exact hashed chunks of the build that produced it, so a cached one
  // served after a deploy asks for scripts that 404 and the page never
  // hydrates. It looks like a working page that ignores every tap. The cache
  // is the offline fallback and nothing else.
  //
  // The ?_rsc= payloads the client router fetches on a soft navigation are the
  // same bargain, and are excluded for the same reason.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
        return res;
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error();
      }
    })());
  }
});
