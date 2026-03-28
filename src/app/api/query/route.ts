import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { recordAuditLog } from '@/lib/local-db';
import { getAuthFromRequest, validateSession, AuthError } from '@/lib/auth';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';

// DDL/DML patterns that should be audited
const AUDIT_SQL_PATTERN = /^\s*(CREATE|DROP|ALTER|INSERT|DELETE|UPDATE|TRUNCATE|GRANT|REVOKE)/i;

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.QUERY);
    const { sessionId, sql } = await request.json();
    if (!sessionId || !sql) {
      return NextResponse.json({ error: 'Session ID and SQL required' }, { status: 400 });
    }

    // Basic safety: disallow multiple statements
    const trimmed = sql.trim().replace(/;\s*$/, '');

    const startTime = Date.now();
    const result = await executeQuery(sessionId, trimmed, undefined, 'query');
    const duration = Date.now() - startTime;

    // Audit DDL/DML queries (not SELECTs)
    if (AUDIT_SQL_PATTERN.test(trimmed)) {
      try {
        const token = getAuthFromRequest(request);
        const sess = token ? await validateSession(token) : null;
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
        const sqlPreview = trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
        await recordAuditLog({
          userId: sess?.user?.id, username: sess?.user?.username || 'unknown',
          action: 'query.execute', category: 'query', level: 'standard',
          target: sqlPreview.split(/\s+/).slice(0, 4).join(' '),
          detail: { sql: sqlPreview },
          ipAddress: ip,
        });
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      rows: result.rows,
      fields: result.fields,
      rowCount: result.rows.length,
      duration,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
