import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, switchCluster, getCluster, getUserClusters } from '@/lib/auth';
import { createPool, clearConnectionFailure } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, session } = await requireAuth(request);
    const { id } = await params;
    const clusterId = parseInt(id, 10);

    if (isNaN(clusterId)) {
      return NextResponse.json({ error: 'Invalid cluster ID' }, { status: 400 });
    }

    // Check if user has access to this cluster
    const accessibleClusters = await getUserClusters(user.id, user.role);
    const target = accessibleClusters.find(c => c.id === clusterId);
    if (!target) {
      return NextResponse.json({ error: '无权访问此集群' }, { status: 403 });
    }

    // Verify cluster exists and is active
    const cluster = await getCluster(clusterId);
    if (!cluster) {
      return NextResponse.json({ error: '集群不存在或已禁用' }, { status: 404 });
    }

    // Switch the session's active cluster — instant, no blocking
    await switchCluster(session.token, clusterId);

    // Clear any failure cooldown for this cluster so health checks can proceed
    clearConnectionFailure(`${cluster.host}:${cluster.port}`);

    // Create pool for new cluster — await to avoid race condition with health check
    // If the cluster is unreachable, pool creation will fail, but the response
    // still succeeds (frontend determines online/offline via health check)
    try {
      await createPool({
        host: cluster.host,
        port: cluster.port,
        user: cluster.username,
        password: cluster.password,
        database: cluster.default_db || undefined,
      });
    } catch { /* pool creation failed — health probe will handle status */ }

    // Return immediately — frontend will determine online/offline via health check
    return NextResponse.json({
      success: true,
      activeCluster: {
        id: cluster.id,
        name: cluster.name,
        host: cluster.host,
        port: cluster.port,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status }
    );
  }
}

