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
          databases: cached.map(c => ({ name: c.db_name, tableCount: c.table_count, tables: [] })),
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
            `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, CREATE_TIME, UPDATE_TIME
             FROM information_schema.tables WHERE TABLE_SCHEMA = ?`,
            [dbName]
          );
          return { name: dbName, tableCount: tables.rows.length, tables: tables.rows };
        } catch {
          return { name: dbName, tableCount: 0, tables: [] };
        }
      })
    );

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      upsertDbCache(sessionId, dbDetails.map(d => ({ name: d.name, tableCount: d.tableCount })));
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
