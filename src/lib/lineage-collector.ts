/**
 * Lineage Collector — fetches audit logs from StarRocks, parses SQL, and stores lineage.
 */

import { executeQuery } from '@/lib/db';
import { getLocalDb } from '@/lib/local-db';
import { shanghaiDatetime } from '@/lib/db-adapter';
import type { DbAdapter } from '@/lib/db-adapter';
import { parseLineage, parseQuerySources } from '@/lib/lineage-parser';
import type { TableRef } from '@/lib/lineage-parser';

/* ── Noise SQL filter (application-level fast rejection) ─── */

/** System databases that should not generate lineage nodes */
const SYSTEM_DBS = new Set([
  'information_schema', 'starrocks_audit_db__', '_statistics_',
  'sys', 'mysql', 'performance_schema', 'starrocks_monitor',
]);

/** System table patterns — SQL referencing these is noise (collector's own queries etc.) */
const SYSTEM_TABLE_PATTERNS = [
  'starrocks_audit_tbl__',
  'starrocks_audit_db__',
  'information_schema',
  '_statistics_',
];

/** Check if a table ref belongs to a system database */
function isSystemRef(ref: TableRef): boolean {
  return SYSTEM_DBS.has(ref.db.toLowerCase());
}

/** SQL patterns that are noise (no FROM, system functions, etc.) */
const NOISE_PATTERNS: RegExp[] = [
  /^\s*SELECT\s+\d+/i,                             // SELECT 1, SELECT 42
  /^\s*SELECT\s+['"]/i,                             // SELECT 'hello', SELECT "str"
  /^\s*SELECT\s+(@@|@)/i,                           // SELECT @@version, SELECT @var
  /^\s*SELECT\s+VERSION\s*\(/i,                     // SELECT VERSION()
  /^\s*SELECT\s+CURRENT_/i,                         // SELECT CURRENT_USER(), CURRENT_TIMESTAMP
  /^\s*SELECT\s+CONNECTION_ID\s*\(/i,               // SELECT CONNECTION_ID()
  /^\s*SELECT\s+DATABASE\s*\(/i,                    // SELECT DATABASE()
  /^\s*SELECT\s+USER\s*\(/i,                        // SELECT USER()
  /^\s*SELECT\s+NOW\s*\(/i,                         // SELECT NOW()
  /^\s*SELECT\s+UUID\s*\(/i,                        // SELECT UUID()
  /^\s*SELECT\s+SLEEP\s*\(/i,                       // SELECT SLEEP(n)
  /^\s*SHOW\s+/i,                                   // SHOW anything
  /^\s*SET\s+/i,                                    // SET anything
  /^\s*KILL\s+/i,                                   // KILL query
  /^\s*DESC(RIBE)?\s+/i,                            // DESC/DESCRIBE table
  /^\s*EXPLAIN\s+/i,                                // EXPLAIN query
  /^\s*USE\s+/i,                                    // USE db
];

/**
 * Fast check: is this SQL a noise query that should not generate lineage?
 * Checks prefix patterns and absence of FROM clause.
 */
function isNoiseSql(sql: string): boolean {
  if (!sql) return true;
  const trimmed = sql.trim();
  // Pattern-based rejection
  for (const p of NOISE_PATTERNS) {
    if (p.test(trimmed)) return true;
  }
  // Must have a FROM clause to be interesting
  if (!/\bFROM\b/i.test(trimmed)) return true;
  // Reject if SQL references any system database or system table
  const lowerSql = trimmed.toLowerCase();
  for (const sysDb of SYSTEM_DBS) {
    if (lowerSql.includes(sysDb)) return true;
  }
  for (const pat of SYSTEM_TABLE_PATTERNS) {
    if (lowerSql.includes(pat)) return true;
  }
  return false;
}

export interface SyncResult {
  digestsFound: number;
  edgesCreated: number;
  edgesUpdated: number;
  parseErrors: number;
  queryDigestsFound: number;
  queryNodesCreated: number;
  queryEdgesCreated: number;
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
  let queryDigestsFound = 0;
  let queryNodesCreated = 0;
  let queryEdgesCreated = 0;

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
        -- 排除系统库
        AND LOWER(db) NOT IN (
          'information_schema', 'starrocks_audit_db__', '_statistics_',
          'sys', 'mysql', 'performance_schema', ''
        )
        AND LOCATE('starrocks_audit_db__', LOWER(stmt)) = 0
        AND LOCATE('starrocks_audit_tbl__', LOWER(stmt)) = 0
        AND LOCATE('information_schema', LOWER(stmt)) = 0
        AND LOCATE('_statistics_', LOWER(stmt)) = 0
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
      // Nothing new from non-query SQL, proceed to query SQL phase
    } else {

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
            // Skip edges involving system databases
            if (isSystemRef(target)) continue;
            for (const source of lineage.sources) {
              if (isSystemRef(source)) continue;
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
            if (!isSystemRef(target)) {
              pendingTargetOnlyNodes.push(target);
            }
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

    console.log(`[Lineage] Non-query sync done: ${edgesCreated} created, ${edgesUpdated} updated, ${parseErrors} errors`);

    } // end of non-query SQL phase (digestsFound > 0)

    // ═══════════════════════════════════════════════════════════
    // Phase 2: Query SQL lineage (SELECT statements → QUERY nodes)
    // ═══════════════════════════════════════════════════════════
    try {
      const querySql = `
        SELECT
          digest,
          ANY_VALUE(stmt) AS sample_stmt,
          ANY_VALUE(db) AS sample_db,
          COUNT(*) AS exec_count,
          MAX(\`timestamp\`) AS last_exec_time,
          GROUP_CONCAT(DISTINCT \`user\` SEPARATOR ',') AS users
        FROM starrocks_audit_db__.starrocks_audit_tbl__
        WHERE \`timestamp\` >= '${lastSyncTime}'
          AND isQuery = 1
          AND digest IS NOT NULL
          AND digest != ''
          -- 仅保留有 FROM 子句的真实查询（排除 SELECT 1, SELECT version() 等）
          AND UPPER(LEFT(stmt, 7)) IN ('SELECT ', 'WITH   ')
          AND LOCATE('FROM', UPPER(stmt)) > 0
          -- 排除系统库
          AND LOWER(db) NOT IN (
            'information_schema', 'starrocks_audit_db__', '_statistics_',
            'sys', 'mysql', 'performance_schema', ''
          )
          -- 排除操作系统表的查询（转义下划线防止 LIKE 通配匹配）
          AND LOCATE('information_schema', LOWER(stmt)) = 0
          AND LOCATE('starrocks_audit_db__', LOWER(stmt)) = 0
          AND LOCATE('starrocks_audit_tbl__', LOWER(stmt)) = 0
          AND LOCATE('_statistics_', LOWER(stmt)) = 0
          -- 排除 SHOW/SET/KILL 等伪查询命令
          AND UPPER(LEFT(TRIM(stmt), 5)) NOT IN ('SHOW ', 'SET @', 'SET V', 'KILL ')
        GROUP BY digest
        ORDER BY COUNT(*) DESC
        LIMIT 3
      `;

      console.log(`[Lineage] Query SQL phase: fetching top 3 queries since ${lastSyncTime}`);
      const queryResult = await executeQuery(sessionId, querySql, undefined, 'lineage');
      const queryRows = queryResult.rows as Array<{
        digest: string;
        sample_stmt: string;
        sample_db: string;
        exec_count: number;
        last_exec_time: string;
        users: string;
      }>;

      queryDigestsFound = queryRows.length;
      console.log(`[Lineage] Found ${queryDigestsFound} query digests. First 3:`, queryRows.slice(0, 3).map(r => ({
        digest: r.digest?.substring(0, 16),
        db: r.sample_db,
        stmt_prefix: r.sample_stmt?.substring(0, 80),
        exec_count: r.exec_count,
      })));

      for (const row of queryRows) {
        try {
          // Application-level noise filter (fast rejection)
          if (isNoiseSql(row.sample_stmt)) {
            console.log(`[Lineage] Query skip (noise SQL): digest=${row.digest?.substring(0, 16)}, stmt: ${row.sample_stmt?.substring(0, 80)}`);
            continue;
          }

          const sources = parseQuerySources(row.sample_stmt, row.sample_db || '_queries');
          if (!sources || sources.length === 0) {
            // Not a parse failure — just a query with no user-table references
            console.log(`[Lineage] Query skip (no source tables): digest=${row.digest?.substring(0, 16)}, db=${row.sample_db}, stmt: ${row.sample_stmt?.substring(0, 120)}`);
            continue;
          }

          const queryNodeName = `query_${row.digest}`;
          const queryDb = row.sample_db || '_queries';

          // Upsert the QUERY node
          const queryNodeId = await upsertQueryNode(db, clusterId, queryDb, queryNodeName, row.sample_stmt.substring(0, 4096));
          queryNodesCreated++;

          // Create edges: source_table → query_node
          for (const source of sources) {
            try {
              const sourceNodeId = await upsertNode(db, clusterId, source);
              const created = await upsertEdge(db, clusterId, sourceNodeId, queryNodeId, {
                relationType: 'QUERY',
                digest: row.digest,
                sampleSql: row.sample_stmt.substring(0, 4096),
                execCount: row.exec_count,
                lastExecTime: row.last_exec_time,
                users: row.users,
              });
              if (created) queryEdgesCreated++;
            } catch (e) {
              parseErrors++;
              if (parseErrors <= 3) {
                console.error(`[Lineage] Query edge write error:`, String(e));
              }
            }
          }
        } catch (e) {
          parseErrors++;
          if (parseErrors <= 5) {
            console.error(`[Lineage] Query parse error:`, String(e));
          }
        }
      }

      console.log(`[Lineage] Query phase done: ${queryNodesCreated} nodes, ${queryEdgesCreated} edges`);
    } catch (e) {
      console.error(`[Lineage] Query SQL phase failed:`, String(e));
      // Non-fatal: query phase failure doesn't fail the entire sync
    }

    const totalDigests = digestsFound + queryDigestsFound;
    const status = totalDigests > 0 && parseErrors === totalDigests ? 'FAILED' : parseErrors > 0 ? 'PARTIAL' : 'SUCCESS';
    await logSync(db, clusterId, now, { digestsFound: digestsFound + queryDigestsFound, edgesCreated: edgesCreated + queryEdgesCreated, edgesUpdated, parseErrors, queryDigestsFound, queryNodesCreated, queryEdgesCreated, status });

    return { digestsFound, edgesCreated, edgesUpdated, parseErrors, queryDigestsFound, queryNodesCreated, queryEdgesCreated, status };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logSync(db, clusterId, now, { digestsFound, edgesCreated, edgesUpdated, parseErrors, queryDigestsFound, queryNodesCreated, queryEdgesCreated, status: 'FAILED', errorMsg });
    return { digestsFound, edgesCreated, edgesUpdated, parseErrors, queryDigestsFound, queryNodesCreated, queryEdgesCreated, status: 'FAILED', errorMsg };
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

/* ── Query node upsert ────────────────────────────────────── */

async function upsertQueryNode(
  db: DbAdapter,
  clusterId: number,
  dbName: string,
  queryNodeName: string,
  sampleSql: string,
): Promise<number> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM lineage_nodes WHERE cluster_id = ? AND db_name = ? AND table_name = ? AND node_type = ?',
    [clusterId, dbName, queryNodeName, 'QUERY'],
  );
  if (existing) return existing.id;

  const result = await db.run(
    'INSERT INTO lineage_nodes (cluster_id, catalog_name, db_name, table_name, node_type) VALUES (?, ?, ?, ?, ?)',
    [clusterId, 'default_catalog', dbName, queryNodeName, 'QUERY'],
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

  // System DBs to exclude from lineage display
  const sysDbExclude = `AND LOWER(db_name) NOT IN ('information_schema','starrocks_audit_db__','_statistics_','sys','mysql','performance_schema','starrocks_monitor')`;

  let nodes: LineageNode[];
  if (dbFilter) {
    nodes = await db.all<LineageNode>(
      `SELECT * FROM lineage_nodes WHERE cluster_id = ? AND db_name = ? ${sysDbExclude}`,
      [clusterId, dbFilter],
    );
  } else {
    nodes = await db.all<LineageNode>(
      `SELECT * FROM lineage_nodes WHERE cluster_id = ? ${sysDbExclude}`,
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
    `SELECT db_name, COUNT(*) as cnt FROM lineage_nodes
     WHERE cluster_id = ?
       AND LOWER(db_name) NOT IN ('information_schema','starrocks_audit_db__','_statistics_','sys','mysql','performance_schema','starrocks_monitor')
     GROUP BY db_name ORDER BY cnt DESC`,
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
