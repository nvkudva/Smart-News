import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

/**
 * What today has cost, against the free plan's daily allowances.
 *
 * The pipeline runs every thirty minutes and the site reads D1 on every cold
 * ETag, so the two numbers that decide whether the feed stops moving are rows
 * read from D1 and neurons spent on Workers AI. Both reset at 00:00 UTC, and
 * neither is visible from anywhere in this repo — only from the dashboard, or
 * from here.
 *
 * Cloudflare's GraphQL analytics API, not the REST one: usage is a timeseries
 * and only GraphQL serves it. The token needs Account Analytics: Read on top of
 * whatever it already has; a token without it answers with an authentication
 * error rather than zeroes, which is what the per-query error reporting below
 * is for — one unavailable dataset should still leave the other readable.
 */

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

/**
 * The free plan's daily limits, for context rather than enforcement. Wrong
 * numbers here would misreport the headroom, so they are stated once and
 * labelled — a paid plan simply reads them as noise.
 */
const FREE_DAILY = {
  rowsRead: 5_000_000,
  rowsWritten: 100_000,
  neurons: 10_000,
};

type Json = Record<string, unknown>;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

/** Midnight UTC today, which is when Cloudflare's daily counters went to zero. */
function sinceUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function graphql(token: string, query: string, variables: Json): Promise<Json> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  // A proxy or a WAF answers in HTML, and "Unexpected token '<'" is a worse
  // description of that than the status line is.
  const text = await res.text();
  let body: { data?: Json; errors?: { message: string }[] };
  try { body = JSON.parse(text); }
  catch { throw new Error(`HTTP ${res.status}, and the body was not JSON: ${text.slice(0, 80)}`); }
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body.data ?? {};
}

const D1_QUERY = `
  query D1($account: String!, $db: String!, $since: Time!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        d1AnalyticsAdaptiveGroups(
          limit: 1000
          filter: { databaseId: $db, datetimeHour_geq: $since }
        ) {
          sum { readQueries writeQueries rowsRead rowsWritten }
        }
      }
    }
  }`;

const AI_QUERY = `
  query AI($account: String!, $since: Date!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        aiInferenceAdaptiveGroups(
          limit: 1000
          filter: { date_geq: $since }
        ) {
          dimensions { modelId }
          sum { totalNeurons }
        }
      }
    }
  }`;

/** A bar a terminal can read at a glance: used, allowance, and what is left. */
function line(label: string, used: number, limit: number): string {
  const pct = limit ? (used / limit) * 100 : 0;
  const filled = Math.min(20, Math.round(pct / 5));
  const bar = '█'.repeat(filled) + '·'.repeat(20 - filled);
  return `${label.padEnd(14)} ${used.toLocaleString().padStart(11)} / ${limit.toLocaleString().padStart(9)}`
       + `  ${bar} ${pct.toFixed(1)}%`;
}

async function main() {
  const token = env('CLOUDFLARE_API_TOKEN');
  const account = env('CLOUDFLARE_ACCOUNT_ID');
  const db = env('CLOUDFLARE_D1_ID');
  const since = sinceUtcMidnight();

  console.log(`Since ${since} (Cloudflare's daily counters reset at 00:00 UTC)\n`);

  try {
    const data = await graphql(token, D1_QUERY, { account, db, since }) as any;
    const groups = data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups ?? [];
    const total = groups.reduce(
      (acc: any, g: any) => ({
        readQueries: acc.readQueries + (g.sum?.readQueries ?? 0),
        writeQueries: acc.writeQueries + (g.sum?.writeQueries ?? 0),
        rowsRead: acc.rowsRead + (g.sum?.rowsRead ?? 0),
        rowsWritten: acc.rowsWritten + (g.sum?.rowsWritten ?? 0),
      }),
      { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 });

    console.log('D1');
    console.log(line('  rows read', total.rowsRead, FREE_DAILY.rowsRead));
    console.log(line('  rows written', total.rowsWritten, FREE_DAILY.rowsWritten));
    console.log(`  queries       ${total.readQueries.toLocaleString()} read, `
              + `${total.writeQueries.toLocaleString()} write\n`);
  } catch (err) {
    // Reported, not thrown: the neuron count below is the other half of the
    // answer and does not depend on this one.
    console.log(`D1: unavailable — ${(err as Error).message}\n`);
    process.exitCode = 1;
  }

  try {
    // This dataset is keyed by date rather than by the hour D1 uses, so the
    // window is the same midnight expressed as a plain date.
    const data = await graphql(token, AI_QUERY, { account, since: since.slice(0, 10) }) as any;
    const groups = data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
    const neurons = groups.reduce((n: number, g: any) => n + (g.sum?.totalNeurons ?? 0), 0);

    console.log('Workers AI');
    console.log(line('  neurons', Math.round(neurons), FREE_DAILY.neurons));
    // Per model, because the summariser is not the only thing that could be
    // spending them, and a surprise is easier to read than a single total.
    for (const g of groups) {
      const n = Math.round(g.sum?.totalNeurons ?? 0);
      if (n > 0) console.log(`    ${g.dimensions?.modelId ?? '(unknown model)'}: ${n.toLocaleString()}`);
    }
  } catch (err) {
    console.log(`Workers AI: unavailable — ${(err as Error).message}`);
    process.exitCode = 1;
  }

  console.log('\nLimits shown are the free plan\'s daily allowances.');
}

main().catch((err: Error) => {
  // A missing token is a setup problem, not a crash, and a stack trace is the
  // wrong way to say so.
  console.error(err.message);
  process.exit(1);
});
