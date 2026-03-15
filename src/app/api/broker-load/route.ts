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
      const cached = getBlobCache('broker_load_cache', sessionId);
      if (cached) {
        return NextResponse.json({ loads: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const dbResult = await executeQuery(sessionId, 'SHOW DATABASES');
    const databases = (dbResult.rows as Record<string, unknown>[]).map(r =>
      String(r['Database'] || r['database'] || Object.values(r)[0] || '')
    ).filter(d => d && !['information_schema', '_statistics_', 'starrocks_monitor'].includes(d));

    const allLoads: Record<string, unknown>[] = [];

    for (const db of databases) {
      try {
        const result = await executeQuery(sessionId, `SHOW LOAD FROM \`${db}\` ORDER BY CreateTime DESC LIMIT 50`);
        const rows = result.rows as Record<string, unknown>[];
        for (const row of rows) {
          allLoads.push({ ...row, _db: db });
        }
      } catch { /* skip */ }
    }

    // Sort by CreateTime desc
    allLoads.sort((a, b) => {
      const ta = String(a['CreateTime'] || '');
      const tb = String(b['CreateTime'] || '');
      return tb.localeCompare(ta);
    });

    let cachedAt: string | undefined;
    try { cachedAt = setBlobCache('broker_load_cache', sessionId, allLoads); } catch { /* non-fatal */ }

    return NextResponse.json({ loads: allLoads, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action, dbName, label } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (action === 'cancel') {
      if (!label || !dbName) return NextResponse.json({ error: 'Label and DB required' }, { status: 400 });
      await executeQuery(sessionId, `CANCEL LOAD FROM \`${dbName}\` WHERE LABEL = '${label}'`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
