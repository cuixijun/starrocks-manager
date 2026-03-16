import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const { name } = await params;

    const result = await executeQuery(sessionId, `SHOW CREATE CATALOG \`${name}\``);
    const row = result.rows[0] as Record<string, string> | undefined;

    // The result typically has columns: Catalog, Type, Create Catalog
    const ddl = row
      ? (row['Create Catalog'] || row['CreateCatalog'] || Object.values(row).pop() || '')
      : '';

    return NextResponse.json({
      name,
      ddl,
      raw: row,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
