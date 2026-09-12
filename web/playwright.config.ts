import { defineConfig } from '@playwright/test';

/**
 * Against a production build, never the dev server.
 *
 * React Strict Mode double-invokes effects in development, so every fetch a
 * component makes on mount appears twice and a request budget would be
 * measuring the dev server rather than the app. The dev server also disables
 * the service worker on purpose, which is the entire subject of one of these
 * suites.
 *
 * One server now, where the Next tree needed two: `next start` could not serve
 * the OpenNext artifact the service worker was written against, so the budget
 * suite and the cache suite ran against different servers. `vite preview` runs
 * the real Worker in workerd with the real assets, so both suites share it.
 *
 * The build is part of the command rather than a separate step, and has to be:
 * vite preview reads the asset manifest once at startup, so a preview started
 * before a build serves the previous build's sw.js and asset hashes - which
 * looks exactly like the caching bug these tests exist to catch.
 *
 * localhost and not 127.0.0.1: vite preview binds the hostname, which resolves
 * to ::1 here, so the v4 literal never answers and Playwright waits out the
 * whole webServer timeout for a server that is already up.
 *
 * D1 is the local miniflare database, shared with the dev server through
 * persistState. Seed it with `npm run seed:local-d1` from the repo root; an
 * empty one makes every feed assertion fail for a reason that has nothing to
 * do with the code.
 */
const PORT = 4178;

export default defineConfig({
  testDir: 'tests',
  // The two suites disagree about whether the service worker may run, and a
  // worker registered by one would outlive into the other on a shared origin.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Overridden in serviceworker.spec.ts, which is about the cache rather
    // than about what reaches the Worker.
    serviceWorkers: 'block',
  },
  webServer: {
    command: `bun run build && bunx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/stamp`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
