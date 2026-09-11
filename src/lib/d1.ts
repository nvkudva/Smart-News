/**
 * D1 access for the web app.
 *
 * Two backends, one interface. Inside a Worker we use the `DB` binding; from
 * Node (`next dev`, scripts) we use D1's REST API. Same SQL either way, so the
 * deployed path is the path exercised in development — no divergence.
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

type D1Binding = {
  prepare(sql: string): {
    bind(...p: unknown[]): { all(): Promise<{ results: unknown[] }>; run(): Promise<unknown> };
    all(): Promise<{ results: unknown[] }>;
    run(): Promise<unknown>;
  };
};

function fromBinding(binding: D1Binding): D1 {
  const stmt = (sql: string, params: unknown[] = []) =>
    params.length ? binding.prepare(sql).bind(...params) : binding.prepare(sql);
  return {
    async all<T>(sql: string, params: unknown[] = []) {
      return (await stmt(sql, params).all()).results as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return ((await stmt(sql, params).all()).results as T[])[0];
    },
    async run(sql: string, params: unknown[] = []) {
      await stmt(sql, params).run();
    },
  };
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

  // Only take the binding when this really is the Workers runtime. Under
  // `next dev` on Node the adapter still hands back a binding, but it points at
  // a local miniflare database that is empty — which surfaces as "no such
  // table" rather than as a missing binding. Node falls through to HTTP so
  // development reads the same rows the deployed site does.
  const onWorkers = typeof navigator !== 'undefined' &&
    navigator.userAgent === 'Cloudflare-Workers';
  if (onWorkers) {
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const env = (await getCloudflareContext({ async: true })).env as unknown as { DB?: D1Binding };
      if (env?.DB) return (cached = fromBinding(env.DB));
    } catch { /* fall through to HTTP */ }
  }

  if (process.env.SMARTNEWS_LOCAL_D1 === '1') return (cached = await fromSqlite());

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const database = process.env.CLOUDFLARE_D1_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !database || !token) {
    throw new Error('No D1 binding, and CLOUDFLARE_ACCOUNT_ID / _D1_ID / _API_TOKEN are not all set.');
  }
  return (cached = fromHttp(account, database, token));
}
