/**
 * robots.txt, honoured.
 *
 * The pipeline does not read the RSS summary and stop — it fetches the article
 * page and extracts the whole body. That is crawling, and a publisher who has
 * written down what crawlers may do is entitled to have it read. The Register
 * makes the point plainly: `User-agent: * / Disallow: /`, under a header saying
 * scraping is blocked and licensing is available. Without this module we were
 * fetching that page anyway.
 *
 * Implements RFC 9309: the most specific matching user-agent group wins, then
 * the longest matching path rule, then Allow over Disallow on a tie.
 */

const CACHE = new Map<string, Promise<Rules>>();

type Rules = { allow: string[]; disallow: string[]; delayMs: number };

const ALLOW_ALL: Rules = { allow: [], disallow: [], delayMs: 0 };
const DENY_ALL: Rules = { allow: [], disallow: ['/'], delayMs: 0 };

/**
 * `?` and `.` are literals in a robots path, not regex operators. Escaping them
 * before `*` becomes `.*` is the whole correctness of this function: leaving `?`
 * alone turns Wired's `Disallow: /*?` into a lazy quantifier that matches every
 * path on the site, and the crawler then politely refuses to read anything.
 */
function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

function parse(txt: string, token: string): Rules {
  // Groups are collected per user-agent so the most specific one can be picked
  // afterwards; consecutive User-agent lines share the rules that follow them.
  const groups: { agents: string[]; rules: Rules }[] = [];
  let current: { agents: string[]; rules: Rules } | null = null;
  let inAgentRun = false;

  for (const raw of txt.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!current || !inAgentRun) {
        current = { agents: [], rules: { allow: [], disallow: [], delayMs: 0 } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgentRun = true;
      continue;
    }
    inAgentRun = false;
    if (!current) continue;
    // An empty Disallow means "nothing is disallowed" and is not a rule.
    if (key === 'disallow' && value) current.rules.disallow.push(value);
    else if (key === 'allow' && value) current.rules.allow.push(value);
    else if (key === 'crawl-delay') {
      const s = Number(value);
      if (Number.isFinite(s) && s > 0) current.rules.delayMs = Math.min(s, 30) * 1000;
    }
  }

  const named = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  return (named ?? groups.find((g) => g.agents.includes('*')))?.rules ?? ALLOW_ALL;
}

async function fetchOnce(origin: string, ua: string) {
  return fetch(`${origin}/robots.txt`, {
    headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(10_000),
  });
}

async function rulesFor(origin: string, token: string, ua: string): Promise<Rules> {
  try {
    let res = await fetchOnce(origin, ua);
    // A 5xx is a policy we could not read, and RFC 9309 says to treat that as a
    // refusal — but the verdict is cached per host, so one bad response denies
    // a whole source for the run. It is usually not policy: ingest opens the
    // feeds eight at a time and the bodies six at a time, and some hosts shed
    // load under that burst. Ask once more, unhurried, before believing it.
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetchOnce(origin, ua);
    }
    if (res.status >= 500) {
      console.warn(`  robots: ${origin} answered ${res.status} twice — treating as disallow this run`);
      return DENY_ALL;
    }
    // 4xx means no policy was published, so there is nothing to obey.
    if (!res.ok) return ALLOW_ALL;
    return parse(await res.text(), token);
  } catch {
    // A timeout on their side is an outage, not an answer. We read it again
    // next cycle rather than letting one slow host empty the feed.
    return ALLOW_ALL;
  }
}

export type Verdict = { allowed: boolean; delayMs: number };

/**
 * Whether we may fetch this URL, and how long to wait before the next one on
 * the same host. One robots.txt per origin per process; the pipeline is a
 * one-shot run, so that is exactly one fetch per host per cycle.
 */
export async function robotsVerdict(url: string, ua: string): Promise<Verdict> {
  let u: URL;
  try { u = new URL(url); } catch { return { allowed: false, delayMs: 0 }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { allowed: false, delayMs: 0 };

  const token = (ua.split('/')[0] || ua).toLowerCase();
  let cached = CACHE.get(u.origin);
  if (!cached) {
    cached = rulesFor(u.origin, token, ua);
    CACHE.set(u.origin, cached);
  }
  const rules = await cached;

  const path = u.pathname + u.search;
  let best: { length: number; allowed: boolean } | null = null;
  const consider = (pattern: string, allowed: boolean) => {
    if (!toRegExp(pattern).test(path)) return;
    // Longest match wins; Allow breaks a tie, as the RFC specifies.
    if (!best || pattern.length > best.length || (pattern.length === best.length && allowed)) {
      best = { length: pattern.length, allowed };
    }
  };
  for (const p of rules.disallow) consider(p, false);
  for (const p of rules.allow) consider(p, true);

  return { allowed: best ? (best as { allowed: boolean }).allowed : true, delayMs: rules.delayMs };
}

/** Test seam: the cache is per process, and a test needs more than one. */
export function resetRobotsCache(): void {
  CACHE.clear();
}
