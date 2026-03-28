import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { validateVarName, escapeSqlString } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.VARIABLES);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';
    const scope = request.nextUrl.searchParams.get('scope') || 'session'; // session | global

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const cacheKey = `${scope}_${sessionId}`;

    if (!refresh) {
      const cached = await getBlobCache('variables_cache', cacheKey);
      if (cached) {
        return NextResponse.json({ variables: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const sql = scope === 'global' ? 'SHOW GLOBAL VARIABLES' : 'SHOW VARIABLES';
    const result = await executeQuery(sessionId, sql, undefined, 'variables');
    const variables = result.rows;

    let cachedAt: string | undefined;
    try {
      cachedAt = await setBlobCache('variables_cache', cacheKey, variables);
    } catch { /* non-fatal */ }

    return NextResponse.json({ variables, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.VARIABLES);
    const { sessionId, name, value, global } = await request.json();
    if (!sessionId || !name) {
      return NextResponse.json({ error: 'Session ID and variable name required' }, { status: 400 });
    }

    const safeName = validateVarName(name);
    const sql = global
      ? `SET GLOBAL ${safeName} = ${typeof value === 'string' ? `'${escapeSqlString(value)}'` : Number(value)}`
      : `SET ${safeName} = ${typeof value === 'string' ? `'${escapeSqlString(value)}'` : Number(value)}`;

    await executeQuery(sessionId, sql, undefined, 'variables');
    return NextResponse.json({ success: true, sql });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
