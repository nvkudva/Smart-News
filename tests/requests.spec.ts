import { expect, test, type Page } from '@playwright/test';

/**
 * What a page costs, in Cloudflare Worker invocations.
 *
 * Static assets are free and unlimited; everything counted here runs the
 * Worker. A prefetch loop in the category strip once spent the account's whole
 * hundred-thousand daily allowance in an afternoon, and nothing in tsc, the
 * build or the schema check could see it — a budget can.
 *
 * The ceilings are deliberately exact rather than generous. "No requests at
 * all" is a claim that cannot quietly drift; "a few" is one that can.
 */
type Tally = { api: string[]; rsc: string[]; doc: string[] };

const ORIGIN = 'http://127.0.0.1:3000';

async function watch(page: Page): Promise<Tally> {
  // Story photographs come from the publishers, and a hung request to one of
  // them is not this suite's business — it also never lets the page go idle.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === ORIGIN ? route.continue() : route.abort();
  });

  const tally: Tally = { api: [], rsc: [], doc: [] };
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return;
    const path = url.pathname;
    if (path.startsWith('/_next/static/') || path === '/sw.js') return;  // free assets

    if (path.startsWith('/api/')) tally.api.push(path);
    else if (url.searchParams.has('_rsc')) tally.rsc.push(path);
    else if (req.resourceType() === 'document') tally.doc.push(path);
  });
  return tally;
}

const clear = (t: Tally) => { t.api.length = 0; t.rsc.length = 0; t.doc.length = 0; };
const count = (paths: string[], prefix: string) => paths.filter((p) => p.startsWith(prefix)).length;

/** A rendered card, then a quiet moment — not `networkidle`, which a blocked
 *  publisher image can hold open forever. */
async function settle(page: Page) {
  await page.waitForSelector('a[href^="/story/"]', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

test('a cold feed costs one answer for the world and nothing per section', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);

  expect(count(t.api, '/api/world'), `world: ${t.api.join(' ')}`).toBe(1);
  expect(count(t.api, '/api/stamp'), `stamp: ${t.api.join(' ')}`).toBe(1);
  expect(count(t.api, '/api/place'), `place: ${t.api.join(' ')}`).toBeLessThanOrEqual(1);
  // /api/section/[cat] and /api/stories are retired; nothing may bring them back.
  expect(t.api.filter((p) => !/^\/api\/(world|stamp|place)/.test(p))).toEqual([]);
});

// Known red, and deliberately left that way: warming on hover fires twice for
// one pointerover, and the navigation that follows does not reuse either, so
// one category change costs three identical RSC payloads where it should cost
// one. Measured — keyboard navigation with no hover costs exactly 1, hover
// alone with no click costs 2. test.fail() makes this suite go red the moment
// someone fixes it, which is when this wrapper should be removed.
test('changing category asks for nothing', async ({ page }) => {
  test.fail();
  const t = await watch(page);
  await page.goto('/');
  await settle(page);
  clear(t);

  await page.locator('.catlink[data-cat="technology"]').click();
  await expect(page).toHaveURL(/\/c\/technology/);
  await settle(page);

  expect(t.api, `api: ${t.api.join(' ')}`).toEqual([]);
  // One RSC payload for the route being entered, and not one per link on the
  // strip: the fourteen are prefetch={false}, warmed on intent instead.
  expect(t.rsc.length, `rsc: ${t.rsc.join(' ')}`).toBeLessThanOrEqual(1);
});

// Red for the same reason as above: swap() calls preventDefault and pushState
// precisely to avoid a payload, and Next fetches one anyway.
test('filtering by sub-category asks for nothing', async ({ page }) => {
  test.fail();
  const t = await watch(page);
  await page.goto('/c/technology');
  await settle(page);
  clear(t);

  await page.locator('.subpill').nth(1).click();
  await settle(page);

  expect(t.api, `api: ${t.api.join(' ')}`).toEqual([]);
  expect(t.rsc, `rsc: ${t.rsc.join(' ')}`).toEqual([]);
  expect(t.doc, `doc: ${t.doc.join(' ')}`).toEqual([]);
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
  expect(t.rsc, `rsc: ${t.rsc.join(' ')}`).toEqual([]);
});
