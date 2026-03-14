import { NextRequest, NextResponse } from 'next/server';
import { listConnections, createConnection, deleteConnection, updateConnection } from '@/lib/local-db';

export async function GET() {
  try {
    const connections = listConnections();
    // Mask passwords in response
    const safe = connections.map(c => ({
      ...c,
      password: c.password ? '••••••' : '',
    }));
    return NextResponse.json({ connections: safe });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, host, port, username, password, default_db } = body;

    if (!name || !host || !username) {
      return NextResponse.json({ error: 'Name, host, and username are required' }, { status: 400 });
    }

    const conn = createConnection({
      name,
      host,
      port: port || 9030,
      username,
      password: password || '',
      default_db: default_db || '',
    });

    return NextResponse.json({ connection: { ...conn, password: conn.password ? '••••••' : '' } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 });
    }

    const conn = updateConnection(id, updates);
    if (!conn) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({ connection: { ...conn, password: conn.password ? '••••••' : '' } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 });
    }

    const deleted = deleteConnection(id);
    return NextResponse.json({ success: deleted });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
