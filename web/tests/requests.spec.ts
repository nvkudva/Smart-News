import { expect, test, type Page } from '@playwright/test';

/**
 * What a page costs, in Cloudflare Worker invocations.
 *
 * A prefetch loop in the category strip once spent the account's whole
 * hundred-thousand daily allowance in an afternoon, and nothing in tsc, the
 * build or the schema check could see it — a budget can.
 *
 * The accounting got simpler with the SPA, and the reason is worth stating
 * because every number below depends on it. run_worker_first in wrangler.jsonc
 * scopes the Worker to /api/*: the shell, every hashed asset and every deep
 * link are served straight from static assets, which are free and uncounted.
 * So a request to this origin is billable if and only if its path starts with
 * /api/. The Next tree had to count RSC payloads and documents too, and that
 * whole column is gone - measured at the cutover, ten deep-link page views
 * cost zero invocations.
 *
 * The ceilings are deliberately exact rather than generous. "No requests at
 * all" is a claim that cannot quietly drift; "a few" is one that can.
 */

const ORIGIN = 'http://localhost:4178';

type Tally = { api: string[]; other: string[] };

async function watch(page: Page): Promise<Tally> {
  // Story photographs come from the publishers, and a hung request to one of
  // them is not this suite's business — it also never lets the page go idle.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === ORIGIN ? route.continue() : route.abort();
  });

  const tally: Tally = { api: [], other: [] };
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return;
    if (url.pathname.startsWith('/api/')) tally.api.push(url.pathname);
    else tally.other.push(url.pathname);   // free: shell, assets, icons
  });
  return tally;
}

const clear = (t: Tally) => { t.api.length = 0; t.other.length = 0; };
const count = (paths: string[], prefix: string) => paths.filter((p) => p.startsWith(prefix)).length;

/** A rendered card, then a quiet moment — not `networkidle`, which a blocked
 *  publisher image can hold open forever. */
async function settle(page: Page) {
  await page.waitForSelector('a[href^="/story/"]', { timeout: 30_000 });
  await page.waitForTimeout(1_500);
}

test('a cold feed costs one answer for the world and nothing per section', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);

  // Fourteen sections, one payload. The whole point of /api/world replacing
  // the per-section routes is that the bodies overlap.
  expect(count(t.api, '/api/world'), `world: ${t.api.join(' ')}`).toBe(1);
  expect(count(t.api, '/api/stamp'), `stamp: ${t.api.join(' ')}`).toBe(1);
  expect(count(t.api, '/api/place'), `place: ${t.api.join(' ')}`).toBeLessThanOrEqual(1);
  // /api/section/[cat] and /api/stories are retired; nothing may bring them back.
  expect(t.api.filter((p) => !/^\/api\/(world|stamp|place)$/.test(p))).toEqual([]);
});

test('a deep link costs no invocation for the page itself', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/c/india');
  await settle(page);

  // The document and its chunks are static assets. If this ever starts costing
  // an invocation, run_worker_first has been widened or removed and every page
  // view in the app is being billed again.
  expect(t.other.some((p) => p === '/' || p.startsWith('/assets/'))).toBe(true);
  expect(count(t.api, '/api/world'), `world: ${t.api.join(' ')}`).toBe(1);
});

test('switching category costs nothing', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);

  clear(t);
  await page.locator('.catlink[data-cat="science"]').click();
  await expect(page).toHaveURL(/\/c\/science/);
  await page.waitForTimeout(1_500);

  // The rows are already in the world payload this tab is holding, and the
  // shell is the same document - so a category is a client-side state change
  // with nothing behind it.
  expect(t.api, `api: ${t.api.join(' ')}`).toEqual([]);
});

test('filtering by sub-category asks for nothing', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/c/technology');
  await settle(page);

  // Scoped to this category's own pills. CategoryPager keeps a window of
  // sections in the DOM, so an unscoped .subpill matches the neighbours too -
  // and the first match was a pill in the off-screen business section, which
  // resolves fine and can never be clicked.
  const pill = page.locator('.substrip a.subpill[href^="/c/technology?sub="]').first();
  clear(t);
  await pill.click();
  await page.waitForTimeout(1_500);

  // ?sub= is a filter over rows already held, declared in the route's
  // validateSearch. It changes the URL and nothing else.
  expect(t.api, `api: ${t.api.join(' ')}`).toEqual([]);
});

test('a page left open asks for nothing', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);
  clear(t);

  // Well short of the fifteen-minute refresh, and long enough that anything
  // running on a timer or re-firing on a render would show up.
  await page.waitForTimeout(10_000);

  expect(t.api, `api: ${t.api.join(' ')}`).toEqual([]);
});

test('a second visit does not re-ask where the reader is', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);
  clear(t);

  // The line is the reader's preferences read through the gazetteer, and the
  // gazetteer only moves on a sync — which is what moves the cycle stamp.
  await page.reload();
  await settle(page);

  expect(count(t.api, '/api/place'), `api: ${t.api.join(' ')}`).toBe(0);
});

test('Top has one address, and the sub-strip agrees about it', async ({ page }) => {
  await watch(page);
  await page.goto('/');
  await settle(page);

  // Built from the slug alone this said /c/top — the same rows under a second
  // URL, which is now also a second entry in the router's route tree.
  const hrefs = await page.locator('.subpill').evaluateAll(
    (els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(1);
  expect(hrefs.filter((h) => h?.startsWith('/c/top'))).toEqual([]);
});

test('returning to the feed does not re-ask for the world', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);

  clear(t);
  await page.locator('a[href="/saved"]').first().click();
  await expect(page).toHaveURL(/\/saved/);
  await page.waitForTimeout(1_000);
  await page.locator('a[href="/"]').first().click();
  await settle(page);

  // Held in IndexedDB against the cycle stamp, which has not moved, so leaving
  // and coming back is free. /api/saved is its own cost and not this one.
  expect(count(t.api, '/api/world'), `api: ${t.api.join(' ')}`).toBe(0);
});
