import { NextResponse } from 'next/server';
import { cacheHeaders, conditional, notModified } from '@/lib/cycle';

export const dynamic = 'force-dynamic';

/**
 * The version of the readable world, on its own.
 *
 * One memoised row read, and the only call a returning reader has to make: if
 * the stamp it answers with is the one they already hold, everything in their
 * IndexedDB is current and nothing else needs asking for. Public and unscoped —
 * it is the same fact for everyone, with no reader in it.
 */
export async function GET(request: Request) {
  const version = await conditional(request, 'stamp');
  const headers = {
    ...cacheHeaders(version, 15, 300),
    'cache-control': 'public, max-age=15, stale-while-revalidate=300',
  };
  if (version.fresh) return notModified(headers);
  return NextResponse.json({ stamp: version.stamp }, { headers });
}
