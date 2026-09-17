import { expect, test, type Page } from '@playwright/test';

/**
 * What the browser is already holding, when there is no network to check it
 * against.
 *
 * A section is kept in IndexedDB against the cycle stamp, and the stamp is the
 * only thing that expires it. Offline the stamp cannot be read at all, and
 * that non-answer used to arrive as the same `null` the Worker sends when
 * there is no cycle to key on - so readFresh read "could not ask" as "does not
 * match", discarded a copy that was perfectly current, and fell through to a
 * fetch that could not succeed. The reader got the error screen while the feed
 * sat on disk.
 *
 * Three things about the shape of this, each of which the first drafts got
 * wrong:
 *
 * The worker runs, because a route's chunk is code-split and only the worker
 * can hand it over offline - block it and the router falls back to a document
 * navigation that has nothing to answer it.
 *
 * Its /api cache is emptied first, because a cached stamp would settle the
 * question before the code under test ever saw it. That is not a contrivance:
 * it is the state the browser is in whenever that cache is evicted, or was
 * never populated, while IndexedDB survived.
 *
 * And the navigation is in-app rather than a reload. A reload offline is a
 * fresh document, which is the worker's business and not this suite's.
 *
 * Only the persisted routes are covered, and that is the rule rather than a
 * gap: /saved, /reels, /profile and /story/:id carry the reader's own state,
 * are no-store on the Worker and unpersisted here, so offline they have
 * nothing to serve and correctly fail. world.ts's `?since` delta branch needs
 * nothing of its own - readFresh returns the stored world before `resolve`
 * reaches the branch at all.
 */
test.use({ serviceWorkers: 'allow' });

async function controlled(page: Page) {
  await page.waitForFunction(
    () => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  // The precache is install work; a claimed page can still be a beat ahead of it.
  await page.waitForTimeout(3_000);
}

/** Everything the worker holds for /api/*, so the stamp cannot be answered. */
async function forgetApiCache(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith('data-'));
    for (const n of names) await caches.delete(n);
    return names.length;
  });
}

/** The loaded page, not the skeleton the router shows while a loader runs -
 *  both carry .feed, and the first draft of this asserted the skeleton. */
const localStories = (page: Page) =>
  page.waitForSelector('.feed:not([aria-busy]) a[href^="/story/"]', { timeout: 20_000 });

/**
 * /local is the reader's own places over a 48-hour window, so whether it has
 * anything in it depends on the seeded store rather than on the code. An empty
 * one renders its "Quiet so far" panel instead of a feed, and waiting for a
 * story card then times out twenty seconds later saying nothing about the rule
 * under test. Asked once, up front, so a thin fixture skips rather than fails.
 */
async function localIsPopulated(page: Page): Promise<boolean> {
  await page.waitForSelector('.feed:not([aria-busy]) a[href^="/story/"], .panel', { timeout: 20_000 });
  return (await page.locator('.feed:not([aria-busy]) a[href^="/story/"]').count()) > 0;
}

test('a section already stored is served offline rather than failing', async ({ page, context }) => {
  // Once online, so /api/local is in IndexedDB against the current stamp.
  await page.goto('/local');
  await controlled(page);
  test.skip(!await localIsPopulated(page),
            'the seeded store has nothing in the reader\'s places; run npm run seed:local-d1');

  // A full document load, so the router starts again knowing only this route
  // and the click below actually runs /local's loader.
  await page.goto('/');
  await controlled(page);
  await page.waitForSelector('a[href^="/story/"]', { timeout: 30_000 });

  // A no-op deletion would leave the worker answering the stamp from cache,
  // which is the one thing that would make this pass for the wrong reason.
  expect(await forgetApiCache(page), 'the worker should be holding an /api cache by now')
    .toBeGreaterThan(0);
  await context.setOffline(true);

  await page.locator('a[href="/local"]').first().click();
  await expect(page).toHaveURL(/\/local$/);
  await localStories(page);
  // What the defect rendered instead: the loader threw, and with no
  // errorComponent on this route the router's own boundary answered.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});
