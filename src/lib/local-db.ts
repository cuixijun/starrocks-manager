/**
 * Local metadata database — async interface for both SQLite and MySQL.
 */

import { config } from './config';
import { getDb, normalizeTimestamp, shanghaiDatetime } from './db-adapter';
import { runMigrations } from './migrator';
import type { DbAdapter } from './db-adapter';

// ── Schema initializer (called once on first getDb()) ────────────────

let _schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<DbAdapter> {
  const db = await getDb();
  if (!_schemaReady) {
    _schemaReady = initSchema(db);
  }
  await _schemaReady;
  return db;
}

async function initSchema(db: DbAdapter): Promise<void> {
  // Run Flyway-style versioned migrations from db/migrations/
  await runMigrations(db);

  // Auto-seed admin on first run
  const adminExists = await db.get<{ id: number }>('SELECT id FROM sys_users WHERE username = ?', ['admin']);
  if (!adminExists) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(config.admin.password, 10);
    await db.run(
      'INSERT INTO sys_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      ['admin', hash, '管理员', 'admin'],
    );
  }
}

// Re-export for consumers that need the raw adapter
export { getDb, normalizeTimestamp };
export type { DbAdapter };

/**
 * Get the initialized database adapter (schema guaranteed ready).
 */
export async function getLocalDb(): Promise<DbAdapter> {
  return ensureSchema();
}

// ── Settings ─────────────────────────────────────────────────────────

