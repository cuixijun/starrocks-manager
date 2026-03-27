import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeSqlString } from '@/lib/sql-sanitize';

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

    // ── Fetch fresh from StarRocks (optimized: batch grant fetching) ──

    // Step 1: Get user list
    let userIdentities: string[] = [];

    try {
      const showUsers = await executeQuery(sessionId, 'SHOW USERS', undefined, 'users');
      const rows = Array.isArray(showUsers.rows)
        ? (Array.isArray(showUsers.rows[0]) ? showUsers.rows[0] : showUsers.rows)
        : [];

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

    // Step 2: Batch fetch all grants with SHOW ALL GRANTS (single query instead of N)
    const grantsMap = new Map<string, string[]>();
    let usedBatchGrants = false;

    try {
      const allGrants = await executeQuery(sessionId, 'SHOW ALL GRANTS', undefined, 'users');
      const rows = Array.isArray(allGrants.rows)
        ? (Array.isArray(allGrants.rows[0]) ? allGrants.rows[0] : allGrants.rows)
        : [];

      if (rows.length > 0) {
        usedBatchGrants = true;
        const sampleRow = rows[0] as Record<string, unknown>;
        const fieldNames = Object.keys(sampleRow);
        const identityField = fieldNames.find(f => /user.?identity|grantee|user/i.test(f)) || fieldNames[0];

        for (const row of rows as Record<string, unknown>[]) {
          const identity = String(row[identityField] || '');
          if (!identity) continue;
          const grant = Object.values(row).map(v => String(v ?? '')).join(' | ');
          if (!grantsMap.has(identity)) grantsMap.set(identity, []);
          grantsMap.get(identity)!.push(grant);
        }

        // If SHOW USERS failed, extract user list from grants
        if (userIdentities.length === 0) {
          userIdentities = Array.from(grantsMap.keys());
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('Not connected')) throw e;
      // SHOW ALL GRANTS might not be available — fall back to per-user below
    }

    userIdentities = Array.from(new Set(userIdentities));

    // Step 3: Build user data (use batched grants if available, otherwise fall back to per-user)
    let userDataList: { identity: string; grants: string[] }[];

    if (usedBatchGrants) {
      // Fast path: grants already collected in batch
      userDataList = userIdentities.map(identity => ({
        identity,
        grants: grantsMap.get(identity) || [],
      }));
    } else {
      // Slow fallback: per-user grant queries (only if SHOW ALL GRANTS unavailable)
      userDataList = await Promise.all(
        userIdentities.map(async (identity) => {
          try {
            const grantsResp = await executeQuery(sessionId, `SHOW GRANTS FOR ${identity}`, undefined, 'users');
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
    }

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      cachedAt = setBlobCache('users_cache', sessionId, userDataList);
    } catch { /* non-fatal */ }

    return NextResponse.json({ users: userDataList, cachedAt, fromCache: false });
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

    const safeUser = escapeSqlString(username);
    const safeHost = escapeSqlString(host || '%');
    let sql = `CREATE USER '${safeUser}'@'${safeHost}'`;
    if (password) sql += ` IDENTIFIED BY '${escapeSqlString(password)}'`;
    await executeQuery(sessionId, sql, undefined, 'users');

    if (roles && roles.length > 0) {
      for (const role of roles) {
        await executeQuery(sessionId, `GRANT '${escapeSqlString(role)}' TO '${safeUser}'@'${safeHost}'`, undefined, 'users');
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

    const safeUser = escapeSqlString(username);
    const safeHost = escapeSqlString(host || '%');
    await executeQuery(sessionId, `DROP USER '${safeUser}'@'${safeHost}'`, undefined, 'users');
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ── Change password ──
export async function PATCH(request: NextRequest) {
  try {
    const { sessionId, username, host, password } = await request.json();
    if (!sessionId || !username || !password) {
      return NextResponse.json({ error: 'sessionId, username, password required' }, { status: 400 });
    }
    // Server-side password complexity check
    if (password.length < 8) {
      return NextResponse.json({ error: '密码长度不能少于8位' }, { status: 400 });
    }
    if (!/[A-Z]/.test(password)) {
      return NextResponse.json({ error: '密码必须包含大写字母' }, { status: 400 });
    }
    if (!/[a-z]/.test(password)) {
      return NextResponse.json({ error: '密码必须包含小写字母' }, { status: 400 });
    }
    if (!/[0-9]/.test(password)) {
      return NextResponse.json({ error: '密码必须包含数字' }, { status: 400 });
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      return NextResponse.json({ error: '密码必须包含特殊字符' }, { status: 400 });
    }

    const safeUser = escapeSqlString(username);
    const safeHost = escapeSqlString(host || '%');
    const safePwd = escapeSqlString(password);
    await executeQuery(sessionId, `ALTER USER '${safeUser}'@'${safeHost}' IDENTIFIED BY '${safePwd}'`, undefined, 'users');
    return NextResponse.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
