import { getLocalDb } from '@/lib/local-db';
import { clearConnectionFailure, getPool } from '@/lib/db';
import { config } from '@/lib/config';
import mysql from 'mysql2/promise';
// Co-start lineage scheduler with health monitor
import '@/lib/lineage-scheduler';

export interface ClusterHealthStatus {
  status: 'online' | 'offline';
  version?: string;
  checkedAt: string;
}

// ─── Singleton state (survives HMR in dev) ───
const globalForHealth = globalThis as unknown as {
  __healthCache?: Record<number, ClusterHealthStatus>;
  __healthTimer?: ReturnType<typeof setInterval>;
  __healthRunning?: boolean;
  __lastCheckTime?: number;
};

const HEALTH_INTERVAL_MS = config.health_check.interval * 1000;

// Shared cache: cluster id → health status
let _healthCache: Record<number, ClusterHealthStatus> = globalForHealth.__healthCache || {};
if (process.env.NODE_ENV !== 'production') globalForHealth.__healthCache = _healthCache;

/** Get the cached health status for all clusters */
export function getHealthCache(): Record<number, ClusterHealthStatus> {
  return _healthCache;
}

/** Get when the last check completed */
export function getLastCheckTime(): number {
  return globalForHealth.__lastCheckTime || 0;
}

interface ClusterRow {
  id: number;
  host: string;
  port: number;
  username: string;
  password: string;
}

/** Check all clusters and update the shared cache */
export async function checkAllClustersHealth(): Promise<void> {
  try {
    const db = await getLocalDb();
    const clusters = await db.all<ClusterRow>(
      'SELECT id, host, port, username, password FROM clusters',
    );

    const newCache: Record<number, ClusterHealthStatus> = {};

    await Promise.allSettled(
      clusters.map(async (c) => {
        const sessionId = `${c.host}:${c.port}`;
        let status: 'online' | 'offline' = 'offline';
        let version: string | undefined;

        // Strategy: try pool first (zero-cost), fall back to direct connection
        const pool = getPool(sessionId);
        if (pool) {
          try {
            const queryPromise = pool.query('SELECT version() as v');
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 2000)
            );
            const [rows] = await Promise.race([queryPromise, timeoutPromise]) as [Array<{ v: string }>];
            version = rows[0]?.v;
            status = 'online';
            clearConnectionFailure(sessionId);
          } catch { /* pool query failed or timed out */ }
        } else {
          let conn;
          try {
            conn = await mysql.createConnection({
              host: c.host,
              port: c.port,
              user: c.username,
              password: c.password,
              connectTimeout: 1500,
            });
            const [rows] = await conn.query('SELECT version() as v');
            version = (rows as Array<{ v: string }>)[0]?.v;
            status = 'online';
            clearConnectionFailure(sessionId);
          } catch { /* offline */ }
          finally {
            if (conn) try { await conn.end(); } catch { /* ignore */ }
          }
        }

        newCache[c.id] = {
          status,
          version,
          checkedAt: new Date().toISOString(),
        };
      })
    );

    // Update cache atomically
    _healthCache = newCache;
    if (process.env.NODE_ENV !== 'production') globalForHealth.__healthCache = _healthCache;
    globalForHealth.__lastCheckTime = Date.now();

    console.log(
      `[HealthMonitor] Checked ${Object.keys(newCache).length} clusters:`,
      Object.entries(newCache).map(([id, h]) => `#${id}=${h.status}`).join(', ')
    );
  } catch (err) {
    console.warn('[HealthMonitor] Check failed:', err);
  }
}

/** Start the singleton health monitor timer. Safe to call multiple times. */
export function startHealthMonitor(): void {
  if (globalForHealth.__healthRunning) return; // Already running
  globalForHealth.__healthRunning = true;

  console.log('[HealthMonitor] Starting singleton health monitor (interval: 5min)');

  // Initial check immediately
  checkAllClustersHealth();

  // Then every 5 minutes
  if (globalForHealth.__healthTimer) clearInterval(globalForHealth.__healthTimer);
  globalForHealth.__healthTimer = setInterval(() => {
    checkAllClustersHealth();
  }, HEALTH_INTERVAL_MS);
}

// Auto-start on first import
startHealthMonitor();
