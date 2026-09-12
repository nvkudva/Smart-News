import { defineConfig } from '@playwright/test';

/**
 * Against a production build, never `next dev`.
 *
 * Neither server builds: `pretest` does both builds first, in order. Playwright
 * starts webServers in parallel, and two `next build` runs writing .next at the
 * same time is a race the budget suite then measures.
 *
 * React's Strict Mode double-invokes effects in development, so every fetch a
 * component makes on mount appears twice and a request budget measures the
 * dev server rather than the app. The build is the slow part of this suite and
 * the reason it is not a watch-mode test.
 */
export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    // The hand-written service worker answers from its own caches and would
    // hide the very requests this suite counts.
    serviceWorkers: 'block',
  },
  webServer: [
    {
      command: 'npm start',
      url: 'http://127.0.0.1:3000',
      env: { SMARTNEWS_LOCAL_D1: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    // The service worker's document cache is keyed on /BUILD_ID, and that file
    // only exists at that URL in the OpenNext build — `next start` serves only
    // public/, so docs() gets a 404, returns null, and the cache it guards can
    // never be reached. Testing that policy at all means serving the artifact
    // that actually ships. D1 is the local miniflare one and stays empty: the
    // shells under test are prerendered and carry no rows.
    {
      command: 'npx wrangler dev --port 8787',
      url: 'http://127.0.0.1:8787/BUILD_ID',
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
    },
  ],
});
