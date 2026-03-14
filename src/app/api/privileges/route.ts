import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const user = request.nextUrl.searchParams.get('user');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (user) {
      // Get grants for specific user
      const grants = await executeQuery(sessionId, `SHOW GRANTS FOR '${user}'`).catch(() => ({ rows: [], fields: [] }));
      return NextResponse.json({ grants: grants.rows });
    }

    // Get all grants
    const grants = await executeQuery(sessionId, 'SHOW ALL GRANTS').catch(() => ({ rows: [], fields: [] }));
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

    const onClause = objectType && objectName
      ? `ON ${objectType} ${objectName}`
      : 'ON ALL DATABASES';

    const toFrom = action === 'revoke' ? 'FROM' : 'TO';
    const verb = action === 'revoke' ? 'REVOKE' : 'GRANT';

    let target: string;
    if (granteeType === 'role') {
      target = `ROLE '${grantee}'`;
    } else {
      target = `'${grantee}'`;
    }

    const sql = `${verb} ${privilege} ${onClause} ${toFrom} ${target}`;
    await executeQuery(sessionId, sql);

    return NextResponse.json({ success: true, sql });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
