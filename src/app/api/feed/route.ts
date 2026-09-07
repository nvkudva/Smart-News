import { NextResponse } from 'next/server';
import { getFeed } from '@/lib/feed';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 30);
  return NextResponse.json({ stories: getFeed(Math.min(100, Math.max(1, limit))) });
}
