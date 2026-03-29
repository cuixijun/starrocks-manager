/**
 * Flyway-style Database Migration Engine
 *
 * Naming convention: V{version}__{description}.{mysql|sqlite}.sql
 * Example: V1__init_schema.mysql.sql, V2__add_audit_logs.sqlite.sql
 *
 * Features:
 *   - schema_history table tracking applied migrations
 *   - SHA-256 checksum verification (tamper detection)
 *   - Auto-migration on application startup
 *   - Dual dialect support (MySQL / SQLite)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { DbAdapter } from './db-adapter';

// ── Types ────────────────────────────────────────────────────────────

interface MigrationFile {
  version: number;
  description: string;
  dialect: 'mysql' | 'sqlite';
  filename: string;
  filepath: string;
  checksum: string;
  sql: string;
}

interface SchemaHistoryRow {
  installed_rank: number;
  version: number;
  description: string;
  script: string;
  checksum: string;
  installed_by: string;
  installed_on: string;
  execution_time: number;
  success: number;
}

// ── Constants ────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');
const MIGRATION_FILE_REGEX = /^V(\d+)__(.+)\.(mysql|sqlite)\.sql$/;

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Compute SHA-256 checksum of file content.
 */
function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Scan the migrations directory and parse matching files for the given dialect.
 */
function scanMigrations(dialect: 'mysql' | 'sqlite'): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`[Migrator] Migrations directory not found: ${MIGRATIONS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).sort();
  const migrations: MigrationFile[] = [];

  for (const filename of files) {
    const match = filename.match(MIGRATION_FILE_REGEX);
    if (!match) continue;

    const [, versionStr, description, fileDialect] = match;
    if (fileDialect !== dialect) continue;

    const filepath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filepath, 'utf8');
    const checksum = computeChecksum(sql);

    migrations.push({
      version: parseInt(versionStr, 10),
      description: description.replace(/_/g, ' '),
      dialect: fileDialect as 'mysql' | 'sqlite',
      filename,
      filepath,
      checksum,
      sql,
    });
  }

  // Sort by version ascending
  migrations.sort((a, b) => a.version - b.version);

  // Validate no duplicate versions
  const versions = new Set<number>();
  for (const m of migrations) {
    if (versions.has(m.version)) {
      throw new Error(`[Migrator] Duplicate migration version V${m.version} for dialect ${dialect}`);
    }
    versions.add(m.version);
  }

  return migrations;
}

/**
 * Ensure the schema_history table exists.
 */
async function ensureSchemaHistoryTable(db: DbAdapter): Promise<void> {
  if (db.isMysql) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_history (
        installed_rank INTEGER PRIMARY KEY AUTO_INCREMENT,
        version        INTEGER NOT NULL,
        description    VARCHAR(200) NOT NULL,
        script         VARCHAR(200) NOT NULL,
        checksum       VARCHAR(64),
        installed_by   VARCHAR(100) DEFAULT 'app',
        installed_on   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        execution_time INTEGER NOT NULL DEFAULT 0,
        success        TINYINT NOT NULL DEFAULT 1,
        UNIQUE KEY idx_version (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库迁移版本历史(Flyway模式)';
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_history (
        installed_rank INTEGER PRIMARY KEY AUTOINCREMENT,
        version        INTEGER NOT NULL UNIQUE,
        description    TEXT NOT NULL,
        script         TEXT NOT NULL,
        checksum       TEXT,
        installed_by   TEXT DEFAULT 'app',
        installed_on   DATETIME DEFAULT CURRENT_TIMESTAMP,
        execution_time INTEGER NOT NULL DEFAULT 0,
        success        INTEGER NOT NULL DEFAULT 1
      );
    `);
  }
}

/**
 * Get all applied migration records from schema_history.
 */
async function getAppliedMigrations(db: DbAdapter): Promise<SchemaHistoryRow[]> {
  return db.all<SchemaHistoryRow>('SELECT * FROM schema_history WHERE success = 1 ORDER BY version ASC');
}

/**
 * Validate checksums of already-applied migrations against current files.
 * Throws if a previously applied migration file has been modified.
 */
function validateChecksums(applied: SchemaHistoryRow[], pending: MigrationFile[]): void {
  const fileMap = new Map(pending.map(m => [m.version, m]));

  for (const row of applied) {
    const file = fileMap.get(row.version);
    if (!file) {
      // Migration file was deleted — warn but don't block
      console.warn(`[Migrator] ⚠ Applied migration V${row.version} (${row.script}) no longer exists on disk`);
      continue;
    }
    if (file.checksum !== row.checksum) {
      throw new Error(
        `[Migrator] ❌ Checksum mismatch for V${row.version} (${row.script})!\n` +
        `  Expected: ${row.checksum}\n` +
        `  Actual:   ${file.checksum}\n` +
        `  已执行的迁移文件不可修改。如需变更，请创建新的迁移版本。`
      );
    }
  }
}

