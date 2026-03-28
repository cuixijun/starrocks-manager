import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.NODES);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh) {
      const cached = getBlobCache('nodes_cache', sessionId);
      if (cached) {
        return NextResponse.json({ ...(cached.data as object), cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    // Fetch all node types in parallel
    const [feResult, cnResult, beResult, brokerResult] = await Promise.allSettled([
      executeQuery(sessionId, 'SHOW FRONTENDS', undefined, 'nodes'),
      executeQuery(sessionId, 'SHOW COMPUTE NODES', undefined, 'nodes'),
      executeQuery(sessionId, 'SHOW BACKENDS', undefined, 'nodes'),
      executeQuery(sessionId, 'SHOW BROKER', undefined, 'nodes'),
    ]);

    const frontends = feResult.status === 'fulfilled'
      ? (Array.isArray(feResult.value.rows) ? feResult.value.rows : [])
      : [];
    const computeNodes = cnResult.status === 'fulfilled'
      ? (Array.isArray(cnResult.value.rows) ? cnResult.value.rows : [])
      : [];
    const backends = beResult.status === 'fulfilled'
      ? (Array.isArray(beResult.value.rows) ? beResult.value.rows : [])
      : [];
    const brokers = brokerResult.status === 'fulfilled'
      ? (Array.isArray(brokerResult.value.rows) ? brokerResult.value.rows : [])
      : [];

    const payload = { frontends, computeNodes, backends, brokers };
    let cachedAt: string | undefined;
    try { cachedAt = setBlobCache('nodes_cache', sessionId, payload); } catch { /* non-fatal */ }

    return NextResponse.json({ ...payload, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.NODES);
    const { sessionId, action, nodeType, host, port, brokerName } = await request.json();
    if (!sessionId || !action || !nodeType || !host || !port) {
      return NextResponse.json({ error: 'sessionId, action, nodeType, host, port required' }, { status: 400 });
    }

    let sql = '';
    const hostPort = `"${host}:${port}"`;

    if (action === 'add') {
      if (nodeType === 'fe_follower') sql = `ALTER SYSTEM ADD FOLLOWER ${hostPort}`;
      else if (nodeType === 'fe_observer') sql = `ALTER SYSTEM ADD OBSERVER ${hostPort}`;
      else if (nodeType === 'cn') sql = `ALTER SYSTEM ADD COMPUTE NODE ${hostPort}`;
      else if (nodeType === 'be') sql = `ALTER SYSTEM ADD BACKEND ${hostPort}`;
      else if (nodeType === 'broker') sql = `ALTER SYSTEM ADD BROKER ${brokerName || 'broker0'} ${hostPort}`;
    } else if (action === 'drop') {
      if (nodeType === 'fe') sql = `ALTER SYSTEM DROP FRONTEND ${hostPort}`;
      else if (nodeType === 'cn') sql = `ALTER SYSTEM DROP COMPUTE NODE ${hostPort}`;
      else if (nodeType === 'be') sql = `ALTER SYSTEM DROP BACKEND ${hostPort}`;
      else if (nodeType === 'broker') sql = `ALTER SYSTEM DROP BROKER ${brokerName || 'broker0'} ${hostPort}`;
    } else if (action === 'decommission') {
      // StarRocks does NOT support DECOMMISSION COMPUTE NODE — only BE supports decommission
      // For CN nodes, use DROP instead (CN is stateless, no data migration needed)
      if (nodeType === 'cn') sql = `ALTER SYSTEM DROP COMPUTE NODE ${hostPort}`;
      else if (nodeType === 'be') sql = `ALTER SYSTEM DECOMMISSION BACKEND ${hostPort}`;
    }

    if (!sql) {
      return NextResponse.json({ error: `Invalid action/nodeType: ${action}/${nodeType}` }, { status: 400 });
    }

    await executeQuery(sessionId, sql, undefined, 'nodes');
    return NextResponse.json({ success: true, sql });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
