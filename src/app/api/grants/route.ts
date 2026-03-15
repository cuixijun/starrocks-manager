import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

/**
 * POST /api/grants — Execute GRANT / REVOKE statements
 *
 * Body: {
 *   sessionId: string,
 *   action: 'grant_privilege' | 'revoke_privilege' | 'grant_role' | 'revoke_role',
 *   grantee: string,       // e.g. USER 'root'@'%' or ROLE 'analyst'
 *   privilege?: string,    // e.g. 'SELECT', 'ALL'
 *   objectType?: string,   // e.g. 'TABLE', 'DATABASE', 'CATALOG', 'GLOBAL FUNCTION', 'MATERIALIZED VIEW'
 *   objectName?: string,   // e.g. 'bigdata.orders' or '*.*'
 *   roleName?: string,     // for grant_role / revoke_role
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, action, grantee, privilege, objectType, objectName, roleName } = body;

    if (!sessionId || !grantee) {
      return NextResponse.json({ error: 'sessionId and grantee required' }, { status: 400 });
    }

    let sql = '';

    if (action === 'grant_privilege') {
      if (!privilege || !objectType || !objectName) {
        return NextResponse.json({ error: 'privilege, objectType, objectName required' }, { status: 400 });
      }
      sql = `GRANT ${privilege} ON ${objectType} ${objectName} TO ${grantee}`;
    } else if (action === 'revoke_privilege') {
      if (!privilege || !objectType || !objectName) {
        return NextResponse.json({ error: 'privilege, objectType, objectName required' }, { status: 400 });
      }
      sql = `REVOKE ${privilege} ON ${objectType} ${objectName} FROM ${grantee}`;
    } else if (action === 'grant_role') {
      if (!roleName) {
        return NextResponse.json({ error: 'roleName required' }, { status: 400 });
      }
      sql = `GRANT '${roleName}' TO ${grantee}`;
    } else if (action === 'revoke_role') {
      if (!roleName) {
        return NextResponse.json({ error: 'roleName required' }, { status: 400 });
      }
      sql = `REVOKE '${roleName}' FROM ${grantee}`;
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    await executeQuery(sessionId, sql);
    return NextResponse.json({ success: true, sql });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/grants?sessionId=...&target=USER 'root'@'%'
 * Returns grants for a specific user or role
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const target = request.nextUrl.searchParams.get('target');

    if (!sessionId || !target) {
      return NextResponse.json({ error: 'sessionId and target required' }, { status: 400 });
    }

    const result = await executeQuery(sessionId, `SHOW GRANTS FOR ${target}`);
    const rows = result.rows as Record<string, unknown>[];
    const grants = rows.map(r => Object.values(r).join(' | '));

    return NextResponse.json({ grants });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
