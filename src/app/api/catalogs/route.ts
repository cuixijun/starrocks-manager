import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.CATALOGS);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (!refresh) {
      const cached = await getBlobCache('catalogs_cache', sessionId);
      if (cached) {
        return NextResponse.json({ catalogs: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const result = await executeQuery(sessionId, 'SHOW CATALOGS', undefined, 'catalogs');
    const catalogs = result.rows;

    let cachedAt: string | undefined;
    try {
      cachedAt = await setBlobCache('catalogs_cache', sessionId, catalogs);
    } catch { /* non-fatal */ }

    return NextResponse.json({ catalogs, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST: Create a new catalog by executing raw SQL
export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.CATALOGS);
    const { sessionId, sql } = await request.json();
    if (!sessionId || !sql) {
      return NextResponse.json({ error: 'sessionId and sql are required' }, { status: 400 });
    }

    // Strict validation: must be a CREATE CATALOG statement, no semicolons (multi-statement attack)
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('CREATE EXTERNAL CATALOG') && !trimmed.startsWith('CREATE CATALOG')) {
      return NextResponse.json({ error: 'SQL must be a CREATE EXTERNAL CATALOG statement' }, { status: 400 });
    }
    if (sql.includes(';')) {
      return NextResponse.json({ error: 'SQL must not contain semicolons' }, { status: 400 });
    }

    await executeQuery(sessionId, sql, undefined, 'catalogs');

    // Invalidate cache
    try { await setBlobCache('catalogs_cache', sessionId, null as unknown as Record<string, unknown>[]); } catch { /* ignore */ }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// DELETE: Drop a catalog
export async function DELETE(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.CATALOGS);
    const { sessionId, catalogName } = await request.json();
    if (!sessionId || !catalogName) {
      return NextResponse.json({ error: 'sessionId and catalogName are required' }, { status: 400 });
    }

    if (catalogName === 'default_catalog') {
      return NextResponse.json({ error: 'Cannot drop the default catalog' }, { status: 400 });
    }

    await executeQuery(sessionId, `DROP CATALOG \`${escapeBacktickId(catalogName)}\``, undefined, 'catalogs');

    // Invalidate cache
    try { await setBlobCache('catalogs_cache', sessionId, null as unknown as Record<string, unknown>[]); } catch { /* ignore */ }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
