import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeSqlString } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.ROLES);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // ── Serve from cache unless explicitly refreshing ──
    if (!refresh) {
      const cached = await getBlobCache('roles_cache', sessionId);
      if (cached) {
        return NextResponse.json({ roles: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    // ── Fetch fresh from StarRocks ──
    const result = await executeQuery(sessionId, 'SHOW ROLES', undefined, 'roles');
    const roles = result.rows;

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      cachedAt = await setBlobCache('roles_cache', sessionId, roles);
    } catch { /* non-fatal */ }

    return NextResponse.json({ roles, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.ROLES);
    const { sessionId, action, roleName, userName, userHost } = await request.json();
    if (!sessionId || !roleName) {
      return NextResponse.json({ error: 'Session ID and role name required' }, { status: 400 });
    }

    const safeRole = escapeSqlString(roleName);
    if (action === 'create') {
      await executeQuery(sessionId, `CREATE ROLE '${safeRole}'`, undefined, 'roles');
    } else if (action === 'grant' && userName) {
      const safeUser = escapeSqlString(userName);
      const safeHost = escapeSqlString(userHost || '%');
      await executeQuery(sessionId, `GRANT '${safeRole}' TO '${safeUser}'@'${safeHost}'`, undefined, 'roles');
    } else if (action === 'revoke' && userName) {
      const safeUser = escapeSqlString(userName);
      const safeHost = escapeSqlString(userHost || '%');
      await executeQuery(sessionId, `REVOKE '${safeRole}' FROM '${safeUser}'@'${safeHost}'`, undefined, 'roles');
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId, roleName } = await request.json();
    if (!sessionId || !roleName) {
      return NextResponse.json({ error: 'Session ID and role name required' }, { status: 400 });
    }

    await executeQuery(sessionId, `DROP ROLE '${escapeSqlString(roleName)}'`, undefined, 'roles');
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
