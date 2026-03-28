/**
 * Database adapter — unified ASYNC interface for SQLite and MySQL.
 * All local-db operations call through this adapter.
 */

import path from 'path';
import fs from 'fs';
import { config } from './config';

// ── Types ────────────────────────────────────────────────────────────

export interface RunResult {
  changes: number;
  insertId: number;
}

// ── Adapter Interface ────────────────────────────────────────────────

export interface DbAdapter {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  withTransaction(fn: (db: DbAdapter) => Promise<void>): Promise<void>;
  /** Generate cross-dialect UPSERT SQL */
  upsertSql(table: string, cols: string[], conflictCols: string[], updateCols: string[]): string;
  isMysql: boolean;
}

// ── SQLite Adapter ───────────────────────────────────────────────────

class SqliteAdapter implements DbAdapter {
  isMysql = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor() {
    const DB_PATH = path.isAbsolute(config.database.sqlite.path)
      ? config.database.sqlite.path
      : path.join(process.cwd(), config.database.sqlite.path);
    const DB_DIR = path.dirname(DB_PATH);
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-eval
    const Database = eval('require')('better-sqlite3');
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    console.log(`[DB] SQLite: ${DB_PATH}`);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const info = this.db.prepare(sql).run(...params);
    return { changes: info.changes, insertId: Number(info.lastInsertRowid) };
  }
  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }
  async withTransaction(fn: (db: DbAdapter) => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');
    try {
      await fn(this);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  upsertSql(table: string, cols: string[], conflictCols: string[], updateCols: string[]): string {
    const ph = cols.map(() => '?').join(', ');
    const up = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
    return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT(${conflictCols.join(', ')}) DO UPDATE SET ${up}`;
  }
}

// ── MySQL Adapter ────────────────────────────────────────────────────

class MysqlAdapter implements DbAdapter {
  isMysql = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected pool: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(pool: any) {
    this.pool = pool;
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const [rows] = await this.pool.execute(sql, params);
    return (rows as T[])[0];
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params);
    return rows as T[];
  }
  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result] = await this.pool.execute(sql, params) as any[];
    return { changes: result.affectedRows || 0, insertId: result.insertId || 0 };
  }
  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }
  async withTransaction(fn: (db: DbAdapter) => Promise<void>): Promise<void> {
    const conn = await this.pool.getConnection();
    const txAdapter = new MysqlConnAdapter(conn);
    try {
      await conn.beginTransaction();
      await fn(txAdapter);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  upsertSql(table: string, cols: string[], _conflictCols: string[], updateCols: string[]): string {
    const ph = cols.map(() => '?').join(', ');
    const up = updateCols.map(c => `${c} = VALUES(${c})`).join(', ');
    return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ON DUPLICATE KEY UPDATE ${up}`;
  }
}

class MysqlConnAdapter extends MysqlAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(conn: any) { super(conn); }
  async withTransaction(): Promise<void> { throw new Error('Nested transactions not supported'); }
}

// ── Singleton Factory ────────────────────────────────────────────────

let _dbPromise: Promise<DbAdapter> | null = null;

async function initAdapter(): Promise<DbAdapter> {
  if (config.database.type === 'mysql') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({
      host: config.database.mysql.host,
      port: config.database.mysql.port,
      user: config.database.mysql.user,
      password: config.database.mysql.password,
      database: config.database.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      multipleStatements: true,
      timezone: '+08:00',
      dateStrings: true,
      charset: 'utf8mb4',
    });
    console.log(`[DB] MySQL pool: ${config.database.mysql.host}:${config.database.mysql.port}/${config.database.mysql.database}`);
    return new MysqlAdapter(pool);
  } else {
    return new SqliteAdapter();
  }
}

export function getDb(): Promise<DbAdapter> {
  if (!_dbPromise) {
    _dbPromise = initAdapter();
  }
  return _dbPromise;
}

// ── Timestamp Normalization ──────────────────────────────────────────

/**
 * Normalize a DB timestamp string to an ISO-parseable format.
 * MySQL dateStrings e.g. "2026-03-28 20:23:46" are treated as Asia/Shanghai (+08:00).
 */
export function normalizeTimestamp(ts: string): string {
  if (!ts) return ts;
  // Already qualified with timezone
  if (ts.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(ts)) return ts;
  // Unqualified datetime → treat as Shanghai time
  return ts.replace(' ', 'T') + '+08:00';
}

/**
 * Format a Date as 'YYYY-MM-DD HH:MM:SS' in Asia/Shanghai (UTC+8).
 * Used for INSERT/UPDATE values across both SQLite and MySQL.
 */
export function shanghaiDatetime(d: Date = new Date()): string {
  const ms = d.getTime() + 8 * 3600_000;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
