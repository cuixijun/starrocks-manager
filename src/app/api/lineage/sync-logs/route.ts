/**
 * GET /api/lineage/sync-logs?clusterId=1&limit=20
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { requireClusterAccess } from '@/lib/auth';
import { getSyncLogs } from '@/lib/lineage-collector';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const { searchParams } = request.nextUrl;
    const clusterId = parseInt(searchParams.get('clusterId') || '0', 10);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    if (!clusterId) {
      return NextResponse.json({ error: 'clusterId is required' }, { status: 400 });
    }

    // S-2: verify cluster access
    await requireClusterAccess(request, clusterId);

    const logs = await getSyncLogs(clusterId, limit);
    return NextResponse.json({ logs });
  } catch (err) {
    // R-3: log full error server-side, return sanitized message to client
    console.error(`[Lineage SyncLogs API] GET error:`, err);
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { error: status < 500 && err instanceof Error ? err.message : '服务器内部错误' },
      { status },
    );
  }
}
