/*
 * Hand-written on purpose: the whole caching policy is twelve lines of intent,
 * and a generated worker would bury it under a build step and a manifest that
 * has to be kept honest.
 *
 * Three policies, by what the thing is:
 *   · build output under /_next/static is content-hashed — cache first, forever
 *   · section data and images go stale-while-revalidate — show instantly, then
 *     replace, because a headline a minute old is not wrong
 *   · documents come from a cache named after the build that wrote them, so a
 *     page can only ever be handed to the build whose chunks it names
 */
const VERSION = 'v5';   // bumped: shells are served without a revalidation
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const MEDIA = `media-${VERSION}`;
const KEEP = new Set([SHELL, DATA, MEDIA]);

/**
 * Documents get a cache named after the build that produced them.
 *
 * An HTML page names the exact content-hashed chunks of its own build, so a
 * cached one served after a deploy asks for scripts that are no longer there
 * and the page renders but never hydrates — a screen that looks right and
 * ignores every tap. That is why documents were network-first and never read
 * except when the network threw.
 *
 * Keyed on /BUILD_ID the hazard disappears: a cached page can only ever be
 * handed to the build that wrote it, because a new build reads a different
 * cache and drops every other one on activate. Then serving a story from
 * storage is simply correct, which is what it should have been all along —
 * the words in a story do not change after it is filed.
 */
let buildId;
async function docs() {
  if (buildId === undefined) {
    buildId = await fetch('/BUILD_ID', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => (t && /^[\w-]{1,64}$/.test(t.trim()) ? t.trim() : null))
      // In development /BUILD_ID is the not-found page. No id, no document
      // cache, and the old network-first behaviour is what is left.
      .catch(() => null);
  }
  return buildId ? caches.open(`docs-${buildId}`) : null;
}

/**
 * The prerendered shells. Both are build output with no reader and no rows in
 * them — every story on them arrives from /api/world, validated against the
 * cycle stamp — so within one build they are the same bytes for everybody.
 */
const isShell = (url) => url.pathname === '/' || url.pathname.startsWith('/c/');

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
  e.waitUntil((async () => {
    await docs();   // learn this build's name before deciding what is rubbish
    const mine = buildId ? `docs-${buildId}` : null;
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => !KEEP.has(k) && k !== mine)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
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

  // An HTML page names the exact hashed chunks of the build that produced it,
  // so a cached one served after a deploy asks for scripts that 404 and the
  // page renders but never hydrates. The docs-<build> key is what makes that
  // impossible: a page can only be handed to the build that wrote it.
  //
  // The ?_rsc= payloads the client router fetches on a soft navigation are not
  // cached here — they are the router's business and it versions them itself.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await docs();
      const hit = cache ? await cache.match(request) : null;
      if (hit) {
        // A shell held under this build's key cannot have changed: it is
        // prerendered output with no reader in it, and the cache dies with the
        // build. Re-fetching it spent a Worker invocation — on every view of
        // the two most-visited routes in the app — to be handed back the same
        // bytes. The dynamic pages do carry per-request state, so those still
        // refresh behind the reader.
        if (!isShell(url)) {
          void fetch(request)
            .then((res) => { if (res.ok) cache.put(request, res.clone()); })
            .catch(() => {});
        }
        return hit;
      }

      try {
        const res = await fetch(request);
        if (res.ok) {
          (cache ?? await caches.open(SHELL)).put(request, res.clone());
          return res;
        }
        // A daily limit answers 429 or 503 — a response, not a throw, so this
        // used to hand the reader the error page while holding a good copy.
        return (await fallback(request)) ?? res;
      } catch {
        return (await fallback(request)) ?? Response.error();
      }
    })());
  }
});

/** The last page we hold for this request, then the shell, then nothing. */
async function fallback(request) {
  const cache = await docs();
  const shell = await caches.open(SHELL);
  return (cache ? await cache.match(request) : null)
      ?? await shell.match(request)
      ?? await shell.match('/');
}
