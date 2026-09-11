import { defineConfig } from '@playwright/test';

/**
 * Against a production build, never `next dev`.
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
  webServer: {
    command: 'npm run build && npm start',
    url: 'http://127.0.0.1:3000',
    env: { SMARTNEWS_LOCAL_D1: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
