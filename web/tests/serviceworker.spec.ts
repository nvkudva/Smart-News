import { expect, test, type Page } from '@playwright/test';

/**
 * The one suite that lets the service worker run.
 *
 * requests.spec.ts blocks it, because a cache in front of the network hides
 * the requests a budget counts. Here the cache is the subject.
 *
 * What it is testing changed shape with the SPA. The Next worker keyed its
 * document cache on /BUILD_ID, because every route was a separate HTML page
 * naming one build's chunks, and a page served to the wrong build rendered
 * without ever hydrating. There is one document now, and it names hashed
 * assets - so the question is no longer "which build does this page belong
 * to" but "is the set complete". The first test is that question, and it is a
 * regression test: shipping a shell precached without its assets took
 * production down to a blank page, because the hashes it named were gone from
 * the next deploy and not_found_handling answered those .js requests with
 * index.html.
 */
test.use({ serviceWorkers: 'allow' });

const ORIGIN = 'http://localhost:4178';

async function controlled(page: Page) {
  await page.waitForFunction(
    () => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
}

/** Same-origin only: a hung publisher image never lets the page go idle. */
async function sameOriginOnly(page: Page) {
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === ORIGIN ? r.continue() : r.abort());
}

type Held = Record<string, string[]>;

async function caches_(page: Page): Promise<Held> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      out[name] = (await c.keys()).map((r) => new URL(r.url).pathname);
    }
    return out;
  });
}

test('the shell is precached with every asset it names', async ({ page }) => {
  await sameOriginOnly(page);
  await page.goto('/');
  await controlled(page);
  // The precache is install work; a claimed page can still be a beat ahead of it.
  await page.waitForTimeout(3_000);

  const held = await caches_(page);
  const shell = Object.entries(held).find(([k]) => k.startsWith('shell-'))?.[1] ?? [];

  expect(shell, `shell cache: ${Object.keys(held).join(' ')}`).toContain('/');

  // Every module and stylesheet the document references has to be in the same
  // cache as the document. This is the assertion that would have caught the
  // blank page: a shell whose assets were only cached lazily asks the next
  // deploy for hashes it no longer serves.
  const referenced = await page.evaluate(() => [
    ...[...document.querySelectorAll('script[src]')].map((e) => new URL((e as HTMLScriptElement).src).pathname),
    ...[...document.querySelectorAll('link[rel=stylesheet][href]')].map((e) => new URL((e as HTMLLinkElement).href).pathname),
  ]);
  expect(referenced.length, 'the document should reference at least one asset').toBeGreaterThan(0);
  expect(referenced.filter((p) => !shell.includes(p)), `missing from precache: shell holds ${shell.length}`)
    .toEqual([]);
});

test('a navigation is answered from the cache, not the origin', async ({ page }) => {
  await sameOriginOnly(page);
  await page.goto('/');
  await controlled(page);
  await page.waitForTimeout(2_000);

  // A deep link the reader has never opened: the shell answers for every route,
  // so this is served from storage without the network being touched at all.
  await page.goto('/c/technology');
  await page.waitForTimeout(1_500);

  const delivery = await page.evaluate(() =>
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.deliveryType);
  expect(delivery, 'navigation should come from cache-storage').toBe('cache-storage');
});

test('only this version of the caches survives', async ({ page }) => {
  await sameOriginOnly(page);

  // A cache from an older deploy, and one from something else entirely on the
  // same origin. activate drops everything it does not KEEP.
  await page.goto('/');
  await controlled(page);
  await page.evaluate(async () => {
    await caches.open('shell-deadbeef0000');
    await caches.open('somebody-elses-cache');
    // Unregister so the reload installs a worker rather than reusing the
    // running one. activate fires when a worker takes over and at no other
    // time, so a plain reload leaves the cleanup untested - and unregistering
    // deliberately leaves the caches behind for it to find.
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  });

  await page.reload();
  await controlled(page);
  await page.waitForTimeout(3_000);

  const names = Object.keys(await caches_(page));
  expect(names.filter((n) => n === 'shell-deadbeef0000' || n === 'somebody-elses-cache'),
    `left behind: ${names.join(' ')}`).toEqual([]);
  // What remains is one version's worth, and nothing else.
  expect(names.filter((n) => n.startsWith('shell-')).length, `shell caches: ${names.join(' ')}`).toBe(1);
});

test('an asset that is gone is refused rather than cached as HTML', async ({ page }) => {
  await sameOriginOnly(page);
  await page.goto('/');
  await controlled(page);
  await page.waitForTimeout(2_000);

  // A hash from a build that no longer exists. not_found_handling answers it
  // with index.html, and the worker has to refuse that: handing HTML to a
  // module request is the MIME error that blanked the page, and caching it
  // would make the failure permanent.
  const status = await page.evaluate(async () => {
    const res = await fetch('/assets/index-GONE0000.js');
    return { status: res.status, type: res.headers.get('content-type') };
  });
  expect(status.status, 'a dead asset must not be served as the shell').not.toBe(200);

  const held = await caches_(page);
  const shell = Object.entries(held).find(([k]) => k.startsWith('shell-'))?.[1] ?? [];
  expect(shell.filter((p) => p.includes('GONE0000')), 'a dead asset must not be cached').toEqual([]);
});

test('/api is answered from the network while online', async ({ page }) => {
  await sameOriginOnly(page);
  await page.goto('/');
  await controlled(page);
  await page.waitForTimeout(2_000);

  // The cache under /api/* is the offline answer and nothing else: the client
  // already holds the world in IndexedDB against the cycle stamp and does not
  // ask while the stamp is unchanged, so a request that does reach here is one
  // whose answer we actually want.
  const fromNetwork = await page.evaluate(async () => {
    await fetch('/api/stamp');
    const e = performance.getEntriesByType('resource')
      .filter((r) => new URL(r.name).pathname === '/api/stamp')
      .pop() as PerformanceResourceTiming | undefined;
    return e?.deliveryType ?? '(network)';
  });
  expect(fromNetwork, 'a live /api read must not come from cache-storage').not.toBe('cache-storage');
});
