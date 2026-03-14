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

    // ── Serve from cache unless explicitly refreshing ──
    if (!refresh) {
      const cached = getBlobCache('roles_cache', sessionId);
      if (cached) {
        return NextResponse.json({ roles: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    // ── Fetch fresh from StarRocks ──
    const result = await executeQuery(sessionId, 'SHOW ROLES');
    const roles = result.rows;

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      cachedAt = setBlobCache('roles_cache', sessionId, roles);
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
    const { sessionId, action, roleName, userName, userHost } = await request.json();
    if (!sessionId || !roleName) {
      return NextResponse.json({ error: 'Session ID and role name required' }, { status: 400 });
    }

    if (action === 'create') {
      await executeQuery(sessionId, `CREATE ROLE '${roleName}'`);
    } else if (action === 'grant' && userName) {
      const host = userHost || '%';
      await executeQuery(sessionId, `GRANT '${roleName}' TO '${userName}'@'${host}'`);
    } else if (action === 'revoke' && userName) {
      const host = userHost || '%';
      await executeQuery(sessionId, `REVOKE '${roleName}' FROM '${userName}'@'${host}'`);
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

    await executeQuery(sessionId, `DROP ROLE '${roleName}'`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
