import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { upsertDbCache, getDbCache, setBlobCache } from '@/lib/local-db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // ── Serve from cache unless explicitly refreshing ──
    if (!refresh) {
      const cached = getDbCache(sessionId);
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

    // ── Fetch fresh from StarRocks ──
    const result = await executeQuery(sessionId, 'SHOW DATABASES');
    const databases = result.rows.map((r: Record<string, unknown>) =>
      String(r['Database'] || r['database'] || Object.values(r)[0])
    );

    const dbDetails = await Promise.all(
      databases.map(async (dbName) => {
        try {
          const tables = await executeQuery(
            sessionId,
            `SELECT TABLE_NAME, TABLE_TYPE
             FROM information_schema.tables WHERE TABLE_SCHEMA = ?`,
            [dbName]
          );

          // Query MVs separately — StarRocks stores them as BASE TABLE in information_schema.tables
          let mvNames: Set<string> = new Set();
          try {
            const mvResult = await executeQuery(
              sessionId,
              `SELECT TABLE_NAME FROM information_schema.materialized_views WHERE TABLE_SCHEMA = ?`,
              [dbName]
            );
            mvNames = new Set(mvResult.rows.map((r: Record<string, unknown>) =>
              String(r['TABLE_NAME'] || Object.values(r)[0])
            ));
          } catch {
            // materialized_views table might not exist in older versions
          }

          // Split counts by TABLE_TYPE, excluding MVs from table count
          let tableCount = 0;
          let viewCount = 0;
          const mvCount = mvNames.size;
          for (const row of tables.rows) {
            const tableType = String((row as Record<string, unknown>)['TABLE_TYPE'] || '').toUpperCase();
            const tableName = String((row as Record<string, unknown>)['TABLE_NAME'] || '');
            if (tableType === 'VIEW' || tableType === 'SYSTEM VIEW') {
              viewCount++;
            } else if (mvNames.has(tableName)) {
              // Already counted in mvCount, skip
            } else {
              tableCount++;
            }
          }
          return { name: dbName, tableCount, viewCount, mvCount, tables: tables.rows };
        } catch {
          return { name: dbName, tableCount: 0, viewCount: 0, mvCount: 0, tables: [] };
        }
      })
    );

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      upsertDbCache(sessionId, dbDetails.map(d => ({ name: d.name, tableCount: d.tableCount, viewCount: d.viewCount, mvCount: d.mvCount })));
      // Use the first cached_at as the representative timestamp
      const cached = getDbCache(sessionId);
      cachedAt = cached[0]?.cached_at;
    } catch {
      // non-fatal
    }

    // Also store full list in blob cache (reuse same key pattern via setBlobCache for consistency)
    try {
      setBlobCache('users_cache', `__dbs_${sessionId}`, null); // not needed, db_metadata_cache handles it
    } catch { /* ignore */ }

    return NextResponse.json({ databases: dbDetails, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
