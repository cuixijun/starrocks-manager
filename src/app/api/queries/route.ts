import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const result = await executeQuery(sessionId, 'SHOW PROCESSLIST');
    return NextResponse.json({ queries: result.rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId, queryId } = await request.json();
    if (!sessionId || !queryId) {
      return NextResponse.json({ error: 'Session ID and query ID required' }, { status: 400 });
    }

    await executeQuery(sessionId, `KILL ${queryId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
