import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

/**
 * Map information_schema.routine_load_jobs column names (UPPER_SNAKE_CASE)
 * to the SHOW ROUTINE LOAD column names (CamelCase) expected by the frontend.
 */
function mapColumns(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const aliasMap: Record<string, string> = {
    'ID': 'Id',
    'NAME': 'Name',
    'CREATE_TIME': 'CreateTime',
    'PAUSE_TIME': 'PauseTime',
    'END_TIME': 'EndTime',
    'DB_NAME': 'DbName',
    'TABLE_NAME': 'TableName',
    'STATE': 'State',
    'DATA_SOURCE_TYPE': 'DataSourceType',
    'CURRENT_TASK_NUM': 'CurrentTaskNum',
    'JOB_PROPERTIES': 'JobProperties',
    'DATA_SOURCE_PROPERTIES': 'DataSourceProperties',
    'CUSTOM_PROPERTIES': 'CustomProperties',
    'STATISTIC': 'Statistics',
    'PROGRESS': 'Progress',
    'REASON_OF_STATE_CHANGED': 'ReasonOfStateChanged',
    'ERROR_LOG_URLS': 'ErrorLogUrls',
    'TRACKING_SQL': 'TrackingSql',
    'OTHER_MSG': 'OtherMsg',
    'LOADED_ROWS': 'LoadedRows',
  };

  for (const [key, value] of Object.entries(row)) {
    const alias = aliasMap[key];
    if (alias) {
      mapped[alias] = value;
    }
    // Keep the original key too for any unmapped columns
    mapped[key] = value;
  }
  return mapped;
}

export async function GET(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.ROUTINE_LOAD);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh) {
      const cached = getBlobCache('routine_load_cache', sessionId);
      if (cached) {
        return NextResponse.json({ jobs: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    // Single query via information_schema — replaces the old N+1 pattern
    // (was: SHOW DATABASES + SHOW ALL ROUTINE LOAD FROM `db` for each database)
    // Uses SELECT * to avoid column-name errors across StarRocks versions,
    // then maps UPPER_SNAKE_CASE to CamelCase in JavaScript.
    const result = await executeQuery(
      sessionId,
      `SELECT * FROM information_schema.routine_load_jobs ORDER BY CREATE_TIME DESC`,
      undefined,
      'routine-load'
    );

    const rows = result.rows as Record<string, unknown>[];
    const allJobs = rows.map(row => {
      const mapped = mapColumns(row);
      mapped._db = String(mapped['DbName'] || mapped['DB_NAME'] || '');
      return mapped;
    });

    let cachedAt: string | undefined;
    try { cachedAt = setBlobCache('routine_load_cache', sessionId, allJobs); } catch { /* non-fatal */ }

    return NextResponse.json({ jobs: allJobs, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    requirePermission(request, PERMISSIONS.ROUTINE_LOAD);
    const { sessionId, action, dbName, jobName } = await request.json();
    if (!sessionId || !jobName) {
      return NextResponse.json({ error: 'Session ID and job name required' }, { status: 400 });
    }

    const fullName = dbName ? `\`${escapeBacktickId(dbName)}\`.\`${escapeBacktickId(jobName)}\`` : `\`${escapeBacktickId(jobName)}\``;

    if (action === 'pause') {
      await executeQuery(sessionId, `PAUSE ROUTINE LOAD FOR ${fullName}`, undefined, 'routine-load');
      return NextResponse.json({ success: true });
    }
    if (action === 'resume') {
      await executeQuery(sessionId, `RESUME ROUTINE LOAD FOR ${fullName}`, undefined, 'routine-load');
      return NextResponse.json({ success: true });
    }
    if (action === 'stop') {
      await executeQuery(sessionId, `STOP ROUTINE LOAD FOR ${fullName}`, undefined, 'routine-load');
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
