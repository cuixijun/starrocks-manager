import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { escapeBacktickId } from '@/lib/sql-sanitize';
import { upsertDbCache, getDbCache, recordAuditLog } from '@/lib/local-db';
import { getAuthFromRequest, validateSession, AuthError } from '@/lib/auth';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DATABASES);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // ── Serve from cache unless explicitly refreshing ──
    if (!refresh) {
      const cached = await getDbCache(sessionId);
      if (cached.length > 0) {
        return NextResponse.json({
          databases: cached.map(c => ({
            name: c.db_name,
            tableCount: c.table_count,
            viewCount: c.view_count ?? 0,
            mvCount: c.mv_count ?? 0,
            tables: [],
          })),
          cachedAt: cached[0].cached_at,
          fromCache: true,
        });
      }
    }

    // ── Fetch fresh from StarRocks (all 3 queries in parallel) ──
    const [dbResult, tableAgg, mvAgg] = await Promise.all([
      // 1) Get all database names
      executeQuery(sessionId, 'SHOW DATABASES', undefined, 'databases'),

      // 2) Aggregated table/view counts per schema
      executeQuery(
        sessionId,
        `SELECT TABLE_SCHEMA, TABLE_TYPE, COUNT(*) AS cnt
         FROM information_schema.tables
         GROUP BY TABLE_SCHEMA, TABLE_TYPE`,
        undefined, 'databases'
      ).catch(() => ({ rows: [], fields: [] })),

      // 3) MV counts per schema
      executeQuery(
        sessionId,
        `SELECT TABLE_SCHEMA, COUNT(*) AS cnt
         FROM information_schema.materialized_views
         GROUP BY TABLE_SCHEMA`,
        undefined, 'databases'
      ).catch(() => ({ rows: [], fields: [] })),
    ]);

    const dbNames = dbResult.rows.map((r: Record<string, unknown>) =>
      String(r['Database'] || r['database'] || Object.values(r)[0])
    );

    // 3) Build counts map from aggregated results
    // tableCountMap[schema] = { tables: N, views: N }
    const countMap = new Map<string, { tables: number; views: number }>();
    for (const row of tableAgg.rows as Record<string, unknown>[]) {
      const schema = String(row['TABLE_SCHEMA'] || '');
      const tableType = String(row['TABLE_TYPE'] || '').toUpperCase();
      const cnt = Number(row['cnt'] || 0);
      if (!countMap.has(schema)) countMap.set(schema, { tables: 0, views: 0 });
      const entry = countMap.get(schema)!;
      if (tableType === 'VIEW' || tableType === 'SYSTEM VIEW') {
        entry.views += cnt;
      } else {
        entry.tables += cnt;
      }
    }

    // mvCountMap[schema] = N
    const mvCountMap = new Map<string, number>();
    for (const row of mvAgg.rows as Record<string, unknown>[]) {
      const schema = String(row['TABLE_SCHEMA'] || '');
      const cnt = Number(row['cnt'] || 0);
      mvCountMap.set(schema, cnt);
    }

    // 4) Assemble final result (subtract MV count from table count since MVs show as BASE TABLE)
    const dbDetails = dbNames.map(name => {
      const counts = countMap.get(name) || { tables: 0, views: 0 };
      const mvCount = mvCountMap.get(name) || 0;
      return {
        name,
        tableCount: Math.max(0, counts.tables - mvCount), // MVs are counted as BASE TABLE, subtract
        viewCount: counts.views,
        mvCount,
        tables: [],
      };
    });

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      await upsertDbCache(sessionId, dbDetails.map(d => ({ name: d.name, tableCount: d.tableCount, viewCount: d.viewCount, mvCount: d.mvCount })));
      const cached = await getDbCache(sessionId);
      cachedAt = cached[0]?.cached_at;
    } catch {
      // non-fatal
    }

    return NextResponse.json({ databases: dbDetails, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ── CREATE DATABASE ──
export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DATABASES);
    const { sessionId, name } = await request.json();
    if (!sessionId || !name) {
      return NextResponse.json({ error: 'sessionId and name are required' }, { status: 400 });
    }
    // Validate database name: alphanumeric + underscore only
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return NextResponse.json({ error: '数据库名只能包含字母、数字和下划线，且不能以数字开头' }, { status: 400 });
    }
    if (name.length > 64) {
      return NextResponse.json({ error: '数据库名不能超过64个字符' }, { status: 400 });
    }

    await executeQuery(sessionId, `CREATE DATABASE IF NOT EXISTS \`${escapeBacktickId(name)}\``, undefined, 'databases');

    // Audit: database.create
    const token = getAuthFromRequest(request);
    const sess = token ? await validateSession(token) : null;
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: sess?.user?.id, username: sess?.user?.username || 'unknown',
      action: 'database.create', category: 'query', level: 'basic',
      target: `数据库 ${name}`, ipAddress: ip,
    });

    return NextResponse.json({ success: true, message: `数据库 ${name} 创建成功` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ── DROP DATABASE ──
export async function DELETE(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DATABASES);
    const { sessionId, name, force } = await request.json();
    if (!sessionId || !name) {
      return NextResponse.json({ error: 'sessionId and name are required' }, { status: 400 });
    }
    // Protect system databases
    const systemDbs = ['information_schema', '_statistics_', 'sys'];
    if (systemDbs.includes(name.toLowerCase())) {
      return NextResponse.json({ error: `不允许删除系统数据库 ${name}` }, { status: 400 });
    }

    const sql = force
      ? `DROP DATABASE \`${escapeBacktickId(name)}\` FORCE`
      : `DROP DATABASE IF EXISTS \`${escapeBacktickId(name)}\``;
    await executeQuery(sessionId, sql, undefined, 'databases');

    // Audit: database.drop
    const token = getAuthFromRequest(request);
    const sess = token ? await validateSession(token) : null;
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: sess?.user?.id, username: sess?.user?.username || 'unknown',
      action: 'database.drop', category: 'query', level: 'basic',
      target: `数据库 ${name}`, detail: { force: !!force }, ipAddress: ip,
    });

    return NextResponse.json({ success: true, message: `数据库 ${name} 已删除` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
