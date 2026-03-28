import { NextRequest, NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db';
import { getBlobCache, setBlobCache } from '@/lib/local-db';
import { escapeBacktickId, validateNumeric } from '@/lib/sql-sanitize';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.RESOURCE_GROUPS);
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // ── Serve from cache unless explicitly refreshing ──
    if (!refresh) {
      const cached = await getBlobCache('resource_groups_cache', sessionId);
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
         FROM information_schema.resource_groups ORDER BY name ASC`,
        undefined, 'resource-groups'
      );
      resourceGroups = result.rows as Record<string, unknown>[];
    } catch {
      const result = await executeQuery(sessionId, 'SHOW RESOURCE GROUPS ALL', undefined, 'resource-groups');
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
      cachedAt = await setBlobCache('resource_groups_cache', sessionId, resourceGroups);
    } catch { /* non-fatal */ }

    return NextResponse.json({ resourceGroups, cachedAt, fromCache: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.RESOURCE_GROUPS);
    const body = await request.json();
    const { sessionId, name, action: editAction } = body;
    if (!sessionId || !name) {
      return NextResponse.json({ error: 'Session ID and name required' }, { status: 400 });
    }

    if (editAction === 'alter') {
      // ALTER RESOURCE GROUP rg SET (prop1=val1, prop2=val2, ...)
      const { cpuWeight, exclusiveCpuCores, memLimit, concurrencyLimit,
              bigQueryCpuSecondLimit, bigQueryScanRowsLimit, bigQueryMemLimit,
              spillMemLimitThreshold } = body;
      const props: string[] = [];
      if (cpuWeight !== undefined && cpuWeight !== '')           props.push(`cpu_weight=${cpuWeight}`);
      if (exclusiveCpuCores !== undefined && exclusiveCpuCores !== '') props.push(`exclusive_cpu_cores=${exclusiveCpuCores}`);
      if (memLimit !== undefined && memLimit !== '')             props.push(`mem_limit="${memLimit}"`);
      if (concurrencyLimit !== undefined && concurrencyLimit !== '') props.push(`concurrency_limit=${concurrencyLimit}`);
      if (bigQueryCpuSecondLimit !== undefined && bigQueryCpuSecondLimit !== '') props.push(`big_query_cpu_second_limit=${bigQueryCpuSecondLimit}`);
      if (bigQueryScanRowsLimit !== undefined && bigQueryScanRowsLimit !== '') props.push(`big_query_scan_rows_limit=${bigQueryScanRowsLimit}`);
      if (bigQueryMemLimit !== undefined && bigQueryMemLimit !== '') props.push(`big_query_mem_limit=${bigQueryMemLimit}`);
      if (spillMemLimitThreshold !== undefined && spillMemLimitThreshold !== '') props.push(`spill_mem_limit_threshold=${spillMemLimitThreshold}`);

      if (props.length === 0) {
        return NextResponse.json({ error: 'No properties to update' }, { status: 400 });
      }

      const sql = `ALTER RESOURCE GROUP \`${escapeBacktickId(name)}\` WITH (${props.join(', ')})`;
      await executeQuery(sessionId, sql, undefined, 'resource-groups');
      return NextResponse.json({ success: true, sql });
    }

    if (editAction === 'add_classifier') {
      // ALTER RESOURCE GROUP rg ADD (user='x', role='y', ...)
      const { classifierProps } = body;
      if (!classifierProps) {
        return NextResponse.json({ error: 'Classifier properties required' }, { status: 400 });
      }
      const sql = `ALTER RESOURCE GROUP \`${escapeBacktickId(name)}\` ADD (${classifierProps})`;
      await executeQuery(sessionId, sql, undefined, 'resource-groups');
      return NextResponse.json({ success: true, sql });
    }

    if (editAction === 'drop_classifier') {
      // ALTER RESOURCE GROUP rg DROP (CLASSIFIER_ID = N)
      const { classifierId } = body;
      if (!classifierId) {
        return NextResponse.json({ error: 'Classifier ID required' }, { status: 400 });
      }
      const safeId = validateNumeric(classifierId, 'classifierId');
      const sql = `ALTER RESOURCE GROUP \`${escapeBacktickId(name)}\` DROP (CLASSIFIER_ID = ${safeId})`;
      await executeQuery(sessionId, sql, undefined, 'resource-groups');
      return NextResponse.json({ success: true, sql });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission(request, PERMISSIONS.RESOURCE_GROUPS);
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
      await executeQuery(sessionId, `CREATE RESOURCE GROUP \`${escapeBacktickId(name)}\`${withClause}`, undefined, 'resource-groups');
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
    await requirePermission(request, PERMISSIONS.RESOURCE_GROUPS);
    const { sessionId, name } = await request.json();
    if (!sessionId || !name) {
      return NextResponse.json({ error: 'Session ID and name required' }, { status: 400 });
    }

    await executeQuery(sessionId, `DROP RESOURCE GROUP \`${escapeBacktickId(name)}\``, undefined, 'resource-groups');
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
