import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Fetch FE, BE, CN info in parallel
    const [frontends, backends, computeNodes, variables] = await Promise.all([
      executeQuery(sessionId, 'SHOW FRONTENDS').catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, 'SHOW BACKENDS').catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, 'SHOW COMPUTE NODES').catch(() => ({ rows: [], fields: [] })),
      executeQuery(sessionId, "SHOW VARIABLES LIKE 'version%'").catch(() => ({ rows: [], fields: [] })),
    ]);

    return NextResponse.json({
      frontends: frontends.rows,
      backends: backends.rows,
      computeNodes: computeNodes.rows,
      variables: variables.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
