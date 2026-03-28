import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { validateNumeric } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const result = await executeQuery(sessionId, 'SHOW PROCESSLIST', undefined, 'dashboard');
    return NextResponse.json({ queries: result.rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const { sessionId, queryId } = await request.json();
    if (!sessionId || !queryId) {
      return NextResponse.json({ error: 'Session ID and query ID required' }, { status: 400 });
    }

    const safeId = validateNumeric(queryId, 'queryId');
    await executeQuery(sessionId, `KILL ${safeId}`, undefined, 'dashboard');
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
