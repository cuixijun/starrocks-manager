/**
 * Lineage Collector — fetches audit logs from StarRocks, parses SQL, and stores lineage.
 */

import { executeQuery } from '@/lib/db';
import { getLocalDb } from '@/lib/local-db';
import { shanghaiDatetime } from '@/lib/db-adapter';
import type { DbAdapter } from '@/lib/db-adapter';
import { parseLineage } from '@/lib/lineage-parser';
import type { TableRef } from '@/lib/lineage-parser';

export interface SyncResult {
  digestsFound: number;
  edgesCreated: number;
  edgesUpdated: number;
  parseErrors: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errorMsg?: string;
}

/**
 * Run a full lineage sync for a given cluster.
 */
export async function syncLineage(
  sessionId: string,
  clusterId: number,
): Promise<SyncResult> {
  const db = await getLocalDb();
  const now = shanghaiDatetime();

  let digestsFound = 0;
  let edgesCreated = 0;
  let edgesUpdated = 0;
  let parseErrors = 0;

  try {
    // 1. Get the last sync time that actually found data (ignore empty syncs)
    const lastSync = await db.get<{ sync_time: string }>(
      'SELECT sync_time FROM lineage_sync_log WHERE cluster_id = ? AND status != ? AND digests_found > 0 ORDER BY id DESC LIMIT 1',
      [clusterId, 'FAILED'],
    );
    // Default: look back 7 days if no previous successful sync with data
    const lastSyncTime = lastSync?.sync_time || shanghaiDatetime(new Date(Date.now() - 7 * 86400_000));

    // 2. Query audit table for new digests (non-query SQL only)
    // Performance: use LEFT(stmt, 7) instead of full-text LIKE to avoid scanning 1MB VARCHAR.
    // isQuery=0 already filters to DML/DDL, so we just need the first keyword.
    const sql = `
      SELECT
        digest,
        ANY_VALUE(stmt) AS sample_stmt,
        ANY_VALUE(db) AS sample_db,
        COUNT(*) AS exec_count,
        MAX(\`timestamp\`) AS last_exec_time,
        GROUP_CONCAT(DISTINCT \`user\` SEPARATOR ',') AS users
      FROM starrocks_audit_db__.starrocks_audit_tbl__
      WHERE \`timestamp\` >= '${lastSyncTime}'
        AND isQuery = 0
        AND digest IS NOT NULL
        AND digest != ''
        AND (UPPER(LEFT(stmt, 7)) IN ('INSERT ', 'CREATE ') OR UPPER(LEFT(stmt, 5)) = 'WITH ')
      GROUP BY digest
      LIMIT 1000
    `;

    console.log(`[Lineage] Sync started for cluster ${clusterId}, lastSyncTime=${lastSyncTime}`);
    console.log(`[Lineage] Query SQL:\n${sql}`);

    const result = await executeQuery(sessionId, sql, undefined, 'lineage');
    const rows = result.rows as Array<{
      digest: string;
      sample_stmt: string;
      sample_db: string;
      exec_count: number;
      last_exec_time: string;
      users: string;
    }>;

    digestsFound = rows.length;
    console.log(`[Lineage] Found ${digestsFound} digests. First 3 rows:`, rows.slice(0, 3).map(r => ({
      digest: r.digest?.substring(0, 16),
      db: r.sample_db,
      stmt_prefix: r.sample_stmt?.substring(0, 80),
      exec_count: r.exec_count,
    })));

    if (digestsFound === 0) {
      // Nothing new to process
      await logSync(db, clusterId, now, { digestsFound: 0, edgesCreated: 0, edgesUpdated: 0, parseErrors: 0, status: 'SUCCESS' });
      return { digestsFound: 0, edgesCreated: 0, edgesUpdated: 0, parseErrors: 0, status: 'SUCCESS' };
    }

    // 3. Parse all SQL first, collect nodes and edges
    interface PendingEdge {
      source: TableRef;
      target: TableRef;
      relationType: string;
      digest: string;
      sampleSql: string;
      execCount: number;
      lastExecTime: string;
      users: string;
    }
    const pendingEdges: PendingEdge[] = [];
    const pendingTargetOnlyNodes: TableRef[] = [];
    const parseFailSamples: { stmt: string; reason: string }[] = [];

    for (const row of rows) {
      try {
        const lineage = parseLineage(row.sample_stmt, row.sample_db || 'default');
        if (!lineage) {
          parseErrors++;
          if (parseFailSamples.length < 5) {
            parseFailSamples.push({ stmt: row.sample_stmt?.substring(0, 120), reason: 'parseLineage returned null' });
          }
          continue;
        }

        // If we have targets and sources, create edges
        if (lineage.sources.length > 0) {
          for (const target of lineage.targets) {
            for (const source of lineage.sources) {
              if (source.db === target.db && source.table === target.table) continue;
              pendingEdges.push({
                source,
                target,
                relationType: lineage.relationType,
                digest: row.digest,
                sampleSql: row.sample_stmt.substring(0, 4096),
                execCount: row.exec_count,
                lastExecTime: row.last_exec_time,
                users: row.users,
              });
            }
          }
        } else {
          // No sources (subquery/truncated SQL) — register target nodes only
          for (const target of lineage.targets) {
            pendingTargetOnlyNodes.push(target);
          }
        }
      } catch (e) {
        parseErrors++;
        if (parseFailSamples.length < 5) {
          parseFailSamples.push({ stmt: row.sample_stmt?.substring(0, 120), reason: String(e) });
        }
      }
    }

    if (parseFailSamples.length > 0) {
      console.log(`[Lineage] Parse failures (${parseErrors} total), first ${parseFailSamples.length} samples:`);
      parseFailSamples.forEach((s, i) => console.log(`  [${i + 1}] reason=${s.reason}\n      stmt: ${s.stmt}`));
    }
    console.log(`[Lineage] Parsed ${pendingEdges.length} edges from ${digestsFound - parseErrors} digests`);

    // 4. Register orphan target nodes (no sources found)
    for (const ref of pendingTargetOnlyNodes) {
      try {
        await upsertNode(db, clusterId, ref);
      } catch { /* ignore */ }
    }

    // 5. Write edges to local DB
    for (const edge of pendingEdges) {
      try {
        const targetNodeId = await upsertNode(db, clusterId, edge.target);
        const sourceNodeId = await upsertNode(db, clusterId, edge.source);
        const created = await upsertEdge(db, clusterId, sourceNodeId, targetNodeId, {
          relationType: edge.relationType,
          digest: edge.digest,
          sampleSql: edge.sampleSql,
          execCount: edge.execCount,
          lastExecTime: edge.lastExecTime,
          users: edge.users,
        });

        if (created) edgesCreated++;
        else edgesUpdated++;
      } catch (e) {
        parseErrors++;
        if (parseErrors <= 3) {
          console.error(`[Lineage] DB write error:`, String(e));
          console.error(`  edge: ${edge.source.db}.${edge.source.table} → ${edge.target.db}.${edge.target.table}`);
        }
      }
    }

    console.log(`[Lineage] Sync done: ${edgesCreated} created, ${edgesUpdated} updated, ${parseErrors} errors`);

    const status = parseErrors === digestsFound ? 'FAILED' : parseErrors > 0 ? 'PARTIAL' : 'SUCCESS';
    await logSync(db, clusterId, now, { digestsFound, edgesCreated, edgesUpdated, parseErrors, status });

    return { digestsFound, edgesCreated, edgesUpdated, parseErrors, status };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logSync(db, clusterId, now, { digestsFound, edgesCreated, edgesUpdated, parseErrors, status: 'FAILED', errorMsg });
    return { digestsFound, edgesCreated, edgesUpdated, parseErrors, status: 'FAILED', errorMsg };
  }
}

