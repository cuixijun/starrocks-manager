import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh) {
      const cached = getBlobCache('catalogs_cache', sessionId);
      if (cached) {
        return NextResponse.json({ catalogs: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const result = await executeQuery(sessionId, 'SHOW CATALOGS');
    const catalogs = result.rows;

    let cachedAt: string | undefined;
    try {
      cachedAt = setBlobCache('catalogs_cache', sessionId, catalogs);
    } catch { /* non-fatal */ }

    return NextResponse.json({ catalogs, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
