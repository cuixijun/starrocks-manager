import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';

export async function GET(request: NextRequest) {
  try {
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

    // Get all databases first, then query routine load for each
    const dbResult = await executeQuery(sessionId, 'SHOW DATABASES');
    const databases = (dbResult.rows as Record<string, unknown>[]).map(r =>
      String(r['Database'] || r['database'] || Object.values(r)[0] || '')
    ).filter(d => d && !['information_schema', '_statistics_', 'starrocks_monitor'].includes(d));

    const allJobs: Record<string, unknown>[] = [];

    for (const db of databases) {
      try {
        const result = await executeQuery(sessionId, `SHOW ALL ROUTINE LOAD FROM \`${db}\``);
        const rows = result.rows as Record<string, unknown>[];
        for (const row of rows) {
          allJobs.push({ ...row, _db: db });
        }
      } catch { /* skip databases with no routine load or access issues */ }
    }

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
    const { sessionId, action, dbName, jobName } = await request.json();
    if (!sessionId || !jobName) {
      return NextResponse.json({ error: 'Session ID and job name required' }, { status: 400 });
    }

    const fullName = dbName ? `\`${dbName}\`.\`${jobName}\`` : `\`${jobName}\``;

    if (action === 'pause') {
      await executeQuery(sessionId, `PAUSE ROUTINE LOAD FOR ${fullName}`);
      return NextResponse.json({ success: true });
    }
    if (action === 'resume') {
      await executeQuery(sessionId, `RESUME ROUTINE LOAD FOR ${fullName}`);
      return NextResponse.json({ success: true });
    }
    if (action === 'stop') {
      await executeQuery(sessionId, `STOP ROUTINE LOAD FOR ${fullName}`);
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
