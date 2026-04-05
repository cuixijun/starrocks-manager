/**
 * GET  /api/lineage/schedule?clusterId=1  — Get current schedule
 * PUT  /api/lineage/schedule              — Update schedule
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { requireClusterAccess } from '@/lib/auth';
import { recordAuditLog } from '@/lib/local-db';
import { getSchedule, setSchedule, getNextSyncTime } from '@/lib/lineage-scheduler';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const clusterId = parseInt(request.nextUrl.searchParams.get('clusterId') || '0', 10);
    if (!clusterId) {
      return NextResponse.json({ error: 'clusterId is required' }, { status: 400 });
    }

    // S-2: verify cluster access
    await requireClusterAccess(request, clusterId);

    const schedule = await getSchedule(clusterId);
    const nextSyncTime = getNextSyncTime(clusterId);

    return NextResponse.json({
      clusterId: schedule.clusterId,
      intervalMinutes: schedule.intervalMinutes,
      nextSyncTime,
    });
  } catch (err) {
    // R-3: log full error server-side, return sanitized message to client
    console.error(`[Lineage Schedule API] GET error:`, err);
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { error: status < 500 && err instanceof Error ? err.message : '服务器内部错误' },
      { status },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const body = await request.json();
    const { clusterId, intervalMinutes } = body;

    if (!clusterId || intervalMinutes === undefined) {
      return NextResponse.json(
        { error: 'clusterId and intervalMinutes are required' },
        { status: 400 },
      );
    }

    // S-2: verify cluster access (also gives us user for audit)
    const { user } = await requireClusterAccess(request, clusterId);

    const validIntervals = [0, 5, 10, 30, 60];
    if (!validIntervals.includes(intervalMinutes)) {
      return NextResponse.json(
        { error: `intervalMinutes must be one of: ${validIntervals.join(', ')}` },
        { status: 400 },
      );
    }

    await setSchedule(clusterId, intervalMinutes);

    // Audit: lineage.schedule
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    const label = intervalMinutes === 0 ? '手动同步' : `每 ${intervalMinutes} 分钟`;
    await recordAuditLog({
      userId: user.id, username: user.username,
      action: 'lineage.schedule', category: 'lineage', level: 'standard',
      target: `集群 #${clusterId}`,
      detail: { intervalMinutes, label },
      ipAddress: ip,
    });

    return NextResponse.json({
      clusterId,
      intervalMinutes,
      nextSyncTime: getNextSyncTime(clusterId),
    });
  } catch (err) {
    // R-3: log full error server-side, return sanitized message to client
    console.error(`[Lineage Schedule API] PUT error:`, err);
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { error: status < 500 && err instanceof Error ? err.message : '服务器内部错误' },
      { status },
    );
  }
}
