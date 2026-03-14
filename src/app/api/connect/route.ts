import { NextRequest, NextResponse } from 'next/server';
import { createPool, testConnection, getSessionId, closePool } from '@/lib/db';
import { touchConnection } from '@/lib/local-db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { host, port, username, password, database, connectionId, testOnly } = body;

    if (!host || !username) {
      return NextResponse.json({ error: 'Host and username are required' }, { status: 400 });
    }

    const config = {
      host,
      port: port || 9030,
      user: username,
      password: password || '',
      database: database || undefined,
    };

    if (testOnly) {
      const result = await testConnection(config);
      return NextResponse.json(result);
    }

    // Create connection pool
    await createPool(config);
    const sessionId = getSessionId(config);

    // Update last used timestamp if this is a saved connection
    if (connectionId) {
      touchConnection(connectionId);
    }

    // Test and get version
    const testResult = await testConnection(config);

    return NextResponse.json({
      success: true,
      sessionId,
      version: testResult.version,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json();
    if (sessionId) {
      await closePool(sessionId);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
