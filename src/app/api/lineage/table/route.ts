/**
 * GET /api/lineage/table?clusterId=1&db=dw&table=ads_xxx&direction=both&depth=3
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { getTableLineage } from '@/lib/lineage-collector';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.DASHBOARD);
    const { searchParams } = request.nextUrl;
    const clusterId = parseInt(searchParams.get('clusterId') || '0', 10);
    const dbName = searchParams.get('db') || '';
    const tableName = searchParams.get('table') || '';
    const direction = (searchParams.get('direction') || 'both') as 'upstream' | 'downstream' | 'both';
    const depth = Math.min(10, Math.max(1, parseInt(searchParams.get('depth') || '5', 10)));

    if (!clusterId || !dbName || !tableName) {
      return NextResponse.json(
        { error: 'clusterId, db, and table are required' },
        { status: 400 },
      );
    }

    const graph = await getTableLineage(clusterId, dbName, tableName, direction, depth);
    return NextResponse.json(graph);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
