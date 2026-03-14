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
      const cached = getBlobCache('functions_cache', sessionId);
      if (cached) {
        return NextResponse.json({ functions: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const allFunctions: Record<string, unknown>[] = [];

    // 1. Fetch global UDFs: SHOW GLOBAL FUNCTIONS
    try {
      const globalFns = await executeQuery(sessionId, 'SHOW GLOBAL FUNCTIONS');
      for (const row of globalFns.rows as Record<string, unknown>[]) {
        allFunctions.push({ ...row, _scope: 'GLOBAL' });
      }
    } catch {
      // Version may not support SHOW GLOBAL FUNCTIONS
    }

    // 2. Fetch per-database UDFs: SHOW FUNCTIONS IN <db>
    try {
      const dbResult = await executeQuery(sessionId, 'SHOW DATABASES');
      const databases = (dbResult.rows as Record<string, unknown>[])
        .map(r => String(r['Database'] || Object.values(r)[0] || ''))
        .filter(d => d && d !== 'information_schema');

      for (const db of databases) {
        try {
          const dbFns = await executeQuery(sessionId, `SHOW FUNCTIONS IN \`${db}\``);
          for (const row of dbFns.rows as Record<string, unknown>[]) {
            allFunctions.push({ ...row, _scope: db });
          }
        } catch {
          // Some databases may not allow SHOW FUNCTIONS
        }
      }
    } catch {
      // If SHOW DATABASES fails, we already have global functions at least
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
