import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'starrocks-tools.db');

let db: Database.Database | null = null;

export function getLocalDb(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

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

    -- Nodes cache
    CREATE TABLE IF NOT EXISTS nodes_cache (
      connection_id TEXT PRIMARY KEY,
      data          TEXT NOT NULL,
      cached_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

// ---- Connection CRUD ----

export interface SavedConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  default_db: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export function listConnections(): SavedConnection[] {
  const db = getLocalDb();
  return db.prepare('SELECT * FROM connections ORDER BY last_used_at DESC, updated_at DESC').all() as SavedConnection[];
}

export function getConnection(id: number): SavedConnection | undefined {
  const db = getLocalDb();
  return db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as SavedConnection | undefined;
}

export function createConnection(conn: Omit<SavedConnection, 'id' | 'created_at' | 'updated_at' | 'last_used_at'>): SavedConnection {
  const db = getLocalDb();
  const stmt = db.prepare(
    'INSERT INTO connections (name, host, port, username, password, default_db) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(conn.name, conn.host, conn.port, conn.username, conn.password, conn.default_db || '');
  return getConnection(result.lastInsertRowid as number)!;
}

export function updateConnection(id: number, conn: Partial<Omit<SavedConnection, 'id' | 'created_at' | 'updated_at'>>): SavedConnection | undefined {
  const db = getLocalDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (conn.name !== undefined) { fields.push('name = ?'); values.push(conn.name); }
  if (conn.host !== undefined) { fields.push('host = ?'); values.push(conn.host); }
  if (conn.port !== undefined) { fields.push('port = ?'); values.push(conn.port); }
  if (conn.username !== undefined) { fields.push('username = ?'); values.push(conn.username); }
  if (conn.password !== undefined) { fields.push('password = ?'); values.push(conn.password); }
  if (conn.default_db !== undefined) { fields.push('default_db = ?'); values.push(conn.default_db); }

  if (fields.length === 0) return getConnection(id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  db.prepare(`UPDATE connections SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getConnection(id);
}

export function deleteConnection(id: number): boolean {
  const db = getLocalDb();
  const result = db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  return result.changes > 0;
}

export function touchConnection(id: number): void {
  const db = getLocalDb();
  db.prepare('UPDATE connections SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
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

export interface DbCacheEntry {
  id: number;
  connection_id: string;
  db_name: string;
  table_count: number;
  view_count: number;
  mv_count: number;
  cached_at: string;
}

export function getDbCache(connectionId: string): DbCacheEntry[] {
  const db = getLocalDb();
  return db
    .prepare('SELECT * FROM db_metadata_cache WHERE connection_id = ? ORDER BY db_name ASC')
    .all(connectionId)
    .map((r) => {
      const row = r as DbCacheEntry;
      // SQLite CURRENT_TIMESTAMP is UTC — normalize to ISO 8601 with Z suffix
      const cachedAt = row.cached_at.endsWith('Z') ? row.cached_at : row.cached_at.replace(' ', 'T') + 'Z';
      return { ...row, cached_at: cachedAt };
    }) as DbCacheEntry[];
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

type CacheTable = 'users_cache' | 'roles_cache' | 'resource_groups_cache' | 'catalogs_cache' | 'functions_cache' | 'variables_cache' | 'materialized_views_cache' | 'broker_load_cache' | 'routine_load_cache' | 'pipes_cache' | 'tasks_cache' | 'nodes_cache';

export function getBlobCache(table: CacheTable, connectionId: string): { data: unknown; cachedAt: string } | null {
  const db = getLocalDb();
  const row = db.prepare(`SELECT data, cached_at FROM ${table} WHERE connection_id = ?`).get(connectionId) as BlobCacheRow | undefined;
  if (!row) return null;
  try {
    // SQLite CURRENT_TIMESTAMP is UTC but has no 'Z' suffix — append it so JS parses as UTC
    const cachedAt = row.cached_at.endsWith('Z') ? row.cached_at : row.cached_at.replace(' ', 'T') + 'Z';
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
