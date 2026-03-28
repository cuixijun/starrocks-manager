import path from 'path';
import fs from 'fs';
import { config } from './config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

export function getLocalDb() {
  if (db) return db;

  const DB_PATH = path.isAbsolute(config.database.sqlite.path)
    ? config.database.sqlite.path
    : path.join(process.cwd(), config.database.sqlite.path);
  const DB_DIR = path.dirname(DB_PATH);

  // Ensure data directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  // eval('require') completely hides the module from Turbopack/webpack static analysis
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-eval
  const Database = eval('require')('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 9030,
      username TEXT NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      default_db TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Databases + table count cache
    CREATE TABLE IF NOT EXISTS db_metadata_cache (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      db_name      TEXT NOT NULL,
      table_count  INTEGER NOT NULL DEFAULT 0,
      view_count   INTEGER NOT NULL DEFAULT 0,
      mv_count     INTEGER NOT NULL DEFAULT 0,
      cached_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(connection_id, db_name)
    );

    -- Users cache (stores JSON blob of all users for a connection)
    CREATE TABLE IF NOT EXISTS users_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Roles cache
    CREATE TABLE IF NOT EXISTS roles_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Resource groups cache
    CREATE TABLE IF NOT EXISTS resource_groups_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Catalogs cache
    CREATE TABLE IF NOT EXISTS catalogs_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Functions cache
    CREATE TABLE IF NOT EXISTS functions_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Variables cache
    CREATE TABLE IF NOT EXISTS variables_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Materialized views cache
    CREATE TABLE IF NOT EXISTS materialized_views_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Broker Load cache
    CREATE TABLE IF NOT EXISTS broker_load_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Routine Load cache
    CREATE TABLE IF NOT EXISTS routine_load_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Pipes cache
    CREATE TABLE IF NOT EXISTS pipes_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tasks cache
    CREATE TABLE IF NOT EXISTS tasks_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Task runs cache (per-task drill-down, keyed by sessionId::taskName)
    CREATE TABLE IF NOT EXISTS task_runs_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Task runs all cache (generic task runs list)
    CREATE TABLE IF NOT EXISTS task_runs_all_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Nodes cache
    CREATE TABLE IF NOT EXISTS nodes_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Command execution log
    CREATE TABLE IF NOT EXISTS command_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'unknown',
      sql_text      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      row_count     INTEGER DEFAULT 0,
      duration_ms   INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_command_log_session_source ON command_log(session_id, source);
    CREATE INDEX IF NOT EXISTS idx_command_log_created ON command_log(created_at);

    -- System users (application-level auth)
    CREATE TABLE IF NOT EXISTS sys_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'viewer',
      is_active     INTEGER DEFAULT 1,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    );

    -- StarRocks cluster configs (managed by admin)
    CREATE TABLE IF NOT EXISTS clusters (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      host        TEXT NOT NULL,
      port        INTEGER NOT NULL DEFAULT 9030,
      username    TEXT NOT NULL,
      password    TEXT NOT NULL DEFAULT '',
      default_db  TEXT DEFAULT '',
      description TEXT DEFAULT '',
      is_active   INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User-cluster access control
    CREATE TABLE IF NOT EXISTS user_cluster_access (
      user_id    INTEGER NOT NULL,
      cluster_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, cluster_id),
      FOREIGN KEY (user_id)    REFERENCES sys_users(id) ON DELETE CASCADE,
      FOREIGN KEY (cluster_id) REFERENCES clusters(id)  ON DELETE CASCADE
    );

    -- System sessions
    CREATE TABLE IF NOT EXISTS sys_sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      cluster_id  INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at  DATETIME NOT NULL,
      FOREIGN KEY (user_id)    REFERENCES sys_users(id) ON DELETE CASCADE,
      FOREIGN KEY (cluster_id) REFERENCES clusters(id)  ON DELETE SET NULL
    );

    -- Audit logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      username   TEXT NOT NULL,
      action     TEXT NOT NULL,
      category   TEXT NOT NULL DEFAULT 'system',
      level      TEXT NOT NULL DEFAULT 'basic',
      target     TEXT DEFAULT '',
      detail     TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);

    -- System role permissions (configurable access control)
    CREATE TABLE IF NOT EXISTS sys_role_permissions (
      role       TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted    INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (role, permission)
    );
  `);

  // Auto-seed admin user on first run
  const adminExists = db.prepare('SELECT id FROM sys_users WHERE username = ?').get('admin');
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(config.admin.password, 10);
    db.prepare('INSERT INTO sys_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run('admin', hash, '管理员', 'admin');
  }

  return db;
}


// ---- Settings ----

export function getSetting(key: string, defaultValue?: string): string | undefined {
  const db = getLocalDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? defaultValue;
}

export function setSetting(key: string, value: string): void {
  const db = getLocalDb();
  db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
  ).run(key, value);
}

// ---- DB Metadata Cache (databases + table counts) ----

// Default cache max age: 5 minutes (in milliseconds)
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

export function getDbCache(connectionId: string, maxAgeMs: number = DEFAULT_CACHE_MAX_AGE_MS): DbCacheEntry[] {
  const db = getLocalDb();
  const rows = db
    .prepare('SELECT * FROM db_metadata_cache WHERE connection_id = ? ORDER BY db_name ASC')
    .all(connectionId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => {
      const row = r as DbCacheEntry;
      // SQLite CURRENT_TIMESTAMP is UTC — normalize to ISO 8601 with Z suffix
      const cachedAt = row.cached_at.endsWith('Z') ? row.cached_at : row.cached_at.replace(' ', 'T') + 'Z';
      return { ...row, cached_at: cachedAt };
    }) as DbCacheEntry[];

  // Check expiry
  if (rows.length > 0 && maxAgeMs > 0) {
    const cachedTime = new Date(rows[0].cached_at).getTime();
    if (Date.now() - cachedTime > maxAgeMs) {
      return []; // Cache expired
    }
  }

  return rows;
}

export function upsertDbCache(
  connectionId: string,
  databases: { name: string; tableCount: number; viewCount: number; mvCount: number }[]
): void {
  const db = getLocalDb();

  // Migrate: add view_count and mv_count columns if missing
  try {
    db.prepare('SELECT view_count FROM db_metadata_cache LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE db_metadata_cache ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE db_metadata_cache ADD COLUMN mv_count INTEGER NOT NULL DEFAULT 0');
  }

  const upsert = db.prepare(`
    INSERT INTO db_metadata_cache (connection_id, db_name, table_count, view_count, mv_count, cached_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(connection_id, db_name)
    DO UPDATE SET table_count = excluded.table_count, view_count = excluded.view_count, mv_count = excluded.mv_count, cached_at = CURRENT_TIMESTAMP
  `);
  const deleteOld = db.prepare(
    'DELETE FROM db_metadata_cache WHERE connection_id = ? AND db_name NOT IN (SELECT value FROM json_each(?))'
  );

  const txn = db.transaction(() => {
    for (const d of databases) {
      upsert.run(connectionId, d.name, d.tableCount, d.viewCount, d.mvCount);
    }
    // Remove stale entries (databases that were dropped)
    const names = JSON.stringify(databases.map(d => d.name));
    deleteOld.run(connectionId, names);
  });
  txn();
}

// ---- Generic JSON Blob Cache (users / roles / resource_groups) ----

interface BlobCacheRow {
  connection_id: string;
  data: string;
  cached_at: string;
}

type CacheTable = 'users_cache' | 'roles_cache' | 'resource_groups_cache' | 'catalogs_cache' | 'functions_cache' | 'variables_cache' | 'materialized_views_cache' | 'broker_load_cache' | 'routine_load_cache' | 'pipes_cache' | 'tasks_cache' | 'task_runs_cache' | 'task_runs_all_cache' | 'nodes_cache';

export function getBlobCache(table: CacheTable, connectionId: string, maxAgeMs: number = DEFAULT_CACHE_MAX_AGE_MS): { data: unknown; cachedAt: string } | null {
  const db = getLocalDb();
  const row = db.prepare(`SELECT data, cached_at FROM ${table} WHERE connection_id = ?`).get(connectionId) as BlobCacheRow | undefined;
  if (!row) return null;
  try {
    // SQLite CURRENT_TIMESTAMP is UTC but has no 'Z' suffix — append it so JS parses as UTC
    const cachedAt = row.cached_at.endsWith('Z') ? row.cached_at : row.cached_at.replace(' ', 'T') + 'Z';

    // Check expiry
    if (maxAgeMs > 0) {
      const cachedTime = new Date(cachedAt).getTime();
      if (Date.now() - cachedTime > maxAgeMs) {
        return null; // Cache expired
      }
    }

    return { data: JSON.parse(row.data), cachedAt };
  } catch {
    return null;
  }
}

export function setBlobCache(table: CacheTable, connectionId: string, data: unknown): string {
  const db = getLocalDb();
  const json = JSON.stringify(data);
  db.prepare(`
    INSERT INTO ${table} (connection_id, data, cached_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(connection_id)
    DO UPDATE SET data = excluded.data, cached_at = CURRENT_TIMESTAMP
  `).run(connectionId, json);
  const row = db.prepare(`SELECT cached_at FROM ${table} WHERE connection_id = ?`).get(connectionId) as { cached_at: string };
  const rawAt = row.cached_at;
  return rawAt.endsWith('Z') ? rawAt : rawAt.replace(' ', 'T') + 'Z';
}

// ---- Command Execution Log ----

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

export function appendCommandLog(
  sessionId: string,
  source: string,
  sqlText: string,
  status: 'success' | 'error',
  rowCount: number,
  durationMs: number,
  errorMessage?: string,
): void {
  try {
    const db = getLocalDb();
    db.prepare(`
      INSERT INTO command_log (session_id, source, sql_text, status, error_message, row_count, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, source, sqlText, status, errorMessage || null, rowCount, durationMs);
    // Auto-cleanup: keep only last 500 entries per session to prevent unbounded growth
    db.prepare(`
      DELETE FROM command_log WHERE session_id = ? AND id NOT IN (
        SELECT id FROM command_log WHERE session_id = ? ORDER BY id DESC LIMIT 500
      )
    `).run(sessionId, sessionId);
  } catch { /* ignore logging errors to avoid disrupting main flow */ }
}

