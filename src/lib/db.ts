import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import { appendCommandLog } from './local-db';

// Store active connection pools by session (preserve across Next.js HMR)
const globalForDb = globalThis as unknown as {
  __starrocksPools?: Map<string, Pool>;
  __failedConnections?: Map<string, number>;
};
const pools: Map<string, Pool> = globalForDb.__starrocksPools || new Map();
if (process.env.NODE_ENV !== 'production') globalForDb.__starrocksPools = pools;

// Connection failure cache: sessionId → timestamp of last failure
// Prevents retrying connections that are known to be down
const FAILURE_COOLDOWN_MS = 30_000; // Don't retry for 30 seconds after failure
const failedConnections: Map<string, number> = globalForDb.__failedConnections || new Map();
if (process.env.NODE_ENV !== 'production') globalForDb.__failedConnections = failedConnections;

export interface StarRocksConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
}

export function getSessionId(config: StarRocksConnectionConfig): string {
  return `${config.user}@${config.host}:${config.port}`;
}

/** Check if a sessionId is in failure cooldown */
function isInFailureCooldown(sessionId: string): boolean {
  const failedAt = failedConnections.get(sessionId);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    failedConnections.delete(sessionId);
    return false;
  }
  return true;
}

/** Mark a sessionId as failed */
function markConnectionFailed(sessionId: string): void {
  failedConnections.set(sessionId, Date.now());
}

/** Clear failure status for a sessionId */
export function clearConnectionFailure(sessionId: string): void {
  failedConnections.delete(sessionId);
  // Also clear by host:port pattern
  for (const key of failedConnections.keys()) {
    if (key.endsWith(`@${sessionId}`) || key === sessionId) {
      failedConnections.delete(key);
    }
  }
}

export async function createPool(config: StarRocksConnectionConfig): Promise<Pool> {
  const sessionId = getSessionId(config);

  // Close existing pool if any
  const existing = pools.get(sessionId);
  if (existing) {
    try { await existing.end(); } catch { /* ignore */ }
    pools.delete(sessionId);
  }

  const poolOptions: PoolOptions = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database || undefined,
    waitForConnections: true,
    connectionLimit: 1,       // 单连接复用，所有查询排队使用同一个连接
    queueLimit: 0,
    connectTimeout: 5000,
    enableKeepAlive: true,    // 保持连接存活，防止被服务端超时断开
    keepAliveInitialDelay: 30000, // 30秒发一次 keepAlive 心跳
  };

  const pool = mysql.createPool(poolOptions);

  // Test connection
  try {
    const connection = await pool.getConnection();
    connection.release();
  } catch (err) {
    // Mark as failed and clean up pool
    markConnectionFailed(sessionId);
    // Also mark host:port pattern for the bridged sessionId
    markConnectionFailed(`${config.host}:${config.port}`);
    try { await pool.end(); } catch { /* ignore */ }
    throw err;
  }

  // Activate all granted roles (e.g. cluster_admin for NODE privilege)
  // Uses the promise-based pool.query which is compatible with mysql2/promise
  try { await pool.query('SET ROLE ALL'); } catch { /* ignore — user may not have extra roles */ }

  // Clear failure cache on success
  failedConnections.delete(sessionId);
  failedConnections.delete(`${config.host}:${config.port}`);
  pools.set(sessionId, pool);
  // Also alias under host:port so API calls (which use host:port) can find it directly
  const hostPortKey = `${config.host}:${config.port}`;
  if (hostPortKey !== sessionId) {
    pools.set(hostPortKey, pool);
  }
  return pool;
}

export function getPool(sessionId: string): Pool | undefined {
  return pools.get(sessionId);
}

/** Remove ALL pool map entries that point to the same Pool object */
function cleanupPoolByValue(pool: Pool): void {
  for (const [key, val] of pools.entries()) {
    if (val === pool) {
      pools.delete(key);
    }
  }
}

export async function closePool(sessionId: string): Promise<void> {
  const pool = pools.get(sessionId);
  if (pool) {
    try { await pool.end(); } catch { /* ignore */ }
    pools.delete(sessionId);
  }
}

// Recreate pool from cluster config or saved connection info
async function recreatePool(sessionId: string): Promise<Pool | null> {
  // Check failure cooldown FIRST — don't even try if recently failed
  if (isInFailureCooldown(sessionId)) {
    return null;
  }

  // Try clusters table first (new auth model: sessionId = "host:port")
  try {
    const { getLocalDb } = require('./local-db');
    const db = getLocalDb();
    const [host, portStr] = sessionId.split(':');
    if (host && portStr) {
      const cluster = db.prepare(
        'SELECT * FROM clusters WHERE host = ? AND port = ? AND is_active = 1'
      ).get(host, parseInt(portStr, 10)) as { host: string; port: number; username: string; password: string; default_db: string } | undefined;
      if (cluster) {
        const pool = await createPool({
          host: cluster.host,
          port: cluster.port,
          user: cluster.username,
          password: cluster.password,
          database: cluster.default_db || undefined,
        });
        // createPool stores under "user@host:port", but callers use "host:port"
        // Alias the pool under the plain sessionId so subsequent lookups hit directly
        pools.set(sessionId, pool);
        return pool;
      }
    }
  } catch { /* ignore - might not have clusters table yet */ }

  return null;
}