export async function getSetting(key: string, defaultValue?: string): Promise<string | undefined> {
  const db = await getLocalDb();
  const row = await db.get<{ value: string }>(
    db.isMysql ? 'SELECT value FROM settings WHERE `key` = ?' : 'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  return row?.value ?? defaultValue;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getLocalDb();
  const sql = db.upsertSql(
    'settings',
    db.isMysql ? ['`key`', 'value', 'updated_at'] : ['key', 'value', 'updated_at'],
    ['key'],
    ['value', 'updated_at'],
  );
  await db.run(sql, [key, value, shanghaiDatetime()]);
}

// ── DB Metadata Cache ────────────────────────────────────────────────

export const DEFAULT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

export interface DbCacheEntry {
  id: number;
  connection_id: string;
  db_name: string;
  table_count: number;
  view_count: number;
  mv_count: number;
  cached_at: string;
}

export async function getDbCache(connectionId: string, maxAgeMs: number = DEFAULT_CACHE_MAX_AGE_MS): Promise<DbCacheEntry[]> {
  const db = await getLocalDb();
  const rows = await db.all<DbCacheEntry>(
    'SELECT * FROM db_metadata_cache WHERE connection_id = ? ORDER BY db_name ASC',
    [connectionId],
  );

  const normalized = rows.map(r => ({ ...r, cached_at: normalizeTimestamp(r.cached_at) }));

  if (normalized.length > 0 && maxAgeMs > 0) {
    const cachedTime = new Date(normalized[0].cached_at).getTime();
    if (Date.now() - cachedTime > maxAgeMs) return [];
  }
  return normalized;
}

export async function upsertDbCache(
  connectionId: string,
  databases: { name: string; tableCount: number; viewCount: number; mvCount: number }[],
): Promise<void> {
  const db = await getLocalDb();
  const upsertSql = db.upsertSql(
    'db_metadata_cache',
    ['connection_id', 'db_name', 'table_count', 'view_count', 'mv_count', 'cached_at'],
    ['connection_id', 'db_name'],
    ['table_count', 'view_count', 'mv_count', 'cached_at'],
  );
  const now = shanghaiDatetime();

  await db.withTransaction(async (tx) => {
    for (const d of databases) {
      await tx.run(upsertSql, [connectionId, d.name, d.tableCount, d.viewCount, d.mvCount, now]);
    }
    // Remove stale entries — use app-level param expansion (works on both backends)
    if (databases.length > 0) {
      const names = databases.map(d => d.name);
      const placeholders = names.map(() => '?').join(', ');
      await tx.run(
        `DELETE FROM db_metadata_cache WHERE connection_id = ? AND db_name NOT IN (${placeholders})`,
        [connectionId, ...names],
      );
    } else {
      await tx.run('DELETE FROM db_metadata_cache WHERE connection_id = ?', [connectionId]);
    }
  });
}

// ── Generic JSON Blob Cache ──────────────────────────────────────────

interface BlobCacheRow {
  connection_id: string;
  data: string;
  cached_at: string;
}

export type CacheTable = 'users_cache' | 'roles_cache' | 'resource_groups_cache' | 'catalogs_cache' | 'functions_cache' | 'variables_cache' | 'materialized_views_cache' | 'broker_load_cache' | 'routine_load_cache' | 'pipes_cache' | 'tasks_cache' | 'task_runs_cache' | 'task_runs_all_cache' | 'nodes_cache' | 'show_proc_cache';

export async function getBlobCache(table: CacheTable, connectionId: string, maxAgeMs: number = DEFAULT_CACHE_MAX_AGE_MS): Promise<{ data: unknown; cachedAt: string } | null> {
  const db = await getLocalDb();
  const row = await db.get<BlobCacheRow>(
    `SELECT data, cached_at FROM ${table} WHERE connection_id = ?`,
    [connectionId],
  );
  if (!row) return null;
  try {
    const cachedAt = normalizeTimestamp(row.cached_at);
    if (maxAgeMs > 0) {
      const cachedTime = new Date(cachedAt).getTime();
      if (Date.now() - cachedTime > maxAgeMs) return null;
    }
    return { data: JSON.parse(row.data), cachedAt };
  } catch {
    return null;
  }
}

export async function setBlobCache(table: CacheTable, connectionId: string, data: unknown): Promise<string> {
  const db = await getLocalDb();
  const json = JSON.stringify(data);
  const now = shanghaiDatetime();
  const sql = db.upsertSql(table, ['connection_id', 'data', 'cached_at'], ['connection_id'], ['data', 'cached_at']);
  await db.run(sql, [connectionId, json, now]);
  const row = await db.get<{ cached_at: string }>(`SELECT cached_at FROM ${table} WHERE connection_id = ?`, [connectionId]);
  return normalizeTimestamp(row?.cached_at || now);
}

// ── Command Execution Log ────────────────────────────────────────────

export interface CommandLogEntry {
  id: number;
  session_id: string;
  source: string;
  sql_text: string;
  status: string;
  error_message: string | null;
  row_count: number;
  duration_ms: number;
  created_at: string;
}

export async function appendCommandLog(
  sessionId: string,
  source: string,
  sqlText: string,
  status: 'success' | 'error',
  rowCount: number,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  try {
    const db = await getLocalDb();
    await db.run(
      'INSERT INTO command_log (session_id, source, sql_text, status, error_message, row_count, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sessionId, source, sqlText, status, errorMessage || null, rowCount, durationMs],
    );
    // Auto-cleanup: keep last 500 per session (derived table for MySQL compat)
    await db.run(
      `DELETE FROM command_log WHERE session_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM command_log WHERE session_id = ? ORDER BY id DESC LIMIT 500) AS keep_ids)`,
      [sessionId, sessionId],
    );
  } catch { /* ignore logging errors */ }
}

export async function getCommandLogs(sessionId: string, source?: string, limit = 100): Promise<CommandLogEntry[]> {
  const db = await getLocalDb();
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  if (source) {
    return db.all<CommandLogEntry>(
      `SELECT * FROM command_log WHERE session_id = ? AND source = ? ORDER BY id DESC LIMIT ${safeLimit}`,
      [sessionId, source],
    );
  }
  return db.all<CommandLogEntry>(
    `SELECT * FROM command_log WHERE session_id = ? ORDER BY id DESC LIMIT ${safeLimit}`,
    [sessionId],
  );
}

export async function clearCommandLogs(sessionId: string, source?: string): Promise<void> {
  const db = await getLocalDb();
  if (source) {
    await db.run('DELETE FROM command_log WHERE session_id = ? AND source = ?', [sessionId, source]);
  } else {
    await db.run('DELETE FROM command_log WHERE session_id = ?', [sessionId]);
  }
}

// ── Audit System ─────────────────────────────────────────────────────

export type AuditLevel = 'off' | 'basic' | 'standard' | 'full';

const AUDIT_LEVEL_PRIORITY: Record<AuditLevel, number> = { off: 0, basic: 1, standard: 2, full: 3 };

export async function getAuditLevel(): Promise<AuditLevel> {
  const val = await getSetting('audit_level', 'standard');
  if (val && val in AUDIT_LEVEL_PRIORITY) return val as AuditLevel;
  return 'standard';
}

export async function setAuditLevel(level: AuditLevel): Promise<void> {
  await setSetting('audit_level', level);
}

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  category: string;
  level: string;
  target: string;
  detail: string;
  ip_address: string;
  created_at: string;
}

