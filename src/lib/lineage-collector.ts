/**
 * Lineage Collector — fetches audit logs from StarRocks, parses SQL, and stores lineage.
 */

import { executeQuery } from '@/lib/db';
import { getLocalDb } from '@/lib/local-db';
import { shanghaiDatetime } from '@/lib/db-adapter';
import type { DbAdapter } from '@/lib/db-adapter';
import { parseLineage, parseQuerySources, SYSTEM_DBS } from '@/lib/lineage-parser';
import type { TableRef } from '@/lib/lineage-parser';

/* ── Noise SQL filter (application-level fast rejection) ─── */

/**
 * SQL fragment for excluding system DBs — derived from shared SYSTEM_DBS (N-9 fix).
 * Includes empty string '' to also exclude rows where db column is empty/null (L-5).
 *
 * SYSTEM_DBS_SQL_LIST: used in StarRocks SQL (string interpolation OK — hardcoded constants).
 * SYSTEM_DBS_ARRAY / SYSTEM_DBS_PLACEHOLDERS: R-1 fix — parameterized for SQLite queries.
 */
const SYSTEM_DBS_SQL_LIST = [...SYSTEM_DBS, ''].map(d => `'${d}'`).join(',');
const SYSTEM_DBS_ARRAY = [...SYSTEM_DBS, ''];
const SYSTEM_DBS_PLACEHOLDERS = SYSTEM_DBS_ARRAY.map(() => '?').join(',');

/**
 * Edge columns shared by getLineageGraph and bfsTraverse (P-3 fix).
 * Excludes: sample_sql (TEXT up to 4KB per row — too heavy for BFS/graph traversal).
 * If lineage_edges schema changes, update this list accordingly.
 */
const EDGE_COLUMNS = 'id, cluster_id, source_node_id, target_node_id, relation_type, digest, exec_count, last_exec_time, users';

/* ── H-2 fix: shared sync lock (prevents concurrent syncs from API + scheduler) ── */
const _syncLocks = new Set<number>();
/** Check if a sync is currently running for a cluster */
export function isSyncing(clusterId: number): boolean {
  return _syncLocks.has(clusterId);
}

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
  // T-5 fix: truncate to 8KB to avoid regex overhead on very long audit log entries
  const trimmed = sql.trim().substring(0, 8192);
  // Pattern-based rejection
  for (const p of NOISE_PATTERNS) {
    if (p.test(trimmed)) return true;
  }
  // Must have a FROM clause to be interesting
  if (!/\bFROM\b/i.test(trimmed)) return true;
  // H-1 fix: check FROM/JOIN context for system DB references (not substring match)
  // Old code used lowerSql.includes('sys') which false-positived on 'analysis', 'system' etc.
  if (referencesSystemObject(trimmed)) return true;
  return false;
}

/**
 * H-1 fix: Check if SQL references system databases or system tables
 * in FROM/JOIN context. Uses keyword-anchored regex to avoid false positives
 * from table names that happen to contain 'sys', 'mysql', etc. as substrings.
 */
