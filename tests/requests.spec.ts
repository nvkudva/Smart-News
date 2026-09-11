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

/**
 * The first router.prefetch of a session fetches the app shell alongside the
 * route, so it costs two where every later one costs one. Burning it on a link
 * we are not going to use is what makes the numbers below steady rather than
 * off-by-one on whichever test runs first.
 */
async function burnFirstPrefetch(page: Page) {
  await page.locator('.catlink[data-cat="world"]').hover();
  await page.waitForTimeout(1_500);
}

test('warming a category costs one payload, and entering it costs none', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);
  await burnFirstPrefetch(page);

  clear(t);
  await page.locator('.catlink[data-cat="science"]').hover();
  await page.waitForTimeout(1_500);
  expect(t.rsc, `warm: ${t.rsc.join(' ')}`).toEqual(['/c/science']);

  // The whole bargain of warming on intent: the tap itself is free. A click
  // that raced its own prefetch would fetch the payload a second time.
  clear(t);
  await page.locator('.catlink[data-cat="science"]').click();
  await expect(page).toHaveURL(/\/c\/science/);
  await settle(page);

  expect(t.rsc, `enter: ${t.rsc.join(' ')}`).toEqual([]);
  expect(t.api, `api: ${t.api.join(' ')}`).toEqual([]);
});

test('filtering by sub-category asks for nothing', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/c/technology');
  await settle(page);
  await burnFirstPrefetch(page);

  const pill = page.locator('.substrip .subpill').nth(1);
  await pill.hover();
  await page.waitForTimeout(1_500);

  clear(t);
  await pill.click();
  await settle(page);

  // swap() calls preventDefault and pushState so the sub-filter is a filter
  // over rows already held, not a route change.
  expect(t.api, `api: ${t.api.join(' ')}`).toEqual([]);
  expect(t.doc, `doc: ${t.doc.join(' ')}`).toEqual([]);
  // pushState is not invisible to the router — it syncs to the new URL — but
  // one payload for the whole sub-strip is the ceiling, not one per pill.
  expect(t.rsc.length, `rsc: ${t.rsc.join(' ')}`).toBeLessThanOrEqual(1);
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

  // Built from the slug alone this said /c/top — a real prerendered page
  // showing the same rows under a second URL.
  const hrefs = await page.locator('.subpill').evaluateAll(
    (els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(1);
  expect(hrefs.filter((h) => h?.startsWith('/c/top'))).toEqual([]);
});

test('changing a preference drops the world the tab was holding', async ({ page }) => {
  const t = await watch(page);
  await page.goto('/');
  await settle(page);

  // The control: leaving and coming back holds what it had, so the assertion
  // below is about the preference change and not about navigation.
  clear(t);
  await page.goto('/saved');
  await page.goto('/');
  await settle(page);
  expect(count(t.api, '/api/world'), `control: ${t.api.join(' ')}`).toBe(0);

  await page.goto('/profile');
  await page.locator('.setdrop summary').first().click();
  const chip = page.locator('.setchips .chip input').first();
  await chip.click();
  await page.waitForTimeout(1_500);

  clear(t);
  await page.goto('/');
  await settle(page);

  // Ranked against preferences that just changed, and the cycle stamp the
  // stored copy is keyed on has not moved — so it has to be asked for again.
  expect(count(t.api, '/api/world'), `api: ${t.api.join(' ')}`).toBe(1);
});
