import { NextResponse } from 'next/server';
import { getWorld } from '@/lib/world';
import { currentUserId } from '@/lib/session';
import { getPrefs, prefsFingerprint } from '@/lib/feed';
import { cacheHeaders, conditional, notModified } from '@/lib/cycle';

export const dynamic = 'force-dynamic';

/**
 * The one request a reader makes per cycle.
 *
 * Replaces /api/section/[cat] and /api/stories: the bodies are the same pool
 * under every heading, so fourteen answers that overlap become one that does
 * not. A returning reader sends `since` and gets back the three or four
 * stories the last pipeline run produced.
 */
export async function GET(request: Request) {
  const userId = await currentUserId();
  const since = Number(new URL(request.url).searchParams.get('since') ?? 0) || 0;

  // The bodies are the same for everyone; the fourteen orderings are not, and
  // three of them rank against the reader's preferences. The fingerprint is
  // what keeps two readers' answers off each other's validator.
  const scope = `world.${since}.${prefsFingerprint(await getPrefs(userId))}`;
  const version = await conditional(request, scope);
  const headers = cacheHeaders(version, 15, 300);
  if (version.fresh) return notModified(headers);

  return NextResponse.json(await getWorld(userId, since), { headers });
}
