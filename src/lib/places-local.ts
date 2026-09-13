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

export function resolvePlaceLocal(
  d: DatabaseSync,
  raw: string | null,
  country: string | null,
): { place_id: string | null; country: string | null } {
  const cc = isoCountry(country);
  const text = (raw ?? '').trim();
  if (!text) return { place_id: null, country: cc };

  const segments = text.split(',').map((s) => s.trim()).filter(Boolean);
  const candidates = [text];
  if (segments.length > 1) candidates.push(segments[segments.length - 1], segments[0]);

  const aliases: string[] = [];
  for (const c of candidates) {
    const a = normaliseAlias(c);
    if (a && !aliases.includes(a)) aliases.push(a);
  }
  if (!aliases.length) return { place_id: null, country: cc };

  const countries = cc ? [cc, ''] : [''];
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
      if (hit) return { place_id: hit.place_id, country: cc ?? hit.place_country ?? null };
    }
  }
  return { place_id: null, country: cc };
}
