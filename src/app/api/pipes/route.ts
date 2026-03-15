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
      const cached = getBlobCache('pipes_cache', sessionId);
      if (cached) {
        return NextResponse.json({ pipes: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const dbResult = await executeQuery(sessionId, 'SHOW DATABASES');
    const databases = (dbResult.rows as Record<string, unknown>[]).map(r =>
      String(r['Database'] || r['database'] || Object.values(r)[0] || '')
    ).filter(d => d && !['information_schema', '_statistics_', 'starrocks_monitor'].includes(d));

    const allPipes: Record<string, unknown>[] = [];

    for (const db of databases) {
      try {
        const result = await executeQuery(sessionId, `SHOW PIPES FROM \`${db}\``);
        const rows = result.rows as Record<string, unknown>[];
        for (const row of rows) {
          allPipes.push({ ...row, _db: db });
        }
      } catch { /* skip */ }
    }

    let cachedAt: string | undefined;
    try { cachedAt = setBlobCache('pipes_cache', sessionId, allPipes); } catch { /* non-fatal */ }

    return NextResponse.json({ pipes: allPipes, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action, dbName, pipeName } = await request.json();
    if (!sessionId || !pipeName) {
      return NextResponse.json({ error: 'Session ID and pipe name required' }, { status: 400 });
    }

    const fullName = dbName ? `\`${dbName}\`.\`${pipeName}\`` : `\`${pipeName}\``;

    if (action === 'suspend') {
      await executeQuery(sessionId, `ALTER PIPE ${fullName} SUSPEND`);
      return NextResponse.json({ success: true });
    }
    if (action === 'resume') {
      await executeQuery(sessionId, `ALTER PIPE ${fullName} RESUME`);
      return NextResponse.json({ success: true });
    }
    if (action === 'drop') {
      await executeQuery(sessionId, `DROP PIPE ${fullName}`);
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