/* ── Node upsert ──────────────────────────────────────────── */

async function upsertNode(
  db: DbAdapter,
  clusterId: number,
  ref: TableRef,
): Promise<number> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM lineage_nodes WHERE cluster_id = ? AND catalog_name = ? AND db_name = ? AND table_name = ?',
    [clusterId, ref.catalog, ref.db, ref.table],
  );
  if (existing) return existing.id;

  const result = await db.run(
    'INSERT INTO lineage_nodes (cluster_id, catalog_name, db_name, table_name, node_type) VALUES (?, ?, ?, ?, ?)',
    [clusterId, ref.catalog, ref.db, ref.table, 'TABLE'],
  );
  return result.insertId;
}

/* ── Edge upsert ──────────────────────────────────────────── */

interface EdgeData {
  relationType: string;
  digest: string;
  sampleSql: string;
  execCount: number;
  lastExecTime: string;
  users: string;
}

async function upsertEdge(
  db: DbAdapter,
  clusterId: number,
  sourceId: number,
  targetId: number,
  data: EdgeData,
): Promise<boolean> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM lineage_edges WHERE cluster_id = ? AND source_node_id = ? AND target_node_id = ? AND relation_type = ?',
    [clusterId, sourceId, targetId, String(data.relationType)],
  );

  // Force-coerce all values to SQLite-safe types
  const usersStr = String(data.users || '');
  const usersJson = JSON.stringify(usersStr.split(',').filter(Boolean));
  const lastExecTime = String(data.lastExecTime || shanghaiDatetime());
  const execCount = Number(data.execCount) || 1;
  const digest = String(data.digest || '');
  const sampleSql = String(data.sampleSql || '');
  const relationType = String(data.relationType);
  const now = shanghaiDatetime();

  if (existing) {
    await db.run(
      'UPDATE lineage_edges SET exec_count = exec_count + ?, last_exec_time = ?, users = ?, sample_sql = ?, updated_at = ? WHERE id = ?',
      [execCount, lastExecTime, usersJson, sampleSql, now, existing.id],
    );
    return false; // updated
  }

  await db.run(
    'INSERT INTO lineage_edges (cluster_id, source_node_id, target_node_id, relation_type, digest, sample_sql, exec_count, last_exec_time, users) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [clusterId, sourceId, targetId, relationType, digest, sampleSql, execCount, lastExecTime, usersJson],
  );
  return true; // created
}

