/**
 * What Workers AI has cost today, asked of Cloudflare rather than counted here.
 *
 * The pipeline had no idea what it was spending. tokenTally printed a token
 * count at the end of a run and nothing compared it to anything, so a cycle in
 * which every summarise call was rejected for an exhausted allowance exited 0
 * and read exactly like a quiet news day.
 *
 * Counting locally would not have fixed that: the runner is one of several
 * things drawing on the same daily pool - a manual cycle, a re-run, the local
 * box - and a tally kept in the working store knows only about itself. This
 * asks the meter.
 *
 * Neurons reset at 00:00 UTC, which is what the free plan's 10,000 are measured
 * against, so the window starts at today's midnight.
 */

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

const AI_QUERY = `
  query AI($account: String!, $since: Date!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        aiInferenceAdaptiveGroups(limit: 1000, filter: { date_geq: $since }) {
          sum { totalNeurons }
        }
      }
    }
  }`;

/**
 * Null, not zero, when the question cannot be asked - no token, no Account
 * Analytics: Read on the one there is, the API having a bad minute. Zero would
 * read as "nothing spent yet" and hand the caller the whole day's allowance on
 * the strength of a failed request.
 */
export async function neuronsToday(): Promise<number | null> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) return null;

  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: AI_QUERY,
        variables: { account, since: midnight.toISOString().slice(0, 10) },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json() as {
      data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: number } }[] }[] } };
      errors?: { message: string }[];
    };
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
    const groups = body.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
    if (!groups) return null;
    return Math.round(groups.reduce((n, g) => n + (g.sum?.totalNeurons ?? 0), 0));
  } catch (e) {
    console.warn(`  ! neuron meter unavailable (${(e as Error).message}) — summarising without a budget`);
    return null;
  }
}

/** The free plan's daily pool. */
export const DAILY_NEURONS = 10_000;

/**
 * How much of it this pipeline will use: all of it. Anything else drawing on
 * the pool - the site, a hand-run cycle - is billed past the free allowance
 * once the pipeline has spent it, at $0.011 per 1,000 neurons.
 */
export const NEURON_BUDGET = Number(process.env.NEURON_BUDGET ?? DAILY_NEURONS);

/**
 * Neurons one cluster costs to summarise, for turning headroom into a number of
 * clusters before any of them are written.
 *
 * Measured, not guessed: granite-4.0-h-micro at a 6-to-8 sentence crux spent
 * 2,622 neurons over the 471 clusters of the uncapped local run, which is 5.57
 * each. Rounded up, because a budget that under-estimates overspends.
 */
export const NEURONS_PER_CLUSTER = Number(process.env.NEURONS_PER_CLUSTER ?? 6);

/**
 * How many clusters today's remaining allowance will pay for.
 *
 * `null` spend means the meter could not be read, and the answer is then the
 * caller's own limit unchanged - degrading to the old behaviour rather than
 * refusing to summarise because analytics was briefly unreachable.
 */
export function affordable(spent: number | null, limit: number): number {
  if (spent === null) return limit;
  const headroom = NEURON_BUDGET - spent;
  if (headroom <= 0) return 0;
  return Math.min(limit, Math.floor(headroom / NEURONS_PER_CLUSTER));
}