export function getCommandLogs(
  sessionId: string,
  source?: string,
  limit = 100,
): CommandLogEntry[] {
  const db = getLocalDb();
  if (source) {
    return db.prepare(
      `SELECT * FROM command_log WHERE session_id = ? AND source = ? ORDER BY id DESC LIMIT ?`
    ).all(sessionId, source, limit) as CommandLogEntry[];
  }
  return db.prepare(
    `SELECT * FROM command_log WHERE session_id = ? ORDER BY id DESC LIMIT ?`
  ).all(sessionId, limit) as CommandLogEntry[];
}

export function clearCommandLogs(sessionId: string, source?: string): void {
  const db = getLocalDb();
  if (source) {
    db.prepare('DELETE FROM command_log WHERE session_id = ? AND source = ?').run(sessionId, source);
  } else {
    db.prepare('DELETE FROM command_log WHERE session_id = ?').run(sessionId);
  }
}

// ---- Audit System ----

export type AuditLevel = 'off' | 'basic' | 'standard' | 'full';

const AUDIT_LEVEL_PRIORITY: Record<AuditLevel, number> = {
  off: 0,
  basic: 1,
  standard: 2,
  full: 3,
};

export function getAuditLevel(): AuditLevel {
  const val = getSetting('audit_level', 'standard');
  if (val && val in AUDIT_LEVEL_PRIORITY) return val as AuditLevel;
  return 'standard';
}

