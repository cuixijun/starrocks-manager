/**
 * Local metadata database — async interface for both SQLite and MySQL.
 */

import { config } from './config';
import { getDb, normalizeTimestamp } from './db-adapter';
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
  if (db.isMysql) {
    // MySQL: schema auto-created via multi-statement DDL
    await db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL, host VARCHAR(255) NOT NULL,
        port INTEGER NOT NULL DEFAULT 9030, username VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL DEFAULT '', default_db VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS db_metadata_cache (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        connection_id VARCHAR(255) NOT NULL, db_name VARCHAR(255) NOT NULL,
        table_count INTEGER NOT NULL DEFAULT 0, view_count INTEGER NOT NULL DEFAULT 0,
        mv_count INTEGER NOT NULL DEFAULT 0, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY idx_conn_db (connection_id, db_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS users_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS roles_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS resource_groups_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS catalogs_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS functions_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS variables_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS materialized_views_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS broker_load_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS routine_load_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS pipes_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS tasks_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS task_runs_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS task_runs_all_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE IF NOT EXISTS nodes_cache (connection_id VARCHAR(255) PRIMARY KEY, data LONGTEXT NOT NULL, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS command_log (
        id INTEGER PRIMARY KEY AUTO_INCREMENT, session_id VARCHAR(255) NOT NULL,
        source VARCHAR(255) NOT NULL DEFAULT 'unknown', sql_text TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'success', error_message TEXT,
        row_count INTEGER DEFAULT 0, duration_ms INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cmd_session (session_id, source), INDEX idx_cmd_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS sys_users (
        id INTEGER PRIMARY KEY AUTO_INCREMENT, username VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL, display_name VARCHAR(255) DEFAULT '',
        role VARCHAR(50) NOT NULL DEFAULT 'viewer', is_active TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY AUTO_INCREMENT, name VARCHAR(255) NOT NULL UNIQUE,
        host VARCHAR(255) NOT NULL, port INTEGER NOT NULL DEFAULT 9030,
        username VARCHAR(255) NOT NULL, password VARCHAR(255) NOT NULL DEFAULT '',
        default_db VARCHAR(255) DEFAULT '', description TEXT DEFAULT NULL,
        is_active TINYINT DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS user_cluster_access (
        user_id INTEGER NOT NULL, cluster_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, cluster_id),
        FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE,
        FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS sys_sessions (
        token VARCHAR(255) PRIMARY KEY, user_id INTEGER NOT NULL,
        cluster_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE,
        FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTO_INCREMENT, user_id INTEGER,
        username VARCHAR(255) NOT NULL, action VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'system', level VARCHAR(50) NOT NULL DEFAULT 'basic',
        target VARCHAR(500) DEFAULT '', detail TEXT, ip_address VARCHAR(100) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_al_created (created_at), INDEX idx_al_cat (category), INDEX idx_al_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS sys_role_permissions (
        role VARCHAR(50) NOT NULL, permission VARCHAR(100) NOT NULL,
        granted TINYINT NOT NULL DEFAULT 1, PRIMARY KEY (role, permission)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } else {
    // SQLite: same DDL as before
    await db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 9030, username TEXT NOT NULL,
        password TEXT NOT NULL DEFAULT '', default_db TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS db_metadata_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id TEXT NOT NULL,
        db_name TEXT NOT NULL, table_count INTEGER NOT NULL DEFAULT 0,
        view_count INTEGER NOT NULL DEFAULT 0, mv_count INTEGER NOT NULL DEFAULT 0,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(connection_id, db_name)
      );
      CREATE TABLE IF NOT EXISTS users_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS roles_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS resource_groups_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS catalogs_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS functions_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS variables_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS materialized_views_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS broker_load_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS routine_load_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS pipes_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS tasks_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS task_runs_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS task_runs_all_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS nodes_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS command_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'unknown', sql_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'success', error_message TEXT,
        row_count INTEGER DEFAULT 0, duration_ms INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_command_log_session_source ON command_log(session_id, source);
      CREATE INDEX IF NOT EXISTS idx_command_log_created ON command_log(created_at);
      CREATE TABLE IF NOT EXISTS sys_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, display_name TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'viewer', is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 9030,
        username TEXT NOT NULL, password TEXT NOT NULL DEFAULT '',
        default_db TEXT DEFAULT '', description TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS user_cluster_access (
        user_id INTEGER NOT NULL, cluster_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, cluster_id),
        FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE,
        FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sys_sessions (
        token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        cluster_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE,
        FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
        username TEXT NOT NULL, action TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'system', level TEXT NOT NULL DEFAULT 'basic',
        target TEXT DEFAULT '', detail TEXT DEFAULT '', ip_address TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
      CREATE TABLE IF NOT EXISTS sys_role_permissions (
        role TEXT NOT NULL, permission TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (role, permission)
      );
    `);
  }

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
  await db.run(sql, [key, value, new Date().toISOString().replace('T', ' ').slice(0, 19)]);
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
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

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

export type CacheTable = 'users_cache' | 'roles_cache' | 'resource_groups_cache' | 'catalogs_cache' | 'functions_cache' | 'variables_cache' | 'materialized_views_cache' | 'broker_load_cache' | 'routine_load_cache' | 'pipes_cache' | 'tasks_cache' | 'task_runs_cache' | 'task_runs_all_cache' | 'nodes_cache';

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
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
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

    await db.run(
      'INSERT INTO audit_logs (user_id, username, action, category, level, target, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [params.userId ?? null, params.username, params.action, params.category, params.level, params.target || '', detailStr, params.ipAddress || ''],
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
  if (query.startDate) { conditions.push('created_at >= ?'); values.push(query.startDate); }
  if (query.endDate) { conditions.push('created_at <= ?'); values.push(query.endDate); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`, values);
  const total = countRow?.cnt || 0;
  const logs = await db.all<AuditLogEntry>(
    `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    [...values],
  );

  return { logs, total };
}
