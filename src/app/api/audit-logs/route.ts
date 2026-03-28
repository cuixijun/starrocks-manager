import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { queryAuditLogs } from '@/lib/local-db';

// GET /api/audit-logs — query audit logs (all authenticated users)
export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.AUDIT);

    const params = request.nextUrl.searchParams;
    const page = parseInt(params.get('page') || '1', 10);
    const pageSize = parseInt(params.get('pageSize') || '20', 10);
    const category = params.get('category') || undefined;
    const username = params.get('username') || undefined;
    const action = params.get('action') || undefined;
    const startDate = params.get('startDate') || undefined;
    const endDate = params.get('endDate') || undefined;

    const result = await queryAuditLogs({ page, pageSize, category, username, action, startDate, endDate });

    return NextResponse.json({
      logs: result.logs,
      total: result.total,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
