import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId, escapeSqlString } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.TASKS);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const type = request.nextUrl.searchParams.get('type') || 'tasks';
    const taskName = request.nextUrl.searchParams.get('taskName');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Drill-down: fetch runs for a specific task (max 30)
    if (type === 'task_runs' && taskName) {
      const compoundKey = `${sessionId}::${taskName}`;
      if (!refresh) {
        const cached = await getBlobCache('task_runs_cache', compoundKey);
        if (cached) return NextResponse.json({ runs: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
      const result = await executeQuery(sessionId,
        `SELECT * FROM information_schema.task_runs WHERE TASK_NAME = '${escapeSqlString(taskName)}' ORDER BY CREATE_TIME DESC LIMIT 30`,
        undefined, 'tasks'
      );
      const ts = await setBlobCache('task_runs_cache', compoundKey, result.rows);
      return NextResponse.json({ runs: result.rows, cachedAt: ts });
    }

    // Generic task_runs (used by Task Runs page)
    if (type === 'task_runs') {
      if (!refresh) {
        const cached = await getBlobCache('task_runs_all_cache', sessionId);
        if (cached) return NextResponse.json({ runs: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
      const result = await executeQuery(sessionId,
        `SELECT * FROM information_schema.task_runs ORDER BY CREATE_TIME DESC LIMIT 200`,
        undefined, 'tasks'
      );
      const ts = await setBlobCache('task_runs_all_cache', sessionId, result.rows);
      return NextResponse.json({ runs: result.rows, cachedAt: ts });
    }

    // Tasks list (used by Submit Task page) — exclude internal tasks
    if (!refresh) {
      const cached = await getBlobCache('tasks_cache', sessionId, 30 * 60 * 1000);
      if (cached) return NextResponse.json({ tasks: cached.data, cachedAt: cached.cachedAt, fromCache: true });
    }
    const result = await executeQuery(sessionId,
      "SELECT * FROM information_schema.tasks WHERE TASK_NAME NOT LIKE 'optimize-%' AND TASK_NAME NOT LIKE 'mv-%' ORDER BY `DATABASE`, TASK_NAME, CREATE_TIME DESC",
      undefined, 'tasks'
    );
    const ts = await setBlobCache('tasks_cache', sessionId, result.rows);
    return NextResponse.json({ tasks: result.rows, cachedAt: ts, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.TASKS);
    const { sessionId, action, taskName } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (action === 'drop') {
      if (!taskName) return NextResponse.json({ error: 'Task name required' }, { status: 400 });
      await executeQuery(sessionId, `DROP TASK \`${escapeBacktickId(taskName)}\``, undefined, 'tasks');
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