/**
 * Run all pending migrations.
 * This is the main entry point called on application startup.
 */
export async function runMigrations(db: DbAdapter): Promise<void> {
  const dialect: 'mysql' | 'sqlite' = db.isMysql ? 'mysql' : 'sqlite';

  console.log(`[Migrator] Starting migration check (dialect=${dialect})...`);

  // 1. Ensure schema_history table
  await ensureSchemaHistoryTable(db);

  // 2. Scan migration files
  const allMigrations = scanMigrations(dialect);
  if (allMigrations.length === 0) {
    console.log('[Migrator] No migration files found.');
    return;
  }

  // 3. Get applied migrations
  const applied = await getAppliedMigrations(db);
  const appliedVersions = new Set(applied.map(r => r.version));

  // 4. Validate checksums of applied migrations
  validateChecksums(applied, allMigrations);

  // 5. Filter pending migrations
  const pending = allMigrations.filter(m => !appliedVersions.has(m.version));

  if (pending.length === 0) {
    console.log(`[Migrator] Schema is up to date (current version: V${Math.max(...appliedVersions, 0)})`);
    return;
  }

  console.log(`[Migrator] Found ${pending.length} pending migration(s): ${pending.map(m => `V${m.version}`).join(', ')}`);

  // 6. Execute pending migrations in order
  for (const migration of pending) {
    const startTime = Date.now();
    console.log(`[Migrator] Applying V${migration.version}__${migration.description} ...`);

    try {
      // Execute the migration SQL
      // Note: For init migrations with many CREATE TABLE statements,
      // we use exec() which supports multiple statements.
      await db.exec(migration.sql);

      const executionTime = Date.now() - startTime;

      // Record success
      await db.run(
        'INSERT INTO schema_history (version, description, script, checksum, installed_by, execution_time, success) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [migration.version, migration.description, migration.filename, migration.checksum, 'app', executionTime, 1],
      );

      console.log(`[Migrator] ✅ V${migration.version} applied successfully (${executionTime}ms)`);
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Try to record failure (best effort)
      try {
        await db.run(
          'INSERT INTO schema_history (version, description, script, checksum, installed_by, execution_time, success) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [migration.version, migration.description, migration.filename, migration.checksum, 'app', executionTime, 0],
        );
      } catch { /* ignore logging failure */ }

      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[Migrator] ❌ Migration V${migration.version} failed: ${msg}\n` +
        `  Script: ${migration.filename}\n` +
        `  请修复问题后重启应用。`
      );
    }
  }

  console.log(`[Migrator] All migrations applied. Current version: V${pending[pending.length - 1].version}`);
}

/**
 * Get migration info (similar to `flyway info`).
 * Returns the status of all discovered and applied migrations.
 */
export async function getMigrationInfo(db: DbAdapter): Promise<{
  current: number;
  applied: { version: number; description: string; script: string; installedOn: string; executionTime: number }[];
  pending: { version: number; description: string; script: string }[];
}> {
  const dialect: 'mysql' | 'sqlite' = db.isMysql ? 'mysql' : 'sqlite';

  await ensureSchemaHistoryTable(db);

  const allMigrations = scanMigrations(dialect);
  const appliedRows = await getAppliedMigrations(db);
  const appliedVersions = new Set(appliedRows.map(r => r.version));

  const applied = appliedRows.map(r => ({
    version: r.version,
    description: r.description,
    script: r.script,
    installedOn: r.installed_on,
    executionTime: r.execution_time,
  }));

  const pending = allMigrations
    .filter(m => !appliedVersions.has(m.version))
    .map(m => ({ version: m.version, description: m.description, script: m.filename }));

  const current = appliedRows.length > 0 ? Math.max(...appliedRows.map(r => r.version)) : 0;

  return { current, applied, pending };
}

/**
 * Validate migration checksums (similar to `flyway validate`).
 * Returns true if all checksums match, throws on mismatch.
 */
export async function validateMigrations(db: DbAdapter): Promise<boolean> {
  const dialect: 'mysql' | 'sqlite' = db.isMysql ? 'mysql' : 'sqlite';

  await ensureSchemaHistoryTable(db);

  const allMigrations = scanMigrations(dialect);
  const applied = await getAppliedMigrations(db);

  validateChecksums(applied, allMigrations);
  console.log('[Migrator] ✅ All migration checksums valid.');
  return true;
}