export interface RecordAuditParams {
  userId?: number | null;
  username: string;
  action: string;
  category: string;
  level: AuditLevel;
  target?: string;
  detail?: string | object;
  ipAddress?: string;
}

export async function recordAuditLog(params: RecordAuditParams): Promise<void> {
  try {
    const currentLevel = await getAuditLevel();
    if (AUDIT_LEVEL_PRIORITY[currentLevel] < AUDIT_LEVEL_PRIORITY[params.level]) return;

    const db = await getLocalDb();
    const detailStr = typeof params.detail === 'object' ? JSON.stringify(params.detail) : (params.detail || '');
    const now = shanghaiDatetime();

    await db.run(
      'INSERT INTO audit_logs (user_id, username, action, category, level, target, detail, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [params.userId ?? null, params.username, params.action, params.category, params.level, params.target || '', detailStr, params.ipAddress || '', now],
    );

    // Auto-cleanup: keep last 10000 (derived table for MySQL compat)
    await db.run(
      'DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM (SELECT id FROM audit_logs ORDER BY id DESC LIMIT 10000) AS keep_ids)',
    );
  } catch { /* ignore audit errors */ }
}

export interface AuditLogQuery {
  page?: number;
  pageSize?: number;
  category?: string;
  username?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Convert a date string (ISO or local) to MySQL-compatible datetime in Shanghai timezone.
 * "2026-03-28T12:23:46.787Z" → "2026-03-28 20:23:46" (UTC→+08:00)
 * "2026-03-28 20:23:46"      → "2026-03-28 20:23:46" (pass-through)
 */
function toShanghaiDatetime(dateStr: string): string {
  // Already a plain datetime string without timezone qualifier → pass through
  if (!dateStr.includes('T') && !dateStr.includes('Z') && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return dateStr.replace(/\.\d+$/, '');
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return dateStr.replace('T', ' ').replace('Z', '').replace(/\.\d+$/, '');
  }
  return shanghaiDatetime(d);
}

export async function queryAuditLogs(query: AuditLogQuery = {}): Promise<{ logs: AuditLogEntry[]; total: number }> {
  const db = await getLocalDb();
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (query.category) { conditions.push('category = ?'); values.push(query.category); }
  if (query.username) { conditions.push('username LIKE ?'); values.push(`%${query.username}%`); }
  if (query.action) { conditions.push('action LIKE ?'); values.push(`%${query.action}%`); }
  if (query.startDate) {
    const dt = toShanghaiDatetime(query.startDate);
    conditions.push('created_at >= ?');
    values.push(dt);
  }
  if (query.endDate) {
    const dt = toShanghaiDatetime(query.endDate);
    conditions.push('created_at <= ?');
    values.push(dt);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`, values);
  const total = countRow?.cnt || 0;
  const logs = await db.all<AuditLogEntry>(
    `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    [...values],
  );

  return { logs, total };
}
