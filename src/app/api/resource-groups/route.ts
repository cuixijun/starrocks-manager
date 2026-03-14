import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // ── Serve from cache unless explicitly refreshing ──
    if (!refresh) {
      const cached = getBlobCache('resource_groups_cache', sessionId);
      if (cached) {
        return NextResponse.json({ resourceGroups: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    // ── Fetch fresh from StarRocks ──
    let resourceGroups: Record<string, unknown>[] = [];

    try {
      const result = await executeQuery(
        sessionId,
        `SELECT name, id, cpu_core_limit, mem_limit, concurrency_limit, type, create_time, classifiers
         FROM information_schema.resource_groups ORDER BY name ASC`
      );
      resourceGroups = result.rows as Record<string, unknown>[];
    } catch {
      const result = await executeQuery(sessionId, 'SHOW RESOURCE GROUPS ALL');
      resourceGroups = (result.rows as Record<string, unknown>[]).map(row => ({
        name:                        row['name']                        ?? row['Name']                        ?? '',
        id:                          row['id']                          ?? row['Id']                          ?? null,
        cpu_weight:                  row['cpu_weight']                  ?? row['CpuWeight']                  ?? null,
        exclusive_cpu_cores:         row['exclusive_cpu_cores']         ?? row['ExclusiveCpuCores']         ?? null,
        mem_limit:                   row['mem_limit']                   ?? row['MemLimit']                   ?? null,
        big_query_cpu_second_limit:  row['big_query_cpu_second_limit']  ?? row['BigQueryCpuSecondLimit']  ?? null,
        big_query_scan_rows_limit:   row['big_query_scan_rows_limit']   ?? row['BigQueryScanRowsLimit']   ?? null,
        big_query_mem_limit:         row['big_query_mem_limit']         ?? row['BigQueryMemLimit']         ?? null,
        concurrency_limit:           row['concurrency_limit']           ?? row['ConcurrencyLimit']           ?? null,
        spill_mem_limit_threshold:   row['spill_mem_limit_threshold']   ?? row['SpillMemLimitThreshold']   ?? null,
        classifiers:                 row['classifiers']                 ?? row['Classifiers']                 ?? null,
      }));
    }

    // Persist to SQLite cache
    let cachedAt: string | undefined;
    try {
      cachedAt = setBlobCache('resource_groups_cache', sessionId, resourceGroups);
    } catch { /* non-fatal */ }

    return NextResponse.json({ resourceGroups, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action, name, cpuWeight, exclusiveCpuCores, memLimit, concurrencyLimit,
            bigQueryCpuSecondLimit, bigQueryScanRowsLimit, bigQueryMemLimit } = await request.json();
    if (!sessionId || !name) {
      return NextResponse.json({ error: 'Session ID and name required' }, { status: 400 });
    }

    if (action === 'create') {
      const props: string[] = [];
      if (cpuWeight)                props.push(`cpu_weight=${cpuWeight}`);
      if (exclusiveCpuCores)        props.push(`exclusive_cpu_cores=${exclusiveCpuCores}`);
      if (memLimit)                 props.push(`mem_limit="${memLimit}"`);
      if (concurrencyLimit)         props.push(`concurrency_limit=${concurrencyLimit}`);
      if (bigQueryCpuSecondLimit)   props.push(`big_query_cpu_second_limit=${bigQueryCpuSecondLimit}`);
      if (bigQueryScanRowsLimit)    props.push(`big_query_scan_rows_limit=${bigQueryScanRowsLimit}`);
      if (bigQueryMemLimit)         props.push(`big_query_mem_limit=${bigQueryMemLimit}`);

      const withClause = props.length > 0 ? ` WITH (${props.join(', ')})` : '';
      await executeQuery(sessionId, `CREATE RESOURCE GROUP ${name}${withClause}`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId, name } = await request.json();
    if (!sessionId || !name) {
      return NextResponse.json({ error: 'Session ID and name required' }, { status: 400 });
    }

    await executeQuery(sessionId, `DROP RESOURCE GROUP ${name}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
