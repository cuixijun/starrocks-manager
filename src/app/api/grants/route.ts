import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { validateIdentifier, validatePrivilege, validateObjectType, escapeSqlString } from '@/lib/sql-sanitize';
import { recordAuditLog } from '@/lib/local-db';
import { getAuthFromRequest, validateSession, AuthError } from '@/lib/auth';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';

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
    await requirePermission(request, PERMISSIONS.PRIVILEGES);
    const body = await request.json();
    const { sessionId, action, grantee, privilege, objectType, objectName, roleName } = body;

    if (!sessionId || !grantee) {
      return NextResponse.json({ error: 'sessionId and grantee required' }, { status: 400 });
    }

    let sql = '';

    // Validate inputs before SQL construction
    validateIdentifier(grantee, 'grantee');

    if (action === 'grant_privilege') {
      if (!privilege || !objectType || !objectName) {
        return NextResponse.json({ error: 'privilege, objectType, objectName required' }, { status: 400 });
      }
      const safePrivilege = validatePrivilege(privilege);
      const safeObjectType = validateObjectType(objectType);
      validateIdentifier(objectName, 'objectName');
      sql = `GRANT ${safePrivilege} ON ${safeObjectType} ${objectName} TO ${grantee}`;
    } else if (action === 'revoke_privilege') {
      if (!privilege || !objectType || !objectName) {
        return NextResponse.json({ error: 'privilege, objectType, objectName required' }, { status: 400 });
      }
      const safePrivilege = validatePrivilege(privilege);
      const safeObjectType = validateObjectType(objectType);
      validateIdentifier(objectName, 'objectName');
      sql = `REVOKE ${safePrivilege} ON ${safeObjectType} ${objectName} FROM ${grantee}`;
    } else if (action === 'grant_role') {
      if (!roleName) {
        return NextResponse.json({ error: 'roleName required' }, { status: 400 });
      }
      const safeRole = escapeSqlString(roleName);
      sql = `GRANT '${safeRole}' TO ${grantee}`;
    } else if (action === 'revoke_role') {
      if (!roleName) {
        return NextResponse.json({ error: 'roleName required' }, { status: 400 });
      }
      const safeRole = escapeSqlString(roleName);
      sql = `REVOKE '${safeRole}' FROM ${grantee}`;
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    await executeQuery(sessionId, sql, undefined, 'grants');

    // Audit: permission change
    const token = getAuthFromRequest(request);
    const sess = token ? await validateSession(token) : null;
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: sess?.user?.id, username: sess?.user?.username || 'unknown',
      action: `permission.${action}`, category: 'permission', level: 'basic',
      target: grantee,
      detail: { sql, action, grantee, privilege, objectType, objectName, roleName },
      ipAddress: ip,
    });

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

    // Validate target to prevent injection
    validateIdentifier(target, 'target');

    // SHOW GRANTS FOR returns 3 columns: identity, catalog, grant statement.
    // Detect column names from result fields to correctly identify catalog and grant columns.
    const result = await executeQuery(sessionId, `SHOW GRANTS FOR ${target}`, undefined, 'grants');
    const rows = result.rows as Record<string, unknown>[];
    const fieldNames = result.fields.map(f => f.name);

    // Identify column names by pattern
    const catalogCol = fieldNames.find(n => /catalog/i.test(n)) || '';
    const grantCol = fieldNames.find(n => /grant|privileg/i.test(n)) || '';

    const grants: string[] = [];
    const catalogGrants: { grant: string; catalog: string }[] = [];

    for (const row of rows) {
      let grant = '';
      let catalog = 'default_catalog';

      // Use identified column names if available
      if (grantCol && row[grantCol] != null) {
        grant = String(row[grantCol]);
      }
      if (catalogCol && row[catalogCol] != null) {
        catalog = String(row[catalogCol]);
      }

      // Fallback: scan values if column name detection failed
      if (!grant) {
        const vals = Object.values(row).map(v => String(v ?? ''));
        for (const val of vals) {
          if (val.startsWith('GRANT ')) { grant = val; break; }
        }
        if (!grant) grant = vals.join(' | ');
      }

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

