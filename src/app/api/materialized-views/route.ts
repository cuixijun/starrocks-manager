import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId, escapeSqlString } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.MV);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh) {
      const cached = await getBlobCache('materialized_views_cache', sessionId);
      if (cached) {
        return NextResponse.json({ views: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const result = await executeQuery(sessionId,
      `SELECT MATERIALIZED_VIEW_ID, TABLE_SCHEMA, TABLE_NAME, REFRESH_TYPE, IS_ACTIVE,
              INACTIVE_REASON, PARTITION_TYPE, TASK_NAME,
              LAST_REFRESH_START_TIME, LAST_REFRESH_FINISHED_TIME, LAST_REFRESH_DURATION,
              LAST_REFRESH_STATE, LAST_REFRESH_ERROR_CODE, LAST_REFRESH_ERROR_MESSAGE,
              TABLE_ROWS, QUERY_REWRITE_STATUS, CREATOR
       FROM information_schema.materialized_views
       ORDER BY TABLE_SCHEMA, TABLE_NAME`
    , undefined, 'materialized-views');

    const views = result.rows as Record<string, unknown>[];

    let cachedAt: string | undefined;
    try {
      cachedAt = await setBlobCache('materialized_views_cache', sessionId, views);
    } catch { /* non-fatal */ }

    return NextResponse.json({ views, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.MV);
    const body = await request.json();
    const { sessionId, action, dbName, mvName } = body;
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const fullName = dbName && mvName ? `\`${escapeBacktickId(dbName)}\`.\`${escapeBacktickId(mvName)}\`` : mvName ? `\`${escapeBacktickId(mvName)}\`` : '';

    if (action === 'refresh') {
      if (!fullName) return NextResponse.json({ error: 'MV name required' }, { status: 400 });
      await executeQuery(sessionId, `REFRESH MATERIALIZED VIEW ${fullName}`, undefined, 'materialized-views');
      return NextResponse.json({ success: true });
    }

    if (action === 'drop') {
      if (!fullName) return NextResponse.json({ error: 'MV name required' }, { status: 400 });
      await executeQuery(sessionId, `DROP MATERIALIZED VIEW ${fullName}`, undefined, 'materialized-views');
      // Invalidate cache
      try { await setBlobCache('materialized_views_cache', sessionId, null as unknown as Record<string, unknown>[]); } catch { /* ignore */ }
      return NextResponse.json({ success: true });
    }

    if (action === 'show_create') {
      if (!mvName || !dbName) return NextResponse.json({ error: 'DB and MV name required' }, { status: 400 });
      const result = await executeQuery(sessionId, `SHOW CREATE MATERIALIZED VIEW \`${escapeBacktickId(dbName)}\`.\`${escapeBacktickId(mvName)}\``, undefined, 'materialized-views');
      const row = (result.rows as Record<string, unknown>[])[0];
      const definition = row ? String(row['Create Materialized View'] || row['Create Table'] || Object.values(row)[1] || '') : '';
      return NextResponse.json({ definition });
    }

    if (action === 'alter_active') {
      if (!fullName) return NextResponse.json({ error: 'MV name required' }, { status: 400 });
      const active = body.active === true || body.active === 'true';
      await executeQuery(sessionId, `ALTER MATERIALIZED VIEW ${fullName} ${active ? 'ACTIVE' : 'INACTIVE'}`, undefined, 'materialized-views');
      // Invalidate cache
      try { await setBlobCache('materialized_views_cache', sessionId, null as unknown as Record<string, unknown>[]); } catch { /* ignore */ }
      return NextResponse.json({ success: true });
    }

    if (action === 'alter_refresh') {
      if (!fullName) return NextResponse.json({ error: 'MV name required' }, { status: 400 });
      const interval = body.interval; // e.g. "INTERVAL 1 HOUR"
      if (!interval) return NextResponse.json({ error: 'interval is required' }, { status: 400 });
      await executeQuery(sessionId, `ALTER MATERIALIZED VIEW ${fullName} REFRESH ASYNC EVERY(${interval})`, undefined, 'materialized-views');
      try { await setBlobCache('materialized_views_cache', sessionId, null as unknown as Record<string, unknown>[]); } catch { /* ignore */ }
      return NextResponse.json({ success: true });
    }

    if (action === 'alter_resource_group') {
      if (!fullName) return NextResponse.json({ error: 'MV name required' }, { status: 400 });
      const resourceGroup = body.resourceGroup;
      if (!resourceGroup) return NextResponse.json({ error: 'resourceGroup is required' }, { status: 400 });
      await executeQuery(sessionId, `ALTER MATERIALIZED VIEW ${fullName} SET ('resource_group' = '${escapeSqlString(resourceGroup)}')`, undefined, 'materialized-views');
      try { await setBlobCache('materialized_views_cache', sessionId, null as unknown as Record<string, unknown>[]); } catch { /* ignore */ }
      return NextResponse.json({ success: true });
    }

    if (action === 'create') {
      const sql = body.sql;
      if (!sql) return NextResponse.json({ error: 'SQL is required' }, { status: 400 });
      const trimmed = sql.trim().toUpperCase();
      if (!trimmed.startsWith('CREATE MATERIALIZED VIEW') && !trimmed.startsWith('CREATE')) {
        return NextResponse.json({ error: 'SQL must be a CREATE MATERIALIZED VIEW statement' }, { status: 400 });
      }
      if (sql.includes(';')) {
        return NextResponse.json({ error: 'SQL must not contain semicolons' }, { status: 400 });
      }
      await executeQuery(sessionId, sql, undefined, 'materialized-views');
      try { await setBlobCache('materialized_views_cache', sessionId, null as unknown as Record<string, unknown>[]); } catch { /* ignore */ }
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
