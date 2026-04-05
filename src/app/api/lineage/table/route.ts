/**
 * GET /api/lineage/table?clusterId=1&db=dw&table=ads_xxx&direction=both&depth=3
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { requireClusterAccess } from '@/lib/auth';
import { getTableLineage } from '@/lib/lineage-collector';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const { searchParams } = request.nextUrl;
    const clusterId = parseInt(searchParams.get('clusterId') || '0', 10);
    const dbName = searchParams.get('db') || '';
    const tableName = searchParams.get('table') || '';
    const depth = Math.min(10, Math.max(1, parseInt(searchParams.get('depth') || '5', 10)));
    const catalog = searchParams.get('catalog') || undefined; // M-3: multi-catalog support

    // N-5 fix: runtime validation instead of type assertion
    const VALID_DIRECTIONS = ['upstream', 'downstream', 'both'] as const;
    const dirParam = searchParams.get('direction') || 'both';
    if (!VALID_DIRECTIONS.includes(dirParam as typeof VALID_DIRECTIONS[number])) {
      return NextResponse.json(
        { error: `direction must be one of: ${VALID_DIRECTIONS.join(', ')}` },
        { status: 400 },
      );
    }
    const direction = dirParam as 'upstream' | 'downstream' | 'both';

    if (!clusterId || !dbName || !tableName) {
      return NextResponse.json(
        { error: 'clusterId, db, and table are required' },
        { status: 400 },
      );
    }

    // S-2: verify cluster access
    await requireClusterAccess(request, clusterId);

    const graph = await getTableLineage(clusterId, dbName, tableName, direction, depth, catalog);
    return NextResponse.json(graph);
  } catch (err) {
    // R-3: log full error server-side, return sanitized message to client
    console.error(`[Lineage Table API] GET error:`, err);
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { error: status < 500 && err instanceof Error ? err.message : '服务器内部错误' },
      { status },
    );
  }
}
