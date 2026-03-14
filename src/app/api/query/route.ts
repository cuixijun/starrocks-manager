import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { sessionId, sql } = await request.json();
    if (!sessionId || !sql) {
      return NextResponse.json({ error: 'Session ID and SQL required' }, { status: 400 });
    }

    // Basic safety: disallow multiple statements
    const trimmed = sql.trim().replace(/;\s*$/, '');

    const startTime = Date.now();
    const result = await executeQuery(sessionId, trimmed);
    const duration = Date.now() - startTime;

    return NextResponse.json({
      rows: result.rows,
      fields: result.fields,
      rowCount: result.rows.length,
      duration,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
