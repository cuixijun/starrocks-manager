import { NextRequest, NextResponse } from 'next/server';
import { getCommandLogs, clearCommandLogs } from '@/lib/local-db';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const source = request.nextUrl.searchParams.get('source') || undefined;
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  try {
    const logs = await getCommandLogs(sessionId, source, limit);
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { sessionId, source } = await request.json();

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  try {
    await clearCommandLogs(sessionId, source);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
