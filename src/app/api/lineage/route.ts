/**
 * POST /api/lineage/sync    — Trigger lineage sync
 * GET  /api/lineage/stats   — Get lineage statistics
 * GET  /api/lineage/graph   — Get lineage graph
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { requireClusterAccess, getCluster } from '@/lib/auth';
import { recordAuditLog } from '@/lib/local-db';
import { syncLineage, getLineageStats, getLineageGraph, isSyncing } from '@/lib/lineage-collector';

/* H-2 fix: sync lock now lives inside syncLineage (shared with scheduler) */

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const body = await request.json();
    const { clusterId: rawClusterId } = body;

    // T-1 fix: explicit integer validation — reject non-integer values
    const clusterId = Number(rawClusterId);
    if (!clusterId || !Number.isInteger(clusterId) || clusterId <= 0) {
      return NextResponse.json(
        { error: 'clusterId must be a positive integer' },
        { status: 400 },
      );
    }

    // S-2: verify cluster access
    const { user } = await requireClusterAccess(request, clusterId);

    // S-1 fix: construct sessionId server-side from cluster config, never trust client
    const cluster = await getCluster(clusterId);
    if (!cluster) {
      return NextResponse.json({ error: '集群不存在' }, { status: 404 });
    }
    const sessionId = `${cluster.host}:${cluster.port}`;

    // H-2: check shared lock (fast rejection before calling syncLineage)
    if (isSyncing(clusterId)) {
      return NextResponse.json(
        { error: '该集群正在同步中，请稍后再试' },
        { status: 429 },
      );
    }

    const result = await syncLineage(sessionId, clusterId);

    // H-2: handle SKIPPED (race between check and lock acquisition)
    if (result.status === 'SKIPPED') {
      return NextResponse.json(
        { error: result.errorMsg || '同步已在进行中' },
        { status: 429 },
      );
    }

    // Audit: lineage.sync
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: user.id, username: user.username,
      action: 'lineage.sync', category: 'lineage', level: 'standard',
      target: `集群 #${clusterId}`,
      detail: {
        digestsFound: result.digestsFound,
        edgesCreated: result.edgesCreated,
        edgesUpdated: result.edgesUpdated,
        parseErrors: result.parseErrors,
        status: result.status,
      },
      ipAddress: ip,
    });

    return NextResponse.json(result);
  } catch (err) {
    // R-3: log full error server-side, return sanitized message to client
    console.error(`[Lineage API] POST error:`, err);
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { error: status < 500 && err instanceof Error ? err.message : '服务器内部错误' },
      { status },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const { searchParams } = request.nextUrl;
    const type = searchParams.get('type') || 'stats';
    const clusterId = parseInt(searchParams.get('clusterId') || '0', 10);

    if (!clusterId) {
      return NextResponse.json({ error: 'clusterId is required' }, { status: 400 });
    }

    // S-2: verify cluster access
    await requireClusterAccess(request, clusterId);

    if (type === 'stats') {
      const stats = await getLineageStats(clusterId);
      return NextResponse.json(stats);
    }

    if (type === 'graph') {
      // T-2 fix: truncate dbFilter to 128 chars to prevent memory abuse
      const dbFilter = searchParams.get('db')?.substring(0, 128) || undefined;
      const graph = await getLineageGraph(clusterId, dbFilter);
      return NextResponse.json(graph);
    }

    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
  } catch (err) {
    // R-3: log full error server-side, return sanitized message to client
    console.error(`[Lineage API] GET error:`, err);
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { error: status < 500 && err instanceof Error ? err.message : '服务器内部错误' },
      { status },
    );
  }
}
