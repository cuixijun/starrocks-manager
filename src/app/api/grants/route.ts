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
 * Returns grants for a specific user or role across ALL catalogs.
 *
 * Response:
 *   grants: string[]         — raw GRANT statement strings (backward‑compat)
 *   catalogGrants: { grant: string, catalog: string }[]  — tagged with source catalog
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const target = request.nextUrl.searchParams.get('target');

    if (!sessionId || !target) {
      return NextResponse.json({ error: 'sessionId and target required' }, { status: 400 });
    }

    // Helper: extract GRANT statement from a row (last column that starts with "GRANT")
    function extractGrant(row: Record<string, unknown>): string {
      const vals = Object.values(row).map(v => String(v ?? ''));
      // The GRANT column is typically the last or the one starting with "GRANT"
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i].startsWith('GRANT ')) return vals[i];
      }
      return vals.join(' | ');
    }

    const grantMap = new Map<string, string>(); // grant → catalog

    // 1. Query grants on default catalog
    try {
      const result = await executeQuery(sessionId, `SHOW GRANTS FOR ${target}`);
      const rows = result.rows as Record<string, unknown>[];
      for (const r of rows) {
        const grant = extractGrant(r);
        if (!grantMap.has(grant)) grantMap.set(grant, 'default_catalog');
      }
    } catch {
      // ignore
    }

    // 2. Get all catalogs
    let catalogs: string[] = [];
    try {
      const catResult = await executeQuery(sessionId, 'SHOW CATALOGS');
      const catRows = catResult.rows as Record<string, unknown>[];
      catalogs = catRows
        .map(r => String(Object.values(r)[0] || ''))
        .filter(name => name && name !== 'default_catalog');
    } catch {
      // ignore
    }

    // 3. For each external catalog, SET CATALOG + SHOW GRANTS
    for (const catalog of catalogs) {
      try {
        await executeQuery(sessionId, `SET CATALOG ${catalog}`);
        const result = await executeQuery(sessionId, `SHOW GRANTS FOR ${target}`);
        const rows = result.rows as Record<string, unknown>[];
        for (const r of rows) {
          const grant = extractGrant(r);
          if (!grantMap.has(grant)) grantMap.set(grant, catalog);
        }
      } catch {
        // skip catalogs we can't access
      }
    }

    // 4. Switch back to default_catalog
    try {
      await executeQuery(sessionId, 'SET CATALOG default_catalog');
    } catch {
      // ignore
    }

    // Build response
    const grants: string[] = [];
    const catalogGrants: { grant: string; catalog: string }[] = [];
    for (const [grant, catalog] of grantMap) {
      grants.push(grant);
      catalogGrants.push({ grant, catalog });
    }

    return NextResponse.json({ grants, catalogGrants });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