export function setAuditLevel(level: AuditLevel): void {
  setSetting('audit_level', level);
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

export function recordAuditLog(params: RecordAuditParams): void {
  try {
    const currentLevel = getAuditLevel();
    // Check if current audit level covers this event
    if (AUDIT_LEVEL_PRIORITY[currentLevel] < AUDIT_LEVEL_PRIORITY[params.level]) {
      return; // Audit level too low, skip
    }

    const db = getLocalDb();
    const detailStr = typeof params.detail === 'object' ? JSON.stringify(params.detail) : (params.detail || '');

    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, category, level, target, detail, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.userId ?? null,
      params.username,
      params.action,
      params.category,
      params.level,
      params.target || '',
      detailStr,
      params.ipAddress || '',
    );

    // Auto-cleanup: keep only last 10000 entries
    db.prepare(`
      DELETE FROM audit_logs WHERE id NOT IN (
        SELECT id FROM audit_logs ORDER BY id DESC LIMIT 10000
      )
    `).run();
  } catch { /* ignore audit errors to avoid disrupting main flow */ }
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

export function queryAuditLogs(query: AuditLogQuery = {}): { logs: AuditLogEntry[]; total: number } {
  const db = getLocalDb();
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (query.category) {
    conditions.push('category = ?');
    values.push(query.category);
  }
  if (query.username) {
    conditions.push('username LIKE ?');
    values.push(`%${query.username}%`);
  }
  if (query.action) {
    conditions.push('action LIKE ?');
    values.push(`%${query.action}%`);
  }
  if (query.startDate) {
    conditions.push("datetime(created_at) >= datetime(?)");
    values.push(query.startDate);
  }
  if (query.endDate) {
    conditions.push("datetime(created_at) <= datetime(?)");
    values.push(query.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`).get(...values) as { cnt: number }).cnt;
  const logs = db.prepare(
    `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...values, pageSize, offset) as AuditLogEntry[];

  return { logs, total };
}
