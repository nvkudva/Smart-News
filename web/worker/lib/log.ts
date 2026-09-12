import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What the Worker says when something goes wrong, and nothing else.
 *
 * Workers Logs captures console.* and maps console.error to error severity on
 * its own, so the only thing this adds is shape: one JSON object per line, so
 * the dashboard and the observability query API can filter on a field instead
 * of matching substrings. Cloudflare's own guidance is JSON.stringify inside
 * the console call rather than a bare object.
 *
 * Deliberately quiet on the happy path. Cloudflare already records every
 * invocation with its outcome, duration and CPU time; logging a line per
 * request would add cost and volume to say what the platform already says.
 * Uncaught exceptions it also records by itself - what it cannot see, and what
 * this exists for, is a failure the code caught and handled.
 */

type Fields = Record<string, unknown>;

/**
 * The Ray ID is the one identifier Cloudflare's own records share, so a line
 * here can be lined up against an invocation in the dashboard. The reader's id
 * is deliberately absent: it names a preferences row, and logs should not be
 * the thing that ties requests back to a person.
 */
type RequestContext = { ray: string; path: string; method: string };

const store = new AsyncLocalStorage<RequestContext>();

export function withLogContext<T>(context: RequestContext, fn: () => T): T {
  return store.run(context, fn);
}

export function requestContext(request: Request, url: URL): RequestContext {
  return {
    ray: request.headers.get('cf-ray') ?? 'none',
    path: url.pathname,
    method: request.method,
  };
}

function emit(level: 'error' | 'warn', event: string, err: unknown, fields: Fields): void {
  const context = store.getStore();
  const line: Fields = {
    event,
    ...context,
    ...fields,
    error: err instanceof Error ? err.message : String(err),
  };
  // A few frames name the call site; the rest is runtime noise, and every line
  // here is billed by volume.
  if (err instanceof Error && err.stack) {
    line.stack = err.stack.split('\n').slice(1, 4).map((l) => l.trim()).join(' | ');
  }
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else console.warn(out);
}

/** A failure that cost the reader something - a missing section, a dead route. */
export function logError(event: string, err: unknown, fields: Fields = {}): void {
  emit('error', event, err, fields);
}

/**
 * A failure the app absorbed without the reader noticing, but which still means
 * something is wrong - a stamp that will not load, so every answer ships in
 * full instead of as a 304.
 */
export function logWarn(event: string, err: unknown, fields: Fields = {}): void {
  emit('warn', event, err, fields);
}
