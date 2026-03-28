import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { escapeSqlString, validatePrivilege, validateObjectType, validateIdentifier } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.PRIVILEGES);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const user = request.nextUrl.searchParams.get('user');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (user) {
      // Get grants for specific user — escape user input
      const safeUser = escapeSqlString(user);
      const grants = await executeQuery(sessionId, `SHOW GRANTS FOR '${safeUser}'`, undefined, 'privileges').catch(() => ({ rows: [], fields: [] }));
      return NextResponse.json({ grants: grants.rows });
    }

    // Get all grants
    const grants = await executeQuery(sessionId, 'SHOW ALL GRANTS', undefined, 'privileges').catch(() => ({ rows: [], fields: [] }));
    return NextResponse.json({ grants: grants.rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action, privilege, objectType, objectName, grantee, granteeType } = await request.json();
    if (!sessionId || !privilege || !grantee) {
      return NextResponse.json({ error: 'Session ID, privilege, and grantee required' }, { status: 400 });
    }

    const safePrivilege = validatePrivilege(privilege);
    const onClause = objectType && objectName
      ? `ON ${validateObjectType(objectType)} ${validateIdentifier(objectName, 'objectName') && objectName}`
      : 'ON ALL DATABASES';

    const toFrom = action === 'revoke' ? 'FROM' : 'TO';
    const verb = action === 'revoke' ? 'REVOKE' : 'GRANT';

    let target: string;
    if (granteeType === 'role') {
      target = `ROLE '${escapeSqlString(grantee)}'`;
    } else {
      target = `'${escapeSqlString(grantee)}'`;
    }

    const sql = `${verb} ${safePrivilege} ${onClause} ${toFrom} ${target}`;
    await executeQuery(sessionId, sql, undefined, 'privileges');

    return NextResponse.json({ success: true, sql });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