function referencesSystemObject(sql: string): boolean {
  const lowerSql = sql.toLowerCase();
  // Match the first identifier after FROM/JOIN keywords (the db or table name)
  const fromJoinPattern = /(?:from|join)\s+`?(\w+)`?/gi;
  let match;
  while ((match = fromJoinPattern.exec(lowerSql)) !== null) {
    const firstPart = match[1];
    if (SYSTEM_DBS.has(firstPart)) return true;
    for (const pat of SYSTEM_TABLE_PATTERNS) {
      if (firstPart.includes(pat)) return true;
    }
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
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  errorMsg?: string;
}

/**
 * Run a full lineage sync for a given cluster.
 */
export async function syncLineage(
  sessionId: string,
  clusterId: number,
): Promise<SyncResult> {
  // H-2 fix: shared sync lock — prevents concurrent syncs from API + scheduler
  if (_syncLocks.has(clusterId)) {
    return {
      digestsFound: 0, edgesCreated: 0, edgesUpdated: 0, parseErrors: 0,
      queryDigestsFound: 0, queryNodesCreated: 0, queryEdgesCreated: 0,
      status: 'SKIPPED', errorMsg: '同步已在进行中',
    };
  }
  _syncLocks.add(clusterId);
  try {
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
    // P-2 fix: SET_VAR(query_timeout = 30) prevents long-running audit queries from blocking the pool.
    const sql = `
      SELECT /*+ SET_VAR(query_timeout = 30) */
        digest,
        ANY_VALUE(stmt) AS sample_stmt,
        ANY_VALUE(db) AS sample_db,
        COUNT(*) AS exec_count,
        MAX(\`timestamp\`) AS last_exec_time,
        GROUP_CONCAT(DISTINCT \`user\` SEPARATOR ',') AS users
      FROM starrocks_audit_db__.starrocks_audit_tbl__
      WHERE \`timestamp\` > ?
        AND isQuery = 0
        AND digest IS NOT NULL
        AND digest != ''
        AND (UPPER(LEFT(stmt, 7)) IN ('INSERT ', 'CREATE ') OR UPPER(LEFT(stmt, 4)) = 'WITH')
        -- 排除系统库
        AND LOWER(db) NOT IN (${SYSTEM_DBS_SQL_LIST})
        AND LOCATE('starrocks_audit_db__', LOWER(stmt)) = 0
        AND LOCATE('starrocks_audit_tbl__', LOWER(stmt)) = 0
        AND LOCATE('information_schema', LOWER(stmt)) = 0
        AND LOCATE('_statistics_', LOWER(stmt)) = 0
      GROUP BY digest
      LIMIT 1000
    `;

    console.log(`[Lineage] Sync started for cluster ${clusterId}, lastSyncTime=${lastSyncTime}`);
    // R-2 fix: only print full SQL in non-production environments
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Lineage] Query SQL:\n${sql}`);
    }

    const result = await executeQuery(sessionId, sql, [lastSyncTime], 'lineage');
    const rows = result.rows as Array<{
      digest: string;
      sample_stmt: string;
      sample_db: string;
      exec_count: number;
      last_exec_time: string;
      users: string;
    }>;

    digestsFound = rows.length;
    // R-2 fix: summary only — no SQL fragments or db names in production logs
    console.log(`[Lineage] Found ${digestsFound} digests`);

    // ── In-memory node cache (shared across Phase 1 & Phase 2) ──
    // Key: "catalog:db:table" → nodeId. Eliminates repeated SELECTs for the same table.
    const nodeCache = new Map<string, number>();
    const cacheKey = (catalog: string, dbName: string, table: string) => `${catalog}:${dbName}:${table}`;

    // Pre-load ALL existing nodes for this cluster (1 query replaces N individual SELECTs)
    const existingNodes = await db.all<LineageNode>(
      'SELECT id, catalog_name, db_name, table_name FROM lineage_nodes WHERE cluster_id = ?',
      [clusterId],
    );
    for (const node of existingNodes) {
      nodeCache.set(cacheKey(node.catalog_name, node.db_name, node.table_name), node.id);
    }
    console.log(`[Lineage] Pre-loaded ${existingNodes.length} existing nodes into cache`);

    // Cache-aware node upsert: cache hit = 0 queries, cache miss = 1 INSERT
    // R-4 fix: ON CONFLICT DO NOTHING — survives cache-DB inconsistency (e.g. manual inserts, cleanup race)
    const cachedUpsertNode = async (txDb: typeof db, ref: TableRef): Promise<number> => {
      const key = cacheKey(ref.catalog, ref.db, ref.table);
      const cached = nodeCache.get(key);
      if (cached !== undefined) return cached;
      const result = await txDb.run(
        `INSERT INTO lineage_nodes (cluster_id, catalog_name, db_name, table_name, node_type)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cluster_id, catalog_name, db_name, table_name) DO NOTHING`,
        [clusterId, ref.catalog, ref.db, ref.table, 'TABLE'],
      );
      // R-4: if conflict (insertId=0), look up the existing row
      if (!result.insertId) {
        const existing = await txDb.get<{ id: number }>(
          'SELECT id FROM lineage_nodes WHERE cluster_id = ? AND catalog_name = ? AND db_name = ? AND table_name = ?',
          [clusterId, ref.catalog, ref.db, ref.table],
        );
        if (existing) { nodeCache.set(key, existing.id); return existing.id; }
      }
      nodeCache.set(key, result.insertId);
      return result.insertId;
    };

    const cachedUpsertQueryNode = async (txDb: typeof db, dbName: string, queryNodeName: string, _sampleSql: string): Promise<number> => {
      const key = cacheKey('default_catalog', dbName, queryNodeName);
      const cached = nodeCache.get(key);
      if (cached !== undefined) return cached;
      const result = await txDb.run(
        `INSERT INTO lineage_nodes (cluster_id, catalog_name, db_name, table_name, node_type)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cluster_id, catalog_name, db_name, table_name) DO NOTHING`,
        [clusterId, 'default_catalog', dbName, queryNodeName, 'QUERY'],
      );
      if (!result.insertId) {
        const existing = await txDb.get<{ id: number }>(
          'SELECT id FROM lineage_nodes WHERE cluster_id = ? AND catalog_name = ? AND db_name = ? AND table_name = ?',
          [clusterId, 'default_catalog', dbName, queryNodeName],
        );
        if (existing) { nodeCache.set(key, existing.id); return existing.id; }
      }
      nodeCache.set(key, result.insertId);
      return result.insertId;
    };

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


    // 4. Register orphan target nodes + 5. Write edges (wrapped in transaction)
    await db.withTransaction(async (txDb) => {
      // 4a. Register orphan target nodes (no sources found)
      for (const ref of pendingTargetOnlyNodes) {
        try {
          await cachedUpsertNode(txDb, ref);
        } catch { /* ignore */ }
      }

      // 4b. Write edges
      for (const edge of pendingEdges) {
        try {
          const targetNodeId = await cachedUpsertNode(txDb, edge.target);
          const sourceNodeId = await cachedUpsertNode(txDb, edge.source);
          const created = await upsertEdge(txDb, clusterId, sourceNodeId, targetNodeId, {
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
    });

    console.log(`[Lineage] Non-query sync done: ${edgesCreated} created, ${edgesUpdated} updated, ${parseErrors} errors`);

    } // end of non-query SQL phase (digestsFound > 0)

    // ═══════════════════════════════════════════════════════════
    // Phase 2: Query SQL lineage (SELECT statements → QUERY nodes)
    // ═══════════════════════════════════════════════════════════
    try {
      // P-2 fix: SET_VAR(query_timeout = 30) prevents long-running audit queries from blocking the pool.
      const querySql = `
        SELECT /*+ SET_VAR(query_timeout = 30) */
          digest,
          ANY_VALUE(stmt) AS sample_stmt,
          ANY_VALUE(db) AS sample_db,
          COUNT(*) AS exec_count,
          MAX(\`timestamp\`) AS last_exec_time,
          GROUP_CONCAT(DISTINCT \`user\` SEPARATOR ',') AS users
        FROM starrocks_audit_db__.starrocks_audit_tbl__
        WHERE \`timestamp\` > ?
          AND isQuery = 1
          AND digest IS NOT NULL
          AND digest != ''
          -- 仅保留有 FROM 子句的真实查询（排除 SELECT 1, SELECT version() 等）
          AND (UPPER(LEFT(TRIM(stmt), 7)) = 'SELECT ' OR UPPER(LEFT(TRIM(stmt), 4)) = 'WITH')
          AND LOCATE('FROM', UPPER(stmt)) > 0
          -- 排除系统库
          AND LOWER(db) NOT IN (${SYSTEM_DBS_SQL_LIST})
          -- 排除操作系统表的查询（转义下划线防止 LIKE 通配匹配）
          AND LOCATE('information_schema', LOWER(stmt)) = 0
          AND LOCATE('starrocks_audit_db__', LOWER(stmt)) = 0
          AND LOCATE('starrocks_audit_tbl__', LOWER(stmt)) = 0
          AND LOCATE('_statistics_', LOWER(stmt)) = 0
          -- 排除 SHOW/SET/KILL 等伪查询命令
          AND UPPER(LEFT(TRIM(stmt), 5)) NOT IN ('SHOW ', 'SET @', 'SET V', 'KILL ')
        GROUP BY digest
        ORDER BY COUNT(*) DESC
        LIMIT 100
      `;

      console.log(`[Lineage] Query SQL phase: fetching top 100 queries since ${lastSyncTime}`);
      const queryResult = await executeQuery(sessionId, querySql, [lastSyncTime], 'lineage');
      const queryRows = queryResult.rows as Array<{
        digest: string;
        sample_stmt: string;
        sample_db: string;
        exec_count: number;
        last_exec_time: string;
        users: string;
      }>;

      queryDigestsFound = queryRows.length;
      // R-2 fix: summary only — no SQL fragments or db names in production logs
      console.log(`[Lineage] Found ${queryDigestsFound} query digests`);

      // Wrap Phase 2 DB writes in a transaction
      await db.withTransaction(async (txDb) => {
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
          const queryNodeId = await cachedUpsertQueryNode(txDb, queryDb, queryNodeName, row.sample_stmt.substring(0, 4096));
          queryNodesCreated++;

          // Create edges: source_table → query_node
          for (const source of sources) {
            try {
              const sourceNodeId = await cachedUpsertNode(txDb, source);
              const created = await upsertEdge(txDb, clusterId, sourceNodeId, queryNodeId, {
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
      }); // end transaction

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
  } finally {
    _syncLocks.delete(clusterId);
  }
}

/* ── Node upsert (via cachedUpsertNode in syncLineage) ──── */
/* Dead code upsertNode / upsertQueryNode removed (N-3 fix) */

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
  // Force-coerce all values to SQLite-safe types
  const usersStr = String(data.users || '');
  const usersJson = JSON.stringify(usersStr.split(',').filter(Boolean));
  const lastExecTime = String(data.lastExecTime || shanghaiDatetime());
  const execCount = Number(data.execCount) || 1;
  const digest = String(data.digest || '');
  const sampleSql = String(data.sampleSql || '');
  const relationType = String(data.relationType);
  const now = shanghaiDatetime();

  // Single-query upsert: ON CONFLICT (SQLite) / ON DUPLICATE KEY (MySQL)
  if (db.isMysql) {
    const result = await db.run(
      `INSERT INTO lineage_edges (cluster_id, source_node_id, target_node_id, relation_type, digest, sample_sql, exec_count, last_exec_time, users)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         exec_count = VALUES(exec_count),
         last_exec_time = VALUES(last_exec_time),
         users = VALUES(users),
         sample_sql = VALUES(sample_sql),
         updated_at = ?`,
      [clusterId, sourceId, targetId, relationType, digest, sampleSql, execCount, lastExecTime, usersJson, now],
    );
    // MySQL ON DUPLICATE KEY UPDATE:
    //   affectedRows = 1 → new insert
    //   affectedRows = 2 → update with actual data change
    //   affectedRows = 0 → conflict but no data change (new values == old values)
    // Previously used `<= 1` which mis-classified affectedRows=0 (no-change) as "created"
    return result.changes === 1;
  } else {
    const result = await db.run(
      `INSERT INTO lineage_edges (cluster_id, source_node_id, target_node_id, relation_type, digest, sample_sql, exec_count, last_exec_time, users)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cluster_id, source_node_id, target_node_id, relation_type) DO UPDATE SET
         exec_count = excluded.exec_count,
         last_exec_time = excluded.last_exec_time,
         users = excluded.users,
         sample_sql = excluded.sample_sql,
         updated_at = ?`,
      [clusterId, sourceId, targetId, relationType, digest, sampleSql, execCount, lastExecTime, usersJson, now],
    );
    // SQLite: changes=1 for both insert and update; use insertId heuristic
    // If insertId matches a new autoincrement value, it was inserted
    return result.insertId > 0 && result.changes === 1;
  }
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
  truncated?: boolean;
}

/**
 * Get the full lineage graph for a cluster, optionally filtered by database.
 */
export async function getLineageGraph(clusterId: number, dbFilter?: string): Promise<LineageGraph> {
  const db = await getLocalDb();
  const MAX_NODES = 2000; // H-3: prevent OOM on large clusters

  // R-1 fix: parameterized SYSTEM_DBS for SQLite queries (not string interpolation)
  let nodes: LineageNode[];
  if (dbFilter) {
    nodes = await db.all<LineageNode>(
      `SELECT * FROM lineage_nodes WHERE cluster_id = ? AND db_name = ? AND LOWER(db_name) NOT IN (${SYSTEM_DBS_PLACEHOLDERS}) LIMIT ?`,
      [clusterId, dbFilter, ...SYSTEM_DBS_ARRAY, MAX_NODES + 1],
    );
  } else {
    nodes = await db.all<LineageNode>(
      `SELECT * FROM lineage_nodes WHERE cluster_id = ? AND LOWER(db_name) NOT IN (${SYSTEM_DBS_PLACEHOLDERS}) LIMIT ?`,
      [clusterId, ...SYSTEM_DBS_ARRAY, MAX_NODES + 1],
    );
  }

  // H-3: truncate to MAX_NODES and flag
  const truncated = nodes.length > MAX_NODES;
  if (truncated) nodes = nodes.slice(0, MAX_NODES);

  if (nodes.length === 0) return { nodes: [], edges: [], truncated: false };

  // ── Batch IN helper (avoids exceeding SQLite's 999-variable limit) ──
  const BATCH_SIZE = 400;
  async function batchIn<T>(
    ids: number[],
    queryFn: (placeholders: string, batchIds: number[]) => Promise<T[]>,
  ): Promise<T[]> {
    if (ids.length <= BATCH_SIZE) return queryFn(ids.map(() => '?').join(', '), ids);
    const results: T[] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const ph = batch.map(() => '?').join(', ');
      results.push(...await queryFn(ph, batch));
    }
    return results;
  }

  const nodeIds = nodes.map(n => n.id);

  // H-4 fix: split OR+IN into two parallel queries for better index utilization
  // Old: SELECT * ... WHERE (source_node_id IN (...) OR target_node_id IN (...))
  // New: two separate queries merged in application layer
  // P-3 fix: use module-level EDGE_COLUMNS constant (without sample_sql) for consistency
  const edgeColumns = EDGE_COLUMNS;
  const [edgesBySource, edgesByTarget] = await Promise.all([
    batchIn<LineageEdge>(nodeIds, (ph, batch) =>
      db.all<LineageEdge>(
        `SELECT ${edgeColumns} FROM lineage_edges WHERE cluster_id = ? AND source_node_id IN (${ph})`,
        [clusterId, ...batch],
      ),
    ),
    batchIn<LineageEdge>(nodeIds, (ph, batch) =>
      db.all<LineageEdge>(
        `SELECT ${edgeColumns} FROM lineage_edges WHERE cluster_id = ? AND target_node_id IN (${ph})`,
        [clusterId, ...batch],
      ),
    ),
  ]);

  // Deduplicate edges (same edge may appear in both source and target results)
  const seenEdgeIds = new Set<number>();
  const uniqueEdges = [...edgesBySource, ...edgesByTarget].filter(e => {
    if (seenEdgeIds.has(e.id)) return false;
    seenEdgeIds.add(e.id);
    return true;
  });

  // Include nodes referenced by edges that weren't in the initial filter
  const nodeIdSet = new Set(nodeIds);
  const edgeNodeIds = new Set<number>();
  uniqueEdges.forEach(e => { edgeNodeIds.add(e.source_node_id); edgeNodeIds.add(e.target_node_id); });
  const missingIds = [...edgeNodeIds].filter(id => !nodeIdSet.has(id));

  if (missingIds.length > 0) {
    const extraNodes = await batchIn<LineageNode>(missingIds, async (ph, batch) =>
      db.all<LineageNode>(`SELECT * FROM lineage_nodes WHERE id IN (${ph})`, batch),
    );
    nodes = [...nodes, ...extraNodes];
  }

  return { nodes, edges: uniqueEdges, truncated };
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
  catalogName?: string,
): Promise<LineageGraph> {
  const db = await getLocalDb();

  // M-3 fix: if catalog specified, filter by it; otherwise fall back to ORDER BY id (N-2)
  const rootNode = catalogName
    ? await db.get<LineageNode>(
        'SELECT * FROM lineage_nodes WHERE cluster_id = ? AND catalog_name = ? AND db_name = ? AND table_name = ? AND node_type != ? ORDER BY id LIMIT 1',
        [clusterId, catalogName, dbName, tableName, 'QUERY'],
      )
    : await db.get<LineageNode>(
        'SELECT * FROM lineage_nodes WHERE cluster_id = ? AND db_name = ? AND table_name = ? AND node_type != ? ORDER BY id LIMIT 1',
        [clusterId, dbName, tableName, 'QUERY'],
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

// P-1 fix: batch IN helper for bfsTraverse (same pattern as getLineageGraph)
const BFS_BATCH_SIZE = 400;

async function bfsBatchIn<T>(
  db: DbAdapter,
  ids: number[],
  queryFn: (placeholders: string, batchIds: number[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length <= BFS_BATCH_SIZE) return queryFn(ids.map(() => '?').join(', '), ids);
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += BFS_BATCH_SIZE) {
    const batch = ids.slice(i, i + BFS_BATCH_SIZE);
    const ph = batch.map(() => '?').join(', ');
    results.push(...await queryFn(ph, batch));
  }
  return results;
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
    // P-1 fix: batch IN to avoid exceeding SQLite 999-variable limit on large fan-out
    // P-3 fix: use EDGE_COLUMNS (without sample_sql) to reduce data transfer
    const col = dir === 'upstream' ? 'target_node_id' : 'source_node_id';
    const edges = await bfsBatchIn<LineageEdge>(db, frontier, (ph, batch) =>
      db.all<LineageEdge>(
        `SELECT ${EDGE_COLUMNS} FROM lineage_edges WHERE cluster_id = ? AND ${col} IN (${ph})`,
        [clusterId, ...batch],
      ),
    );

    allEdges.push(...edges);

    // Collect all unvisited neighbor IDs (deduplicated via Set)
    const unvisitedIds = new Set<number>();
    for (const edge of edges) {
      const nextId = dir === 'upstream' ? edge.source_node_id : edge.target_node_id;
      if (!visitedNodes.has(nextId)) {
        unvisitedIds.add(nextId);
      }
    }

    // P-1 fix: batch-fetch unvisited nodes with batch IN protection
    const nextIds: number[] = [];
    if (unvisitedIds.size > 0) {
      const ids = [...unvisitedIds];
      const nodes = await bfsBatchIn<LineageNode>(db, ids, (ph, batch) =>
        db.all<LineageNode>(
          `SELECT * FROM lineage_nodes WHERE id IN (${ph})`,
          batch,
        ),
      );
      for (const node of nodes) {
        visitedNodes.set(node.id, node);
        nextIds.push(node.id);
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
  // R-1 fix: parameterized SYSTEM_DBS for SQLite queries
  const dbList = await db.all<{ db_name: string; cnt: number }>(
    `SELECT db_name, COUNT(*) as cnt FROM lineage_nodes
     WHERE cluster_id = ?
       AND LOWER(db_name) NOT IN (${SYSTEM_DBS_PLACEHOLDERS})
     GROUP BY db_name ORDER BY cnt DESC`,
    [clusterId, ...SYSTEM_DBS_ARRAY],
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

/* ── Data cleanup (M-6: prevent unbounded growth) ─────── */

/** Default retention: edges older than 90 days, sync logs beyond 100 entries */
const EDGE_RETENTION_DAYS = 90;
const SYNC_LOG_RETENTION = 100;

/**
 * Cleanup stale lineage data for a cluster:
 * 1. Delete edges with last_exec_time older than retention period
 * 2. Delete orphan nodes (no edges reference them)
 * 3. Trim sync_log to latest N entries
 */
export async function cleanupLineageData(
  clusterId: number,
  options?: { edgeRetentionDays?: number; syncLogRetention?: number },
): Promise<{ edgesDeleted: number; nodesDeleted: number; logsDeleted: number }> {
  const db = await getLocalDb();
  const retentionDays = options?.edgeRetentionDays ?? EDGE_RETENTION_DAYS;
  const logRetention = options?.syncLogRetention ?? SYNC_LOG_RETENTION;
  const cutoffDate = shanghaiDatetime(new Date(Date.now() - retentionDays * 86400_000));

  let edgesDeleted = 0;
  let nodesDeleted = 0;
  let logsDeleted = 0;

  await db.withTransaction(async (txDb) => {
    // 1. Delete stale edges (last_exec_time older than cutoff)
    const edgeResult = await txDb.run(
      'DELETE FROM lineage_edges WHERE cluster_id = ? AND last_exec_time < ?',
      [clusterId, cutoffDate],
    );
    edgesDeleted = edgeResult.changes;

    // M-1 fix: use NOT EXISTS instead of NOT IN for better performance on large datasets
    // T-4 fix: removed redundant cluster_id in subqueries — node IDs are globally unique
    const orphanResult = await txDb.run(
      `DELETE FROM lineage_nodes WHERE cluster_id = ?
       AND NOT EXISTS (SELECT 1 FROM lineage_edges WHERE source_node_id = lineage_nodes.id)
       AND NOT EXISTS (SELECT 1 FROM lineage_edges WHERE target_node_id = lineage_nodes.id)`,
      [clusterId],
    );
    nodesDeleted = orphanResult.changes;

    // 3. Trim sync_log: keep only the latest N entries
    const cutoffLog = await txDb.get<{ id: number }>(
      'SELECT id FROM lineage_sync_log WHERE cluster_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?',
      [clusterId, logRetention],
    );
    if (cutoffLog) {
      const logResult = await txDb.run(
        'DELETE FROM lineage_sync_log WHERE cluster_id = ? AND id <= ?',
        [clusterId, cutoffLog.id],
      );
      logsDeleted = logResult.changes;
    }
  });

  if (edgesDeleted > 0 || nodesDeleted > 0 || logsDeleted > 0) {
    console.log(
      `[Lineage] Cleanup cluster #${clusterId}: ${edgesDeleted} stale edges, ${nodesDeleted} orphan nodes, ${logsDeleted} old logs deleted`,
    );
  }

  return { edgesDeleted, nodesDeleted, logsDeleted };
}
