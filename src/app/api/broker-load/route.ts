import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId, escapeSqlString } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

/**
 * Map information_schema.loads column names (UPPER_SNAKE_CASE)
 * to the SHOW LOAD column names (CamelCase) expected by the frontend.
 */
function mapColumns(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const aliasMap: Record<string, string> = {
    'LABEL': 'Label',
    'DATABASE_NAME': 'DbName',
    'STATE': 'State',
    'TYPE': 'Type',
    'PROGRESS': 'Progress',
    'CREATE_TIME': 'CreateTime',
    'LOAD_START_TIME': 'LoadStartTime',
    'LOAD_FINISH_TIME': 'LoadFinishTime',
    'URL': 'URL',
    'TRACKING_URL': 'TrackingUrl',
    'TRACKING_SQL': 'TrackingSql',
    'ETL_INFO': 'EtlInfo',
    'TASK_INFO': 'TaskInfo',
    'ERROR_MSG': 'ErrorMsg',
    'JOB_ID': 'JobId',
    'PROPERTIES': 'Properties',
  };

  for (const [key, value] of Object.entries(row)) {
    const alias = aliasMap[key];
    if (alias) {
      mapped[alias] = value;
    }
    mapped[key] = value;
  }
  return mapped;
}

export async function GET(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.BROKER_LOAD);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh) {
      const cached = getBlobCache('broker_load_cache', sessionId);
      if (cached) {
        return NextResponse.json({ loads: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    // Single query via information_schema.loads — replaces the old N+1 pattern
    // (was: SHOW DATABASES + SHOW LOAD FROM `db` for each database)
    // Filter TYPE = 'BROKER' to only show broker load jobs.
    const result = await executeQuery(
      sessionId,
      `SELECT * FROM information_schema.loads WHERE TYPE = 'BROKER' ORDER BY CREATE_TIME DESC LIMIT 500`,
      undefined,
      'broker-load'
    );

    const rows = result.rows as Record<string, unknown>[];
    const allLoads = rows.map(row => {
      const mapped = mapColumns(row);
      mapped._db = String(mapped['DbName'] || mapped['DATABASE_NAME'] || '');
      return mapped;
    });

    let cachedAt: string | undefined;
    try { cachedAt = setBlobCache('broker_load_cache', sessionId, allLoads); } catch { /* non-fatal */ }

    return NextResponse.json({ loads: allLoads, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.BROKER_LOAD);
    const { sessionId, action, dbName, label } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (action === 'cancel') {
      if (!label || !dbName) return NextResponse.json({ error: 'Label and DB required' }, { status: 400 });
      await executeQuery(sessionId, `CANCEL LOAD FROM \`${escapeBacktickId(dbName)}\` WHERE LABEL = '${escapeSqlString(label)}'`, undefined, 'broker-load');
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
