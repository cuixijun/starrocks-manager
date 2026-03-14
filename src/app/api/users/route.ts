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
      const cached = getBlobCache('users_cache', sessionId);
      if (cached) {
        return NextResponse.json({ users: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    // ── Fetch fresh from StarRocks ──
    let userIdentities: string[] = [];
    let rawRows: unknown[] = [];
    let fields: unknown[] = [];

    try {
      const showUsers = await executeQuery(sessionId, 'SHOW USERS');
      const rows = Array.isArray(showUsers.rows)
        ? (Array.isArray(showUsers.rows[0]) ? showUsers.rows[0] : showUsers.rows)
        : [];
      rawRows = rows;
      fields = showUsers.fields || [];

      if (rows.length > 0) {
        userIdentities = (rows as Record<string, unknown>[]).map(r => {
          if (typeof r === 'string') return r as string;
          const userVal = r['USER'] || r['User'] || r['user'] || Object.values(r)[0];
          return String(userVal || '');
        }).filter(Boolean);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('Not connected')) throw e;
    }

    if (userIdentities.length === 0) {
      try {
        const allGrants = await executeQuery(sessionId, 'SHOW ALL GRANTS');
        const rows = Array.isArray(allGrants.rows)
          ? (Array.isArray(allGrants.rows[0]) ? allGrants.rows[0] : allGrants.rows)
          : [];
        rawRows = rows.length > 0 ? rows : rawRows;
        fields = (allGrants.fields?.length ?? 0) > 0 ? allGrants.fields : fields;

        if (rows.length > 0) {
          const sampleRow = rows[0] as Record<string, unknown>;
          const fieldNames = Object.keys(sampleRow);
          const identityField = fieldNames.find(f => /user.?identity|grantee|user/i.test(f)) || fieldNames[0];
          const identities = new Set<string>();
          for (const row of rows as Record<string, unknown>[]) {
            const identity = String(row[identityField] || '');
            if (identity) identities.add(identity);
          }
          userIdentities = Array.from(identities);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message?.includes('Not connected')) throw e;
      }
    }

    userIdentities = Array.from(new Set(userIdentities));

    const userDataList = await Promise.all(
      userIdentities.map(async (identity) => {
        try {
          const grantsResp = await executeQuery(sessionId, `SHOW GRANTS FOR ${identity}`);
          const grantsRows = Array.isArray(grantsResp.rows)
            ? (Array.isArray(grantsResp.rows[0]) ? grantsResp.rows[0] : grantsResp.rows)
            : [];
          return {
            identity,
            grants: (grantsRows as Record<string, unknown>[]).map(r => Object.values(r).join(' | ')),
          };
        } catch {
          return { identity, grants: [] };
        }
      })
    );

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      cachedAt = setBlobCache('users_cache', sessionId, userDataList);
    } catch { /* non-fatal */ }

    return NextResponse.json({ users: userDataList, fields, rawRows, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, username, host, password, roles } = await request.json();
    if (!sessionId || !username) {
      return NextResponse.json({ error: 'Session ID and username required' }, { status: 400 });
    }

    const userHost = host || '%';
    let sql = `CREATE USER '${username}'@'${userHost}'`;
    if (password) sql += ` IDENTIFIED BY '${password}'`;
    await executeQuery(sessionId, sql);

    if (roles && roles.length > 0) {
      for (const role of roles) {
        await executeQuery(sessionId, `GRANT '${role}' TO '${username}'@'${userHost}'`);
      }
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
    const { sessionId, username, host } = await request.json();
    if (!sessionId || !username) {
      return NextResponse.json({ error: 'Session ID and username required' }, { status: 400 });
    }

    const userHost = host || '%';
    await executeQuery(sessionId, `DROP USER '${username}'@'${userHost}'`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
