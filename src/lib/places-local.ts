/**
 * The pipeline's copy of resolvePlaceName.
 *
 * It exists because summarising a cycle's clusters would otherwise be one
 * awaited D1 round trip per cluster, over HTTP, for a lookup that is a
 * microsecond against the local SQLite file the pipeline already has open.
 * The matching order is identical to places.ts on purpose — a story resolved
 * by the pipeline and the same string resolved by the web app must land on the
 * same row.
 */

import type { DatabaseSync } from 'node:sqlite';
import { normaliseAlias } from './places';

type Hit = { alias: string; acc: string; place_id: string; place_country: string };

/**
 * ISO 3166-1 alpha-2, or nothing.
 *
 * Models write UK for the United Kingdom about as often as GB, and both were
 * stored: National is `c.country = <the reader's code>` and the home-country
 * list is the distinct codes we hold stories for, so one country appeared in
 * the picker twice and each half of it answered for its own stories. GB is the
 * ISO code and the one sources.ts already uses, so UK folds into it.
 */
const ALIASES: Record<string, string> = { UK: 'GB' };

export function isoCountry(v: unknown): string | null {
  const code = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return ALIASES[code] ?? code;
}

/** The country a trailing segment names, if it names one. */
function countryHint(d: DatabaseSync, segments: string[]): string | null {
  if (segments.length < 2) return null;
  const alias = normaliseAlias(segments[segments.length - 1]);
  if (!alias) return null;
  const row = d.prepare(
    `SELECT p.country AS country FROM place_aliases a JOIN places p ON p.id = a.place_id
      WHERE a.alias = ? AND p.kind = 'country' LIMIT 1`,
  ).get(alias) as unknown as { country: string } | undefined;
  return row?.country ?? null;
}

export function resolvePlaceLocal(
  d: DatabaseSync,
  raw: string | null,
  country: string | null,
): { place_id: string | null; country: string | null } {
  const cc = isoCountry(country);
  const text = (raw ?? '').trim();
  if (!text) return { place_id: null, country: cc };

  // Segments most specific first. "Delhi, India" used to try the whole string,
  // then the trailing segment — which matched the country and returned it — so
  // the same city resolved to Delhi when a model wrote "Delhi" and to India
  // when it wrote "Delhi, India". A trailing country name is a hint about where
  // to look, not the answer; the leading segment is what the story is about.
  const segments = text.split(',').map((s) => s.trim()).filter(Boolean);
  const candidates = segments.length > 1
    ? [text, ...segments]
    : [text];

  const aliases: string[] = [];
  for (const c of candidates) {
    const a = normaliseAlias(c);
    if (a && !aliases.includes(a)) aliases.push(a);
  }
  if (!aliases.length) return { place_id: null, country: cc };

  // A trailing country name scopes the search rather than answering it: with
  // no country on the cluster, "Delhi, India" would otherwise fall through the
  // city and land on India itself.
  const hinted = cc ?? countryHint(d, segments);
  const countries = hinted ? [hinted, ''] : [''];
  const rows = d.prepare(
    `SELECT a.alias AS alias, a.country AS acc, p.id AS place_id, p.country AS place_country
       FROM place_aliases a JOIN places p ON p.id = a.place_id
      WHERE a.alias IN (${aliases.map(() => '?').join(',')})
        AND a.country IN (${countries.map(() => '?').join(',')})`,
  ).all(...([...aliases, ...countries] as never[])) as unknown as Hit[];

  for (const alias of aliases) {
    for (const c of countries) {
      const hit = rows.find((r) => r.alias === alias && r.acc === c);
      // The model often names a place and forgets the country code; the
      // gazetteer knows it, so take it rather than lose the story's country.
      if (hit) return { place_id: hit.place_id, country: hinted ?? hit.place_country ?? null };
    }
  }
  // Nothing matched under a country, and the text named none. A name that
  // belongs to exactly one place in the gazetteer is not ambiguous, whatever
  // the seed happens to have filed it under: "Delhi" is stored against IN and
  // nowhere else, so a story that says only "Delhi" means that one.
  for (const alias of aliases) {
    const only = d.prepare(
      `SELECT DISTINCT p.id AS place_id, p.country AS place_country
         FROM place_aliases a JOIN places p ON p.id = a.place_id
        WHERE a.alias = ? LIMIT 2`,
    ).all(alias) as unknown as { place_id: string; place_country: string }[];
    if (only.length === 1) return { place_id: only[0].place_id, country: hinted ?? only[0].place_country ?? null };
  }
  return { place_id: null, country: cc };
}
