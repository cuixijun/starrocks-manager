import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.PIPES);
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

    // Single query via information_schema.pipes — replaces the old N+1 pattern
    // (was: SHOW DATABASES + SHOW PIPES FROM `db` for each database)
    // The frontend already handles UPPER_SNAKE_CASE column names (PIPE_NAME, STATE, etc.)
    const result = await executeQuery(
      sessionId,
      `SELECT * FROM information_schema.pipes ORDER BY PIPE_ID DESC`,
      undefined,
      'pipes'
    );

    const rows = result.rows as Record<string, unknown>[];
    const allPipes = rows.map(row => ({
      ...row,
      _db: String(row['DATABASE_NAME'] || row['database_name'] || ''),
    }));

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
    requirePermission(request, PERMISSIONS.PIPES);
    const { sessionId, action, dbName, pipeName } = await request.json();
    if (!sessionId || !pipeName) {
      return NextResponse.json({ error: 'Session ID and pipe name required' }, { status: 400 });
    }

    const fullName = dbName ? `\`${escapeBacktickId(dbName)}\`.\`${escapeBacktickId(pipeName)}\`` : `\`${escapeBacktickId(pipeName)}\``;

    if (action === 'suspend') {
      await executeQuery(sessionId, `ALTER PIPE ${fullName} SUSPEND`, undefined, 'pipes');
      return NextResponse.json({ success: true });
    }
    if (action === 'resume') {
      await executeQuery(sessionId, `ALTER PIPE ${fullName} RESUME`, undefined, 'pipes');
      return NextResponse.json({ success: true });
    }
    if (action === 'drop') {
      await executeQuery(sessionId, `DROP PIPE ${fullName}`, undefined, 'pipes');
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
