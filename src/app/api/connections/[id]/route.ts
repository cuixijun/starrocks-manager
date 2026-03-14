import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/local-db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const connId = parseInt(id, 10);
    if (isNaN(connId)) {
      return NextResponse.json({ error: 'Invalid connection ID' }, { status: 400 });
    }

    const conn = getConnection(connId);
    if (!conn) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    // Return full connection info (including password) for connecting
    return NextResponse.json({ connection: conn });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
