import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const type = request.nextUrl.searchParams.get('type') || 'tasks';
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh && type === 'all') {
      const cached = getBlobCache('tasks_cache', sessionId);
      if (cached) {
        return NextResponse.json({ ...(cached.data as object), cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    if (type === 'all') {
      const [tasksResult, runsResult] = await Promise.all([
        executeQuery(sessionId, `SELECT * FROM information_schema.tasks ORDER BY CREATE_TIME DESC`),
        executeQuery(sessionId, `SELECT * FROM information_schema.task_runs ORDER BY CREATE_TIME DESC LIMIT 200`),
      ]);
      const payload = { tasks: tasksResult.rows, runs: runsResult.rows };
      let cachedAt: string | undefined;
      try { cachedAt = setBlobCache('tasks_cache', sessionId, payload); } catch { /* non-fatal */ }
      return NextResponse.json({ ...payload, cachedAt, fromCache: false });
    }

    if (type === 'task_runs') {
      const result = await executeQuery(sessionId,
        `SELECT * FROM information_schema.task_runs ORDER BY CREATE_TIME DESC LIMIT 200`
      );
      return NextResponse.json({ runs: result.rows });
    }

    const result = await executeQuery(sessionId,
      `SELECT * FROM information_schema.tasks ORDER BY CREATE_TIME DESC`
    );
    return NextResponse.json({ tasks: result.rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action, taskName } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (action === 'drop') {
      if (!taskName) return NextResponse.json({ error: 'Task name required' }, { status: 400 });
      await executeQuery(sessionId, `DROP TASK \`${taskName}\``);
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
