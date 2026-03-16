import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ db: string; name: string }> }
) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const { db, name } = await params;
    const fullName = `\`${db}\`.\`${name}\``;
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '10', 10) || 10, 1), 1000);
    const section = request.nextUrl.searchParams.get('section');

    // Lazy-load: only fetch task_runs when explicitly requested
    if (section === 'task_runs') {
      const taskRuns = await executeQuery(sessionId,
        `SELECT * FROM information_schema.task_runs
         WHERE \`DATABASE\` = '${db}'
         AND DEFINITION LIKE '%${name}%'
         ORDER BY CREATE_TIME DESC
         LIMIT 10`
      ).catch(() => ({ rows: [], fields: [] }));
      return NextResponse.json({ taskRuns: taskRuns.rows });
    }

    // Default: fetch schema, DDL, preview, and MV info (no task_runs)
    const [schema, createMV, preview, mvInfoResult] = await Promise.all([
      executeQuery(sessionId, `DESC ${fullName}`).catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, `SHOW CREATE MATERIALIZED VIEW ${fullName}`).catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, `SELECT * FROM ${fullName} LIMIT ${limit}`).catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId,
        `SELECT IS_ACTIVE, REFRESH_TYPE, INACTIVE_REASON FROM information_schema.materialized_views WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${name}' LIMIT 1`
      ).catch(() => ({ rows: [], fields: [] })),
    ]);

    // Extract DDL
    const row = (createMV.rows as Record<string, unknown>[])[0];
    const ddl = row
      ? String(row['Create Materialized View'] || row['Create Table'] || Object.values(row)[1] || '')
      : '';

    const mvInfo = (mvInfoResult.rows as Record<string, unknown>[])[0] || null;

    return NextResponse.json({
      database: db,
      name,
      schema: schema.rows,
      ddl,
      preview: { rows: preview.rows, fields: preview.fields },
      mvInfo,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
