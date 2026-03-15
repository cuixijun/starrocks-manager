import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Fetch all node types in parallel
    const [feResult, cnResult, beResult] = await Promise.allSettled([
      executeQuery(sessionId, 'SHOW FRONTENDS'),
      executeQuery(sessionId, 'SHOW COMPUTE NODES'),
      executeQuery(sessionId, 'SHOW BACKENDS'),
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

    return NextResponse.json({ frontends, computeNodes, backends });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action, nodeType, host, port } = await request.json();
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
    } else if (action === 'drop') {
      if (nodeType === 'fe') sql = `ALTER SYSTEM DROP FRONTEND ${hostPort}`;
      else if (nodeType === 'cn') sql = `ALTER SYSTEM DROP COMPUTE NODE ${hostPort}`;
      else if (nodeType === 'be') sql = `ALTER SYSTEM DROP BACKEND ${hostPort}`;
    } else if (action === 'decommission') {
      if (nodeType === 'cn') sql = `ALTER SYSTEM DECOMMISSION COMPUTE NODE ${hostPort}`;
      else if (nodeType === 'be') sql = `ALTER SYSTEM DECOMMISSION BACKEND ${hostPort}`;
    }

    if (!sql) {
      return NextResponse.json({ error: `Invalid action/nodeType: ${action}/${nodeType}` }, { status: 400 });
    }

    await executeQuery(sessionId, sql);
    return NextResponse.json({ success: true, sql });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
