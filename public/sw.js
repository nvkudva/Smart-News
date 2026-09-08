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
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const MEDIA = `media-${VERSION}`;
const KEEP = new Set([SHELL, DATA, MEDIA]);

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

  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });

  // A hit answers immediately and the refresh runs behind it. Only the age is
  // consulted to decide whether to bother refreshing at all.
  if (hit) {
    const age = Date.now() - Date.parse(hit.headers.get('date') || '') || 0;
    if (!maxAgeMs || age >= maxAgeMs) network.catch(() => {});
    return hit;
  }
  return network;
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

  if (url.pathname.startsWith('/api/')) { e.respondWith(swr(request, DATA, 60_000)); return; }
  if (request.destination === 'image') { e.respondWith(swr(request, MEDIA, 86_400_000)); return; }

  // The category pages carry no data of their own any more: the strip, the
  // highlight and the bar are the same bytes every time, and the rows come
  // from /api/section. So the shell can be answered from cache and refreshed
  // behind the reader, which is what makes the second tap on a category feel
  // like nothing happened. This covers both the document and the ?_rsc=
  // payload the client router asks for on a soft navigation.
  if (url.pathname === '/' || url.pathname.startsWith('/c/')) {
    e.respondWith(swr(request, SHELL, 300_000));
    return;
  }

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