/* ── Sync log ─────────────────────────────────────────────── */

async function logSync(
  db: DbAdapter,
  clusterId: number,
  syncTime: string,
  result: Omit<SyncResult, 'status'> & { status: string; errorMsg?: string },
) {
  await db.run(
    'INSERT INTO lineage_sync_log (cluster_id, sync_time, digests_found, edges_created, edges_updated, parse_errors, status, error_msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [clusterId, syncTime, result.digestsFound, result.edgesCreated, result.edgesUpdated, result.parseErrors, result.status, result.errorMsg || null],
  );
}

/* ── Query helpers ────────────────────────────────────────── */

export interface LineageNode {
  id: number;
  cluster_id: number;
  catalog_name: string;
  db_name: string;
  table_name: string;
  node_type: string;
}

export interface LineageEdge {
  id: number;
  source_node_id: number;
  target_node_id: number;
  relation_type: string;
  digest: string;
  sample_sql: string;
  exec_count: number;
  last_exec_time: string;
  users: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/**
 * Get the full lineage graph for a cluster, optionally filtered by database.
 */
export async function getLineageGraph(clusterId: number, dbFilter?: string): Promise<LineageGraph> {
  const db = await getLocalDb();

  let nodes: LineageNode[];
  if (dbFilter) {
    nodes = await db.all<LineageNode>(
      'SELECT * FROM lineage_nodes WHERE cluster_id = ? AND db_name = ?',
      [clusterId, dbFilter],
    );
  } else {
    nodes = await db.all<LineageNode>(
      'SELECT * FROM lineage_nodes WHERE cluster_id = ?',
      [clusterId],
    );
  }

  if (nodes.length === 0) return { nodes: [], edges: [] };

  const nodeIds = nodes.map(n => n.id);
  const placeholders = nodeIds.map(() => '?').join(', ');

  const edges = await db.all<LineageEdge>(
    `SELECT * FROM lineage_edges WHERE cluster_id = ? AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}))`,
    [clusterId, ...nodeIds, ...nodeIds],
  );

  // Include nodes referenced by edges that weren't in the initial filter
  const edgeNodeIds = new Set<number>();
  edges.forEach(e => { edgeNodeIds.add(e.source_node_id); edgeNodeIds.add(e.target_node_id); });
  const missingIds = [...edgeNodeIds].filter(id => !nodeIds.includes(id));

  if (missingIds.length > 0) {
    const mPlaceholders = missingIds.map(() => '?').join(', ');
    const extraNodes = await db.all<LineageNode>(
      `SELECT * FROM lineage_nodes WHERE id IN (${mPlaceholders})`,
      missingIds,
    );
    nodes = [...nodes, ...extraNodes];
  }

  return { nodes, edges };
}

/**
 * Get upstream/downstream lineage for a specific table.
 */
export async function getTableLineage(
  clusterId: number,
  dbName: string,
  tableName: string,
  direction: 'upstream' | 'downstream' | 'both' = 'both',
  maxDepth: number = 5,
): Promise<LineageGraph> {
  const db = await getLocalDb();

  const rootNode = await db.get<LineageNode>(
    'SELECT * FROM lineage_nodes WHERE cluster_id = ? AND db_name = ? AND table_name = ?',
    [clusterId, dbName, tableName],
  );

  if (!rootNode) return { nodes: [], edges: [] };

  const visitedNodes = new Map<number, LineageNode>();
  const allEdges: LineageEdge[] = [];
  visitedNodes.set(rootNode.id, rootNode);

  // BFS traversal
  if (direction === 'upstream' || direction === 'both') {
    await bfsTraverse(db, rootNode.id, 'upstream', maxDepth, visitedNodes, allEdges, clusterId);
  }
  if (direction === 'downstream' || direction === 'both') {
    await bfsTraverse(db, rootNode.id, 'downstream', maxDepth, visitedNodes, allEdges, clusterId);
  }

  return {
    nodes: [...visitedNodes.values()],
    edges: deduplicateEdges(allEdges),
  };
}

async function bfsTraverse(
  db: DbAdapter,
  startId: number,
  dir: 'upstream' | 'downstream',
  maxDepth: number,
  visitedNodes: Map<number, LineageNode>,
  allEdges: LineageEdge[],
  clusterId: number,
) {
  let frontier = [startId];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const placeholders = frontier.map(() => '?').join(', ');
    const edges = dir === 'upstream'
      ? await db.all<LineageEdge>(
          `SELECT * FROM lineage_edges WHERE cluster_id = ? AND target_node_id IN (${placeholders})`,
          [clusterId, ...frontier],
        )
      : await db.all<LineageEdge>(
          `SELECT * FROM lineage_edges WHERE cluster_id = ? AND source_node_id IN (${placeholders})`,
          [clusterId, ...frontier],
        );

    allEdges.push(...edges);
    const nextIds: number[] = [];

    for (const edge of edges) {
      const nextId = dir === 'upstream' ? edge.source_node_id : edge.target_node_id;
      if (!visitedNodes.has(nextId)) {
        const node = await db.get<LineageNode>('SELECT * FROM lineage_nodes WHERE id = ?', [nextId]);
        if (node) {
          visitedNodes.set(nextId, node);
          nextIds.push(nextId);
        }
      }
    }

    frontier = nextIds;
    depth++;
  }
}

