/**
 * D1 access for the web app.
 *
 * Two backends, one interface: D1's REST API, or the pipeline's own SQLite file
 * when SMARTNEWS_LOCAL_D1 is set. Same SQL either way.
 *
 * There is no binding backend here. This client is Node-only - scripts/ on a
 * GitHub Actions runner - and the Worker that serves the site has its own in
 * web/worker/lib/d1.ts, where the binding is the only backend there is.
 *
 * The ingest/cluster/summarise pipeline deliberately does NOT go through here.
 * It keeps working against local SQLite in db.ts, where a cluster run issues
 * thousands of statements that would each be an HTTP round trip. `npm run
 * sync` pushes finished rows here in batches instead.
 */

export type Row = Record<string, unknown>;

export interface D1 {
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

function fromHttp(accountId: string, databaseId: string, token: string): D1 {
  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json() as {
      success: boolean; errors?: { message: string }[];
      result?: { results?: unknown[] }[];
    };
    if (!body.success) throw new Error(`D1: ${body.errors?.map((e) => e.message).join('; ')}`);
    return (body.result?.[0]?.results ?? []) as T[];
  }

  return {
    all: <T,>(sql: string, params: unknown[] = []) => query<T>(sql, params),
    get: async <T,>(sql: string, params: unknown[] = []) => (await query<T>(sql, params))[0],
    run: async (sql: string, params: unknown[] = []) => { await query(sql, params); },
  };
}

/**
 * The pipeline's own SQLite file, standing in for D1.
 *
 * Development reads the deployed rows on purpose, which is right until the day
 * D1 stops answering — an exhausted daily read limit takes the whole site down
 * until midnight UTC, and with it every local page. `SMARTNEWS_LOCAL_D1=1`
 * points `next dev` at data/smartnews.db instead, which the pipeline has been
 * filling all along. Off by default: the divergence this avoids is real, and
 * worth accepting only deliberately.
 */
async function fromSqlite(): Promise<D1> {
  const { db } = await import('./db');
  const d = db();
  const rows = <T,>(sql: string, params: unknown[]) =>
    d.prepare(sql).all(...(params as never[])) as T[];
  return {
    all: async <T,>(sql: string, params: unknown[] = []) => rows<T>(sql, params),
    get: async <T,>(sql: string, params: unknown[] = []) => rows<T>(sql, params)[0],
    run: async (sql: string, params: unknown[] = []) => {
      d.prepare(sql).run(...(params as never[]));
    },
  };
}

let cached: D1 | null = null;

export async function d1(): Promise<D1> {
  if (cached) return cached;

  // No binding branch here any more. This file is the pipeline's client and the
  // pipeline is Node: it runs from scripts/ on a GitHub Actions runner, never
  // inside a Worker. web/worker/lib/d1.ts is the binding one, and it is the
  // only place a binding exists.
  if (process.env.SMARTNEWS_LOCAL_D1 === '1') return (cached = await fromSqlite());

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const database = process.env.CLOUDFLARE_D1_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !database || !token) {
    throw new Error('No D1 binding, and CLOUDFLARE_ACCOUNT_ID / _D1_ID / _API_TOKEN are not all set.');
  }
  return (cached = fromHttp(account, database, token));
}
