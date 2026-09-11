import { NextResponse } from 'next/server';
import { d1 } from '@/lib/d1';
import { withPlaceLabels, type Story } from '@/lib/feed';
import { cacheHeaders, conditional, notModified } from '@/lib/cycle';

export const dynamic = 'force-dynamic';

/** D1 caps bound parameters per statement, and a client asking for more bodies
 *  than a section holds is asking for something other than a backfill. */
const MAX_IDS = 60;

/**
 * The backfill.
 *
 * A section answers with the full ordered id list and only the bodies that
 * changed, which assumes the client still holds the rest. Usually it does —
 * they are in IndexedDB. When the browser has evicted one under storage
 * pressure, this fetches the few that are missing instead of making the whole
 * section be sent again.
 *
 * Unranked and unfiltered on purpose: the caller already knows which ids it
 * wants and in what order they go.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_IDS);

  const version = await conditional(request, `stories.${ids.join(',')}`);
  const headers = cacheHeaders(version, 15, 300);
  if (version.fresh) return notModified(headers);
  if (!ids.length) return NextResponse.json({ stamp: version.stamp, stories: [] }, { headers });

  const rows = await (await d1()).all<Story>(
    `SELECT * FROM clusters WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

  return NextResponse.json(
    { stamp: version.stamp, stories: withPlaceLabels(rows) }, { headers });
}
