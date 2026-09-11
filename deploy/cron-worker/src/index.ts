/**
 * Fires workflow_dispatch on .github/workflows/cycle.yml every 15 minutes.
 * GITHUB_TOKEN is a fine-grained PAT on nvkudva/Smart-News with Actions: write,
 * set with `wrangler secret put GITHUB_TOKEN` — never in this file.
 */
const DISPATCH_URL =
  'https://api.github.com/repos/nvkudva/Smart-News/actions/workflows/cycle.yml/dispatches';

type Env = { GITHUB_TOKEN: string; TRIGGER_TOKEN?: string };

/**
 * Constant-time comparison, so a wrong token cannot be found a character at a
 * time by timing the reply.
 */
function tokenMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function dispatch(env: Env): Promise<Response> {
  const res = await fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'smartnews-cycle-cron',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  // 204 is the only success GitHub returns here; anything else is worth a log line.
  if (res.status !== 204) {
    console.error(`dispatch failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

export default {
  async scheduled(_event: ScheduledController, env: Env) {
    await dispatch(env);
  },
  /**
   * Hand-trigger for checking the wiring:
   *   curl -X POST -H 'x-trigger-token: <token>' <worker-url>
   *
   * It used to dispatch on any POST at all. The URL is the only thing standing
   * between a stranger and the whole pipeline — GitHub Actions minutes, the D1
   * read and write budgets, and the 10k daily Workers AI neurons, spent on
   * every call, with the workflow's concurrency group serialising the runs
   * rather than discarding them.
   *
   * Fails closed: with no TRIGGER_TOKEN set the handler is simply off, so this
   * is safe before anyone runs `wrangler secret put TRIGGER_TOKEN`. The
   * scheduled handler is unaffected either way, and the Actions tab still has
   * its own button.
   */
  async fetch(req: Request, env: Env) {
    if (req.method !== 'POST') return new Response('POST to dispatch', { status: 405 });
    if (!env.TRIGGER_TOKEN) {
      return new Response('manual trigger disabled: no TRIGGER_TOKEN set\n', { status: 404 });
    }
    if (!tokenMatches(req.headers.get('x-trigger-token'), env.TRIGGER_TOKEN)) {
      return new Response('no\n', { status: 401 });
    }
    const res = await dispatch(env);
    return new Response(res.status === 204 ? 'dispatched\n' : 'failed\n', {
      status: res.status === 204 ? 200 : 502,
    });
  },
} satisfies ExportedHandler<Env>;
