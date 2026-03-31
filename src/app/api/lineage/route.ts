/**
 * POST /api/lineage/sync    — Trigger lineage sync
 * GET  /api/lineage/stats   — Get lineage statistics
 * GET  /api/lineage/graph   — Get lineage graph
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import { recordAuditLog } from '@/lib/local-db';
import { syncLineage, getLineageStats, getLineageGraph } from '@/lib/lineage-collector';

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const { user } = await requireAuth(request);
    const body = await request.json();
    const { sessionId, clusterId } = body;

    if (!sessionId || !clusterId) {
      return NextResponse.json(
        { error: 'sessionId and clusterId are required' },
        { status: 400 },
      );
    }

    const result = await syncLineage(sessionId, clusterId);

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
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

    if (type === 'stats') {
      const stats = await getLineageStats(clusterId);
      return NextResponse.json(stats);
    }

    if (type === 'graph') {
      const dbFilter = searchParams.get('db') || undefined;
      const graph = await getLineageGraph(clusterId, dbFilter);
      return NextResponse.json(graph);
    }

    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
