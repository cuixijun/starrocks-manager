import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.FUNCTIONS);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh) {
      const cached = getBlobCache('functions_cache', sessionId);
      if (cached) {
        return NextResponse.json({ functions: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const allFunctions: Record<string, unknown>[] = [];

    // 1. Try SHOW GLOBAL FUNCTIONS — returns ALL UDFs in one query (StarRocks 3.0+)
    let usedGlobalQuery = false;
    try {
      const globalFns = await executeQuery(sessionId, 'SHOW GLOBAL FUNCTIONS', undefined, 'functions');
      for (const row of globalFns.rows as Record<string, unknown>[]) {
        allFunctions.push({ ...row, _scope: 'GLOBAL' });
      }
      usedGlobalQuery = true;
    } catch {
      // Version may not support SHOW GLOBAL FUNCTIONS
    }

    // 2. Also fetch per-database UDFs (non-global scope) if SHOW GLOBAL FUNCTIONS failed,
    //    or supplement with per-database UDFs in all cases
    if (!usedGlobalQuery) {
      try {
        const dbResult = await executeQuery(sessionId, 'SHOW DATABASES', undefined, 'functions');
        const databases = (dbResult.rows as Record<string, unknown>[])
          .map(r => String(r['Database'] || Object.values(r)[0] || ''))
          .filter(d => d && d !== 'information_schema');

        // Use Promise.all for parallel execution instead of sequential loop
        const results = await Promise.all(
          databases.map(async (db) => {
            try {
              const dbFns = await executeQuery(sessionId, `SHOW FUNCTIONS IN \`${escapeBacktickId(db)}\``, undefined, 'functions');
              return (dbFns.rows as Record<string, unknown>[]).map(row => ({ ...row, _scope: db }));
            } catch {
              return [];
            }
          })
        );
        for (const rows of results) {
          allFunctions.push(...rows);
        }
      } catch {
        // If SHOW DATABASES fails, we may not have any functions
      }
    }

    let cachedAt: string | undefined;
    try {
      cachedAt = setBlobCache('functions_cache', sessionId, allFunctions);
    } catch { /* non-fatal */ }

    return NextResponse.json({ functions: allFunctions, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