function deduplicateEdges(edges: LineageEdge[]): LineageEdge[] {
  const seen = new Set<number>();
  return edges.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

/**
 * Get lineage sync logs for a cluster.
 */
export async function getSyncLogs(clusterId: number, limit = 20) {
  const db = await getLocalDb();
  return db.all<{
    id: number;
    sync_time: string;
    digests_found: number;
    edges_created: number;
    edges_updated: number;
    parse_errors: number;
    status: string;
    error_msg: string | null;
  }>(
    'SELECT * FROM lineage_sync_log WHERE cluster_id = ? ORDER BY id DESC LIMIT ?',
    [clusterId, limit],
  );
}

/**
 * Get lineage statistics for a cluster.
 */
export async function getLineageStats(clusterId: number) {
  const db = await getLocalDb();
  const nodeCount = await db.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM lineage_nodes WHERE cluster_id = ?',
    [clusterId],
  );
  const edgeCount = await db.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM lineage_edges WHERE cluster_id = ?',
    [clusterId],
  );
  const dbList = await db.all<{ db_name: string; cnt: number }>(
    'SELECT db_name, COUNT(*) as cnt FROM lineage_nodes WHERE cluster_id = ? GROUP BY db_name ORDER BY cnt DESC',
    [clusterId],
  );
  const lastSync = await db.get<{ sync_time: string; status: string }>(
    'SELECT sync_time, status FROM lineage_sync_log WHERE cluster_id = ? ORDER BY id DESC LIMIT 1',
    [clusterId],
  );

  return {
    totalNodes: nodeCount?.cnt || 0,
    totalEdges: edgeCount?.cnt || 0,
    databases: dbList,
    lastSync: lastSync || null,
  };
}
