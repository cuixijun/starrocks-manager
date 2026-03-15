import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const type = request.nextUrl.searchParams.get('type') || 'tasks'; // 'tasks', 'task_runs', or 'all'
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (type === 'all') {
      const [tasksResult, runsResult] = await Promise.all([
        executeQuery(sessionId, `SELECT * FROM information_schema.tasks ORDER BY CREATE_TIME DESC`),
        executeQuery(sessionId, `SELECT * FROM information_schema.task_runs ORDER BY CREATE_TIME DESC LIMIT 200`),
      ]);
      return NextResponse.json({ tasks: tasksResult.rows, runs: runsResult.rows });
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
