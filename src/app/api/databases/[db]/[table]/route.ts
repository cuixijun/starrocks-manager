import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ db: string; table: string }> }
) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const { db, table } = await params;
    const fullName = `\`${db}\`.\`${table}\``;

    // Fetch multiple details in parallel
    const [schema, createTable, partitions, preview] = await Promise.all([
      executeQuery(sessionId, `DESC ${fullName}`).catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, `SHOW CREATE TABLE ${fullName}`).catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, `SHOW PARTITIONS FROM ${fullName}`).catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, `SELECT * FROM ${fullName} LIMIT 50`).catch(() => ({ rows: [], fields: [] })),
    ]);

    // Extract DDL
    const ddl = createTable.rows[0]
      ? (createTable.rows[0] as Record<string, string>)['Create Table'] || ''
      : '';

    return NextResponse.json({
      database: db,
      table,
      schema: schema.rows,
      ddl,
      partitions: partitions.rows,
      preview: { rows: preview.rows, fields: preview.fields },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
