/**
 * D1 access for the SPA's Worker.
 *
 * The Next tree's src/lib/d1.ts carries three backends — the Workers binding,
 * D1's REST API, and the pipeline's SQLite file — because `next dev` runs on
 * Node and had to read something. Here there is only ever the binding: the
 * Worker is the only thing that calls this, and `vite dev` runs it in workerd
 * with a local D1 behind the same binding. Seed that with `npm run
 * seed:local-d1`.
 *
 * The interface is unchanged, so every `await (await d1()).all(...)` call site
 * in feed.ts, sections.ts, places.ts, library.ts and cycle.ts ports untouched.
 */

export type Row = Record<string, unknown>;

export interface D1 {
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

function fromBinding(binding: D1Database): D1 {
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

let current: D1 | null = null;

/**
 * Hand the Worker's binding over, once per request.
 *
 * `env` reaches a Worker as an argument to fetch(), not as a global, so the
 * module cannot reach for it the way the Next version reached for
 * getCloudflareContext(). Holding it at module scope is safe because every
 * request in an isolate gets the same binding object for the same deployment;
 * what must not be cached at module scope is anything derived from a request,
 * which is what cache.ts exists for.
 */
export function setD1(binding: D1Database): void {
  current = fromBinding(binding);
}

export async function d1(): Promise<D1> {
  if (!current) throw new Error('No D1 binding: call setD1(env.DB) before handling a request.');
  return current;
}
