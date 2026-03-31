/**
 * Lineage Scheduler — Server-side singleton that manages per-cluster auto-sync timers.
 *
 * Architecture follows the same pattern as health-monitor.ts:
 *   - globalThis-attached state to survive HMR in dev mode
 *   - Auto-start on first import (imported by API route & health-monitor co-init)
 *   - Manages one interval timer per cluster
 *
 * Schedule is persisted in `lineage_schedule` table (V4 migration).
 */

import { getLocalDb, recordAuditLog } from '@/lib/local-db';
import { syncLineage } from '@/lib/lineage-collector';
import { getPool } from '@/lib/db';
import mysql from 'mysql2/promise';

/* ── Types ── */

export interface ScheduleConfig {
  clusterId: number;
  intervalMinutes: number; // 0 = manual
}

interface ClusterRow {
  id: number;
  host: string;
  port: number;
  username: string;
  password: string;
}

/* ── Singleton state (survives HMR in dev) ── */

const globalForScheduler = globalThis as unknown as {
  __lineageTimers?: Map<number, ReturnType<typeof setInterval>>;
  __lineageSchedules?: Map<number, number>; // clusterId → intervalMinutes
  __lineageSchedulerStarted?: boolean;
  __lineageLastSync?: Map<number, number>;  // clusterId → timestamp
};

// Timer map: clusterId → setInterval handle
const _timers: Map<number, ReturnType<typeof setInterval>> =
  globalForScheduler.__lineageTimers || new Map();
if (process.env.NODE_ENV !== 'production') globalForScheduler.__lineageTimers = _timers;

// Schedule cache: clusterId → intervalMinutes
const _schedules: Map<number, number> =
  globalForScheduler.__lineageSchedules || new Map();
if (process.env.NODE_ENV !== 'production') globalForScheduler.__lineageSchedules = _schedules;

// Last sync timestamps
const _lastSync: Map<number, number> =
  globalForScheduler.__lineageLastSync || new Map();
if (process.env.NODE_ENV !== 'production') globalForScheduler.__lineageLastSync = _lastSync;

/* ── Helpers ── */

/**
 * Get a valid sessionId for a cluster (host:port).
 * Ensures the connection pool exists or creates a temporary one.
 */
async function getSessionId(clusterId: number): Promise<string | null> {
  try {
    const db = await getLocalDb();
    const cluster = await db.get<ClusterRow>(
      'SELECT id, host, port, username, password FROM clusters WHERE id = ?',
      [clusterId],
    );
    if (!cluster) return null;

    const sessionId = `${cluster.host}:${cluster.port}`;

    // Ensure pool exists — try a health check first
    const pool = getPool(sessionId);
    if (pool) return sessionId;

    // No pool yet: create a temporary connection to verify, then return sessionId
    // The syncLineage call will use executeQuery which handles pool creation
    let conn;
    try {
      conn = await mysql.createConnection({
        host: cluster.host,
        port: cluster.port,
        user: cluster.username,
        password: cluster.password,
        connectTimeout: 3000,
      });
      await conn.query('SELECT 1');
      return sessionId;
    } catch {
      console.warn(`[LineageScheduler] Cluster #${clusterId} not reachable, skipping sync`);
      return null;
    } finally {
      if (conn) try { await conn.end(); } catch { /* ignore */ }
    }
  } catch (err) {
    console.warn(`[LineageScheduler] Failed to get session for cluster #${clusterId}:`, err);
    return null;
  }
}

/**
 * Run a sync for a cluster (called by timer).
 */