export async function executeQuery<T extends RowDataPacket[] = RowDataPacket[]>(
  sessionId: string,
  sql: string,
  params?: unknown[],
  source?: string,
): Promise<{ rows: T; fields: { name: string; type: number }[] }> {
  // Fast-fail if in failure cooldown — unconditional circuit breaker.
  // Once a connection is known to be down, reject ALL queries immediately
  // until the cooldown expires. This prevents 500 error floods.
  if (isInFailureCooldown(sessionId)) {
    const errMsg = '集群连接不可用，请检查集群状态后重试';
    // Only log non-health-check queries to avoid log noise
    if (source && source !== 'health') {
      appendCommandLog(sessionId, source, sql, 'error', 0, 0, errMsg);
    }
    throw new Error(errMsg);
  }

  let pool = getPool(sessionId);
  if (!pool) {
    // Attempt auto-reconnect from local db
    pool = await recreatePool(sessionId) ?? undefined;
    if (!pool) {
      throw new Error('Not connected. Please connect to a StarRocks instance first.');
    }
  }

  const startTime = Date.now();

  // Try query, retry once on connection errors (but NOT recreatePool to avoid 10s delay)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [rows, fields] = await pool.query<T>(sql, params);
      const durationMs = Date.now() - startTime;
      // Log to command_log if source is provided
      if (source) {
        appendCommandLog(sessionId, source, sql, 'success', Array.isArray(rows) ? rows.length : 0, durationMs);
      }
      return {
        rows,
        fields: fields?.map(f => ({ name: f.name, type: f.type ?? 0 })) || [],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConnectionError = msg.includes('closed state') ||
        msg.includes('Pool is closed') ||
        msg.includes('ECONNRESET') ||
        msg.includes('PROTOCOL_CONNECTION_LOST') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('Connection lost');

      if (isConnectionError && attempt === 0) {
        console.warn(`[Pool ${sessionId}] Connection error: ${msg}`);
        // Remove dead pool AND all aliases pointing to same pool object
        cleanupPoolByValue(pool);
        try { await pool.end(); } catch { /* ignore */ }
        // Mark as failed to prevent rapid retries from other requests
        markConnectionFailed(sessionId);
        // Also mark the host:port pattern (dashboard uses host:port, other pages use user@host:port)
        const atIdx = sessionId.indexOf('@');
        if (atIdx >= 0) markConnectionFailed(sessionId.slice(atIdx + 1));
      } else if (isConnectionError) {
        // Second attempt also failed — ensure we mark as failed
        markConnectionFailed(sessionId);
        const atIdx = sessionId.indexOf('@');
        if (atIdx >= 0) markConnectionFailed(sessionId.slice(atIdx + 1));
      }
      // Log error if source is provided (skip health checks to reduce noise)
      if (source && source !== 'health') {
        const durationMs = Date.now() - startTime;
        appendCommandLog(sessionId, source, sql, 'error', 0, durationMs, msg);
      }
      throw err;
    }
  }

  throw new Error('Query failed after retry');
}

export async function testConnection(config: StarRocksConnectionConfig): Promise<{
  success: boolean;
  version?: string;
  error?: string;
}> {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      connectTimeout: 10000,
    });

    const [rows] = await connection.query<RowDataPacket[]>('SELECT VERSION() as version');
    const version = rows[0]?.version || 'Unknown';

    return { success: true, version };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// ── Graceful shutdown: close all pools on process exit ──
async function closeAllPools(): Promise<void> {
  const entries = Array.from(pools.entries());
  const closed = new Set<Pool>();
  for (const [key, pool] of entries) {
    if (!closed.has(pool)) {
      closed.add(pool);
      try { await pool.end(); } catch { /* ignore */ }
    }
    pools.delete(key);
  }
  if (closed.size > 0) {
    console.log(`[DB] Graceful shutdown: closed ${closed.size} connection pool(s)`);
  }
}

// Register shutdown hooks (only once via global flag)
const globalShutdown = globalThis as unknown as { __dbShutdownRegistered?: boolean };
if (!globalShutdown.__dbShutdownRegistered) {
  globalShutdown.__dbShutdownRegistered = true;

  const handleShutdown = (signal: string) => {
    console.log(`[DB] Received ${signal}, closing connection pools...`);
    closeAllPools().finally(() => process.exit(0));
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('beforeExit', () => {
    closeAllPools().catch(() => { /* ignore */ });
  });
}
