/**
 * Fires workflow_dispatch on .github/workflows/cycle.yml every 15 minutes.
 * GITHUB_TOKEN is a fine-grained PAT on nvkudva/Smart-News with Actions: write,
 * set with `wrangler secret put GITHUB_TOKEN` — never in this file.
 */
const DISPATCH_URL =
  'https://api.github.com/repos/nvkudva/Smart-News/actions/workflows/cycle.yml/dispatches';

type Env = { GITHUB_TOKEN: string };

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
  // Hand-trigger with `curl -X POST <worker-url>` when checking the wiring.
  async fetch(req: Request, env: Env) {
    if (req.method !== 'POST') return new Response('POST to dispatch', { status: 405 });
    const res = await dispatch(env);
    return new Response(res.status === 204 ? 'dispatched\n' : 'failed\n', {
      status: res.status === 204 ? 200 : 502,
    });
  },
} satisfies ExportedHandler<Env>;
