import { expect, test, type Page } from '@playwright/test';

/**
 * The one suite that lets the service worker run, and the one served by the
 * OpenNext artifact rather than `next start`.
 *
 * Both are necessary. requests.spec.ts blocks the worker because a cache in
 * front of the network hides the requests a budget counts; here the cache is
 * the subject. And the document cache is keyed on /BUILD_ID, which only exists
 * at that URL in the built worker's assets — under `next start` docs() reads a
 * 404, returns null, and nothing below this line can happen at all.
 */
test.use({ serviceWorkers: 'allow', baseURL: 'http://127.0.0.1:8787' });

const ORIGIN = 'http://127.0.0.1:8787';

async function controlled(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
}

/**
 * The worker's own fetches are invisible on the page — they surface on the
 * context, tagged with the service worker as their initiator. A response's
 * fromServiceWorker() would read the same whether or not one was made.
 */
function revalidations(page: Page, paths: string[]) {
  const seen: string[] = [];
  page.context().on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== ORIGIN || u.searchParams.has('_rsc')) return;
    if (r.serviceWorker() && paths.some((p) => u.pathname === p)) seen.push(u.pathname);
  });
  return seen;
}

test('a cached shell is not asked about again', async ({ page }) => {
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === ORIGIN ? r.continue() : r.abort());

  await page.goto('/');
  await controlled(page);
  // The cache is filled by the first visit the worker actually sees, so the
  // round that counts is the one after that.
  await page.goto('/');
  await page.goto('/c/technology');
  await page.waitForTimeout(2_000);

  const asked = revalidations(page, ['/', '/c/technology']);
  await page.goto('/');
  await page.goto('/c/technology');
  await page.waitForTimeout(2_500);

  // A shell under this build's key is prerendered output with no reader in it.
  // Asking the origin whether it changed spends an invocation to be handed the
  // same bytes, on the two most-visited routes in the app.
  expect(asked, `revalidated: ${asked.join(' ')}`).toEqual([]);
});

test('a dynamic page is still asked about', async ({ page }) => {
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === ORIGIN ? r.continue() : r.abort());

  await page.goto('/');
  await controlled(page);
  await page.goto('/saved');
  await page.waitForTimeout(2_000);

  const asked = revalidations(page, ['/saved']);
  await page.goto('/saved');
  await page.waitForTimeout(2_500);

  // /saved is force-dynamic and its HTML carries the reader's own list. Serving
  // it from a cache and leaving it there would show them somebody else's.
  expect(asked, 'a dynamic page must still reach the origin').toEqual(['/saved']);
});
