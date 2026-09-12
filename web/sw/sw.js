/*
 * Hand-written on purpose: the whole caching policy is a dozen lines of intent,
 * and a generated worker would bury it under a build step and a manifest that
 * has to be kept honest.
 *
 * Three policies, by what the thing is:
 *   · build output under /assets is content-hashed — cache first, forever
 *   · images go stale-while-revalidate — show instantly, then replace, because
 *     a photograph a day old is not wrong
 *   · /api/* is network-first, and the cache is only the offline answer
 *
 * VERSION is substituted at build time from the hashes of the built assets, so
 * it moves when the app moves and not when somebody rebuilds an unchanged
 * tree. It is also what makes this file differ between deploys, which is what
 * lets the browser's own update cycle fire at all - see ServiceWorker.tsx.
 */
const VERSION = '__SW_VERSION__';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const MEDIA = 'media-v1';   // content is not build-specific; the name must not be either
const KEEP = new Set([SHELL, DATA, MEDIA]);

/**
 * The document, and the only one there is.
 *
 * This is where the Next worker needed its docs-<BUILD_ID> apparatus. There,
 * every route was its own HTML page naming the content-hashed chunks of one
 * build, so a cached page served after a deploy asked for scripts that were no
 * longer there and the app rendered but never hydrated.
 *
 * An SPA has one document for every route, and it names hashed assets that are
 * cached here alongside it under the same version. A stale shell is therefore
 * not broken, only old: it and its assets are a complete, working, earlier copy
 * of the app. That is what the build-id scheme was trying to buy, and hashed
 * filenames give it away for free.
 *
 * '/' and not '/index.html'. Cloudflare's asset server answers /index.html with
 * a 307 to /, so fetching that name yields a response with its redirected flag
 * set - and a navigation request answered with a redirected response fails the
 * navigation outright, ERR_FAILED, no page at all. The first visit hid it: the
 * cache was empty, so the shell stored was the clean 200 for /, and only the
 * next install overwrote it with the redirected one.
 */
const SHELL_URL = '/';

/** Roughly a few hundred article photographs — many days of reading, and small
 *  enough that the browser is never tempted to evict the origin entire. */
const MEDIA_MAX = 300;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try {
      const shell = await caches.open(SHELL);
      await shell.addAll([SHELL_URL, '/manifest.webmanifest', '/icon.svg']);
    } catch { /* a worker with nothing precached still works */ }
  })());
  // Deliberately no skipWaiting(). A new worker waits, which is the whole
  // signal UpdateBanner shows the reader; it takes over when they accept.
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** The page asking to be taken over, which only happens on Refresh. */
self.addEventListener('message', (e) => {
  if (e.data === 'sn:skip-waiting') void self.skipWaiting();
});

async function swr(e, req, cacheName, maxAgeMs) {
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
  // subtraction is NaN, and `NaN || 0` is 0 — so reading a missing Date header
  // as brand new would skip the refresh entirely. Same-origin responses always
  // carry one; opaque cross-origin images expose no headers at all.
  if (hit) {
    const at = Date.parse(hit.headers.get('date') || '');
    const age = Number.isNaN(at) ? Infinity : Date.now() - at;
    // waitUntil, not a bare promise: a refresh dropped on the floor is work the
    // browser is free to kill the moment respondWith settles.
    if (!maxAgeMs || age >= maxAgeMs) e.waitUntil(network.catch(() => {}));
    return hit;
  }
  return network;
}

/**
 * Keep a cache from growing without end.
 *
 * Only names are cleaned on activate, and MEDIA never changes name, so left
 * alone it would hold every story photograph the reader had ever scrolled past
 * and grow until the browser evicted this origin's storage wholesale — which
 * would take the shell with it, so the failure lands on the one thing the cache
 * exists to protect.
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
    if (request.destination === 'image') e.respondWith(swr(e, request, MEDIA, 86_400_000));
    return;
  }

  // Content-hashed, so a hit can never be the wrong bytes.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      // waitUntil: put() returns a promise, and one left unawaited inside
      // respondWith is cut short when the worker is terminated - which is why
      // nothing but the precache was ever landing here.
      if (res.ok) e.waitUntil(c.put(request, res.clone()));
      return res;
    }));
    return;
  }

  // /api/* is network-first, and the cache here is only the offline answer.
  //
  // Not stale-while-revalidate: that would be a third cache guessing at
  // freshness underneath two that know. The client holds the world in
  // IndexedDB against the cycle stamp and does not ask at all while the stamp
  // is unchanged, so by the time a request reaches here it is one we actually
  // want the answer to.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) e.waitUntil((await caches.open(DATA)).put(request, res.clone()));
        return res;
      } catch {
        const hit = await (await caches.open(DATA)).match(request);
        if (hit) return hit;
        throw new Error('offline and uncached');
      }
    })());
    return;
  }

  if (request.destination === 'image') { e.respondWith(swr(e, request, MEDIA, 86_400_000)); return; }

  /*
   * Every navigation is the same shell, so it is answered from storage and
   * revalidated behind the reader.
   *
   * This is the request the Next worker could not safely cache. Here the shell
   * and the hashed assets it names live in one cache under one version, so a
   * cached pair is always internally consistent; a newer deploy arrives as a
   * waiting worker rather than as a half-updated page.
   */
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(SHELL_URL);
      // A redirected response is unusable here whatever its body says, so an
      // old cache holding one is treated as a miss rather than as a page.
      const hit = cached && !cached.redirected ? cached : null;
      if (cached && cached.redirected) await cache.delete(SHELL_URL);

      if (hit) {
        e.waitUntil(fetch(SHELL_URL)
          .then((res) => (res.ok && !res.redirected
            ? cache.put(SHELL_URL, res.clone()) : undefined))
          .catch(() => {}));
        return hit;
      }

      try {
        const res = await fetch(request);
        // A daily limit answers 429 or 503 — a response, not a throw, so
        // returning it blindly would hand the reader an error page while a
        // good copy sat in the cache.
        if (res.ok && !res.redirected) {
          e.waitUntil(cache.put(SHELL_URL, res.clone()));
          return res;
        }
        if (res.ok) return res;
        return (await cache.match(SHELL_URL)) ?? res;
      } catch {
        return (await cache.match(SHELL_URL)) ?? Response.error();
      }
    })());
  }
});