async function runScheduledSync(clusterId: number): Promise<void> {
  // Skip if last sync was too recent (< 30s protection against double-fire)
  const lastTs = _lastSync.get(clusterId) || 0;
  if (Date.now() - lastTs < 30_000) return;

  console.log(`[LineageScheduler] Auto-sync starting for cluster #${clusterId}`);
  _lastSync.set(clusterId, Date.now());

  try {
    const sessionId = await getSessionId(clusterId);
    if (!sessionId) return;

    const result = await syncLineage(sessionId, clusterId);
    console.log(
      `[LineageScheduler] Auto-sync cluster #${clusterId} done:`,
      `${result.digestsFound} digests, ${result.edgesCreated} new, ${result.edgesUpdated} updated`,
    );

    // Audit: lineage.auto_sync
    await recordAuditLog({
      userId: null, username: 'system',
      action: 'lineage.auto_sync', category: 'lineage', level: 'standard',
      target: `集群 #${clusterId}`,
      detail: {
        trigger: 'scheduled',
        intervalMinutes: _schedules.get(clusterId) || 0,
        digestsFound: result.digestsFound,
        edgesCreated: result.edgesCreated,
        edgesUpdated: result.edgesUpdated,
        parseErrors: result.parseErrors,
        status: result.status,
      },
    });
  } catch (err) {
    console.warn(`[LineageScheduler] Auto-sync cluster #${clusterId} failed:`, err);

    // Audit: lineage.auto_sync failure
    await recordAuditLog({
      userId: null, username: 'system',
      action: 'lineage.auto_sync', category: 'lineage', level: 'standard',
      target: `集群 #${clusterId}`,
      detail: {
        trigger: 'scheduled',
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/* ── Public API ── */

/**
 * Get the schedule for a specific cluster.
 */
export async function getSchedule(clusterId: number): Promise<ScheduleConfig> {
  // Check in-memory cache first
  if (_schedules.has(clusterId)) {
    return { clusterId, intervalMinutes: _schedules.get(clusterId)! };
  }
  // Load from DB
  const db = await getLocalDb();
  const row = await db.get<{ interval_minutes: number }>(
    'SELECT interval_minutes FROM lineage_schedule WHERE cluster_id = ?',
    [clusterId],
  );
  const interval = row?.interval_minutes ?? 0;
  _schedules.set(clusterId, interval);
  return { clusterId, intervalMinutes: interval };
}

/**
 * Get the next sync timestamp for a cluster (for countdown display).
 */
export function getNextSyncTime(clusterId: number): number | null {
  const interval = _schedules.get(clusterId) || 0;
  if (interval === 0) return null;
  const lastTs = _lastSync.get(clusterId) || Date.now();
  return lastTs + interval * 60 * 1000;
}

/**
 * Set the schedule for a cluster. Persists to DB and manages the timer.
 */
export async function setSchedule(clusterId: number, intervalMinutes: number): Promise<void> {
  const db = await getLocalDb();

  // Upsert into DB
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM lineage_schedule WHERE cluster_id = ?',
    [clusterId],
  );
  if (existing) {
    await db.run(
      'UPDATE lineage_schedule SET interval_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE cluster_id = ?',
      [intervalMinutes, clusterId],
    );
  } else {
    await db.run(
      'INSERT INTO lineage_schedule (cluster_id, interval_minutes) VALUES (?, ?)',
      [clusterId, intervalMinutes],
    );
  }

  // Update in-memory cache
  _schedules.set(clusterId, intervalMinutes);

  // Manage timer
  applyTimer(clusterId, intervalMinutes);

  console.log(`[LineageScheduler] Schedule updated: cluster #${clusterId} → ${intervalMinutes === 0 ? 'manual' : `every ${intervalMinutes}min`}`);
}

/**
 * Start or stop the timer for a cluster based on interval.
 */
function applyTimer(clusterId: number, intervalMinutes: number): void {
  // Clear existing timer
  const existing = _timers.get(clusterId);
  if (existing) {
    clearInterval(existing);
    _timers.delete(clusterId);
  }

  // If manual, no timer needed
  if (intervalMinutes === 0) return;

  // Set next sync timestamp for countdown
  _lastSync.set(clusterId, Date.now());

  // Create new interval
  const intervalMs = intervalMinutes * 60 * 1000;
  const timer = setInterval(() => {
    runScheduledSync(clusterId);
  }, intervalMs);

  _timers.set(clusterId, timer);
}

/**
 * Initialize the scheduler: load all schedules from DB and start timers.
 */
export async function startLineageScheduler(): Promise<void> {
  if (globalForScheduler.__lineageSchedulerStarted) return;
  globalForScheduler.__lineageSchedulerStarted = true;

  console.log('[LineageScheduler] Starting lineage scheduler...');

  try {
    const db = await getLocalDb();

    // Check if table exists (might not if migration hasn't run yet)
    try {
      const schedules = await db.all<{ cluster_id: number; interval_minutes: number }>(
        'SELECT cluster_id, interval_minutes FROM lineage_schedule WHERE interval_minutes > 0',
      );

      for (const s of schedules) {
        _schedules.set(s.cluster_id, s.interval_minutes);
        applyTimer(s.cluster_id, s.interval_minutes);
      }

      if (schedules.length > 0) {
        console.log(
          `[LineageScheduler] Loaded ${schedules.length} schedule(s):`,
          schedules.map(s => `#${s.cluster_id}→${s.interval_minutes}min`).join(', '),
        );
      } else {
        console.log('[LineageScheduler] No active schedules found');
      }
    } catch {
      // Table doesn't exist yet (migration pending), that's OK
      console.log('[LineageScheduler] Schedule table not ready, will activate after migration');
    }
  } catch (err) {
    console.warn('[LineageScheduler] Failed to start:', err);
  }
}

// Auto-start on first import
startLineageScheduler();
