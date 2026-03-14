import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ db: string }> }
) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const { db } = await params;

    const tables = await executeQuery(
      sessionId,
      `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH,
              CREATE_TIME, UPDATE_TIME, TABLE_COMMENT
       FROM information_schema.tables
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [db]
    );

    return NextResponse.json({ database: db, tables: tables.rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
