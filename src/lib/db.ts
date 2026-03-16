import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import { listConnections } from './local-db';

// Store active connection pools by session (preserve across Next.js HMR)
const globalForDb = globalThis as unknown as { __starrocksPools?: Map<string, Pool> };
const pools: Map<string, Pool> = globalForDb.__starrocksPools || new Map();
if (process.env.NODE_ENV !== 'production') globalForDb.__starrocksPools = pools;

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
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000,
  };

  const pool = mysql.createPool(poolOptions);

  // Test connection
  const connection = await pool.getConnection();
  connection.release();

  pools.set(sessionId, pool);
  return pool;
}

export function getPool(sessionId: string): Pool | undefined {
  return pools.get(sessionId);
}

export async function closePool(sessionId: string): Promise<void> {
  const pool = pools.get(sessionId);
  if (pool) {
    try { await pool.end(); } catch { /* ignore */ }
    pools.delete(sessionId);
  }
}

// Recreate pool from saved connection info
async function recreatePool(sessionId: string): Promise<Pool | null> {
  const connections = listConnections();
  const conn = connections.find(c => getSessionId({ host: c.host, port: c.port || 9030, user: c.username, password: '' }) === sessionId);
  if (conn) {
    return createPool({
      host: conn.host,
      port: conn.port || 9030,
      user: conn.username,
      password: conn.password,
      database: conn.default_db || undefined,
    });
  }
  return null;
}

export async function executeQuery<T extends RowDataPacket[] = RowDataPacket[]>(
  sessionId: string,
  sql: string,
  params?: unknown[]
): Promise<{ rows: T; fields: { name: string; type: number }[] }> {
  let pool = getPool(sessionId);
  if (!pool) {
    // Attempt auto-reconnect from local db
    pool = await recreatePool(sessionId) ?? undefined;
    if (!pool) {
      throw new Error('Not connected. Please connect to a StarRocks instance first.');
    }
  }

  // Try query, retry once on connection errors
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [rows, fields] = await pool.query<T>(sql, params);
      return {
        rows,
        fields: fields?.map(f => ({ name: f.name, type: f.type ?? 0 })) || [],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConnectionError = msg.includes('closed state') ||
        msg.includes('ECONNRESET') ||
        msg.includes('PROTOCOL_CONNECTION_LOST') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('Connection lost');

      if (isConnectionError && attempt === 0) {
        console.warn(`[Pool ${sessionId}] Connection error, recreating pool: ${msg}`);
        // Remove dead pool and recreate
        pools.delete(sessionId);
        try { await pool.end(); } catch { /* ignore */ }
        const newPool = await recreatePool(sessionId);
        if (newPool) {
          pool = newPool;
          continue; // retry
        }
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
