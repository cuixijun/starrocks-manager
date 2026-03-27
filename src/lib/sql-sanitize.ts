/**
 * SQL Sanitization utilities for DDL/DCL statements.
 *
 * Since DDL/DCL (CREATE USER, GRANT, REVOKE, DROP) cannot use parameterized
 * queries in MySQL/StarRocks, we apply strict validation and escaping instead.
 */

/**
 * Escapes a SQL identifier value (used inside single-quoted strings).
 * Prevents SQL injection by escaping single quotes and backslashes.
 */
export function escapeSqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')     // escape backslashes
    .replace(/'/g, "\\'");       // escape single quotes
}

/**
 * Escapes a SQL backtick-quoted identifier (database name, table name, etc.).
 * Prevents injection by escaping backticks within the value.
 */
export function escapeBacktickId(value: string): string {
  return value.replace(/`/g, '``');
}

/**
 * Validates that a value is a positive integer (for queryId, classifierId, etc.).
 */
export function validateNumeric(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return num;
}

/**
 * Validates a variable name (for SET statements). Only allows safe variable names.
 */
const SAFE_VAR_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateVarName(name: string): string {
  if (!name || !SAFE_VAR_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid variable name: ${name}`);
  }
  return name;
}

/**
 * Validates that a SQL identifier (username, role name, host, database name, etc.)
 * contains only safe characters. Rejects values with semicolons, comments, or
 * other dangerous SQL metacharacters.
 *
 * Allowed: alphanumeric, underscores, hyphens, dots, @, %, spaces
 */
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_\-. @%*(),:\/`']+$/;

export function validateIdentifier(value: string, fieldName: string): string {
  if (!value || value.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  if (value.length > 256) {
    throw new Error(`${fieldName} too long (max 256 chars)`);
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${fieldName} contains invalid characters`);
  }
  // Block SQL injection patterns
  const lower = value.toLowerCase();
  if (lower.includes('--') || lower.includes('/*') || lower.includes('*/') || lower.includes(';')) {
    throw new Error(`${fieldName} contains forbidden SQL patterns`);
  }
  return value;
}

/**
 * Validates a privilege string (e.g. 'SELECT', 'ALL', 'INSERT, UPDATE').
 * Only allows known privilege keywords.
 */
const VALID_PRIVILEGES = new Set([
  'ALL', 'ALL PRIVILEGES',
  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  'ALTER', 'DROP', 'CREATE TABLE', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW',
  'CREATE DATABASE', 'CREATE FUNCTION', 'CREATE GLOBAL FUNCTION',
  'CREATE RESOURCE GROUP', 'CREATE RESOURCE', 'CREATE EXTERNAL CATALOG',
  'USAGE', 'GRANT', 'NODE', 'OPERATE', 'IMPERSONATE',
  'CREATE PIPE', 'CREATE STORAGE VOLUME', 'CREATE ROUTINE LOAD',
  'EXPORT', 'REPOSITORY', 'BLACKLIST', 'FILE',
  'PLUGIN', 'REFRESH',
]);

export function validatePrivilege(privilege: string): string {
  const upper = privilege.trim().toUpperCase();
  // Handle comma-separated privileges like "SELECT, INSERT"
  const parts = upper.split(',').map(p => p.trim());
  for (const part of parts) {
    if (!VALID_PRIVILEGES.has(part)) {
      throw new Error(`Unknown privilege: ${part}`);
    }
  }
  return upper;
}

/**
 * Validates an object type (TABLE, DATABASE, etc.)
 */
const VALID_OBJECT_TYPES = new Set([
  'TABLE', 'DATABASE', 'CATALOG', 'SYSTEM', 'RESOURCE GROUP',
  'RESOURCE', 'USER', 'GLOBAL FUNCTION', 'FUNCTION',
  'MATERIALIZED VIEW', 'VIEW', 'PIPE', 'STORAGE VOLUME',
  'ALL TABLES IN DATABASE', 'ALL TABLES IN ALL DATABASES',
  'ALL DATABASES', 'ALL MATERIALIZED VIEWS IN DATABASE',
  'ALL FUNCTIONS IN DATABASE', 'ALL FUNCTIONS IN ALL DATABASES',
  'ALL MATERIALIZED VIEWS IN ALL DATABASES',
  'ALL VIEWS IN DATABASE', 'ALL VIEWS IN ALL DATABASES',
]);

export function validateObjectType(objectType: string): string {
  const upper = objectType.trim().toUpperCase();
  if (!VALID_OBJECT_TYPES.has(upper)) {
    throw new Error(`Unknown object type: ${objectType}`);
  }
  return upper;
}
