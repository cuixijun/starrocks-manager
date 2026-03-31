/**
 * SQL Lineage Parser — extracts table-level lineage from non-query SQL statements.
 *
 * Supports: INSERT INTO ... SELECT, CREATE TABLE AS SELECT, CREATE VIEW AS SELECT
 * Falls back to regex extraction when AST parsing fails.
 */

import { Parser } from 'node-sql-parser';

export interface TableRef {
  catalog: string;
  db: string;
  table: string;
}

export interface LineageResult {
  sources: TableRef[];
  targets: TableRef[];
  relationType: 'INSERT_SELECT' | 'CTAS' | 'VIEW' | 'QUERY' | 'UNKNOWN';
  parsed: boolean; // true = AST, false = regex fallback
}

const parser = new Parser();

/**
 * Resolve 1/2/3-part identifier to TableRef.
 * 3 parts: catalog.db.table
 * 2 parts: db.table      (catalog = default_catalog)
 * 1 part:  table          (catalog = default_catalog, db = defaultDb)
 */
function resolveIdentifier(
  parts: (string | undefined)[],
  defaultDb: string,
): TableRef {
  // Filter out undefined
  const p = parts.filter(Boolean) as string[];
  if (p.length >= 3) {
    return { catalog: p[0], db: p[1], table: p[2] };
  }
  if (p.length === 2) {
    return { catalog: 'default_catalog', db: p[0], table: p[1] };
  }
  return { catalog: 'default_catalog', db: defaultDb, table: p[0] || '' };
}

/**
 * Parse a single SQL statement and extract table-level lineage.
 * @param sql The SQL text
 * @param defaultDb The default database context from the audit log
 */
export function parseLineage(sql: string, defaultDb: string): LineageResult | null {
  // Normalize
  let trimmed = sql.trim().replace(/;$/, '');
  if (!trimmed) return null;

  // Normalize StarRocks-specific syntax for parser compatibility
  // INSERT OVERWRITE → INSERT INTO (StarRocks extension)
  trimmed = trimmed.replace(/INSERT\s+OVERWRITE\b/i, 'INSERT INTO');

  // Determine relation type from SQL text
  const upper = trimmed.toUpperCase();
  let relationType: LineageResult['relationType'] = 'UNKNOWN';

  if (upper.startsWith('INSERT ')) {
    relationType = 'INSERT_SELECT';
  } else if (upper.startsWith('CREATE ') && upper.includes(' TABLE ') && upper.includes(' AS ')) {
    relationType = 'CTAS';
  } else if (upper.startsWith('CREATE ') && upper.includes(' VIEW ') && upper.includes(' AS ')) {
    relationType = 'VIEW';
  } else if (upper.startsWith('WITH ') || upper.startsWith('WITH\t') || upper.startsWith('WITH\n')) {
    // CTE: WITH ... INSERT INTO / WITH ... SELECT (treat as INSERT_SELECT if contains INSERT)
    if (upper.includes('INSERT ')) {
      relationType = 'INSERT_SELECT';
    } else {
      // WITH ... SELECT only — no lineage target
      return null;
    }
  } else {
    // Not a lineage-relevant SQL
    return null;
  }

  // Try AST parsing
  try {
    const result = parseWithAST(trimmed, defaultDb, relationType);
    if (result && result.targets.length > 0) {
      return result;
    }
  } catch {
    // AST failed, fall through to regex
  }

  // Regex fallback
  try {
    const result = parseWithRegex(trimmed, defaultDb, relationType);
    if (result && result.targets.length > 0) {
      return result;
    }
  } catch {
    // Both methods failed
  }

  return null;
}

/* ── AST parsing ──────────────────────────────────────────── */

function parseWithAST(
  sql: string,
  defaultDb: string,
  relationType: LineageResult['relationType'],
): LineageResult | null {
  // node-sql-parser uses MySQL dialect which is close to StarRocks
  const ast = parser.astify(sql, { database: 'mysql' });

  const targets: TableRef[] = [];
  const sources: TableRef[] = [];

  const stmts = Array.isArray(ast) ? ast : [ast];

  for (const stmt of stmts) {
    if (!stmt) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = stmt as any;

    // INSERT INTO ... SELECT
    if (s.type === 'insert') {
      // Target table
      if (s.table) {
        const tables = Array.isArray(s.table) ? s.table : [s.table];
        for (const t of tables) {
          if (t.table) {
            targets.push(resolveIdentifier([t.schema, t.db, t.table].filter(Boolean), defaultDb));
          }
        }
      }
      // Source tables from the SELECT clause
      if (s.values || s.set) {
        // Simple INSERT with VALUES — no lineage
        continue;
      }
      // The select part contains source tables in `from`, `join`, etc.
      collectSourceTables(s, sources, defaultDb);
    }

    // CREATE TABLE / CREATE VIEW
    if (s.type === 'create') {
      // Target
      if (s.table) {
        const tables = Array.isArray(s.table) ? s.table : [s.table];
        for (const t of tables) {
          if (t.table) {
            targets.push(resolveIdentifier([t.schema, t.db, t.table].filter(Boolean), defaultDb));
          }
        }
      }
      // Source tables from AS SELECT
      if (s.query) {
        collectSourceTables(s.query, sources, defaultDb);
      }
    }
  }

  if (targets.length === 0) return null;

  return {
    sources: dedup(sources),
    targets: dedup(targets),
    relationType,
    parsed: true,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectSourceTables(node: any, sources: TableRef[], defaultDb: string) {
  if (!node || typeof node !== 'object') return;

  // Direct table reference in FROM clause
  if (node.from) {
    const fromList = Array.isArray(node.from) ? node.from : [node.from];
    for (const f of fromList) {
      if (f.table) {
        sources.push(resolveIdentifier([f.schema, f.db, f.table].filter(Boolean), defaultDb));
      }
      // Subquery in FROM
      if (f.expr && f.expr.ast) {
        collectSourceTables(f.expr.ast, sources, defaultDb);
      }
    }
  }

  // JOIN clauses
  if (node.join) {
    // node-sql-parser merges joins into `from` for most cases
  }

  // Subqueries in WHERE, HAVING, etc.
  if (node.where) collectSourceTables(node.where, sources, defaultDb);
  if (node.having) collectSourceTables(node.having, sources, defaultDb);

  // UNION / subselects
  if (node._next) collectSourceTables(node._next, sources, defaultDb);

  // CTE (WITH clause)
  if (node.with) {
    const withList = Array.isArray(node.with) ? node.with : [node.with];
    for (const w of withList) {
      if (w.stmt && w.stmt.ast) {
        collectSourceTables(w.stmt.ast, sources, defaultDb);
      }
    }
  }

  // Nested SELECT expr
  if (node.type === 'select') {
    if (node.from) {
      const fromList = Array.isArray(node.from) ? node.from : [node.from];
      for (const f of fromList) {
        if (f.table) {
          sources.push(resolveIdentifier([f.schema, f.db, f.table].filter(Boolean), defaultDb));
        }
        if (f.expr && f.expr.ast) {
          collectSourceTables(f.expr.ast, sources, defaultDb);
        }
      }
    }
  }

  // Recurse into left/right for binary expressions
  if (node.left) collectSourceTables(node.left, sources, defaultDb);
  if (node.right) collectSourceTables(node.right, sources, defaultDb);
}

/* ── Regex fallback ───────────────────────────────────────── */

function parseWithRegex(
  sql: string,
  defaultDb: string,
  relationType: LineageResult['relationType'],
): LineageResult | null {
  const sources: TableRef[] = [];
  const targets: TableRef[] = [];

  if (relationType === 'INSERT_SELECT') {
    // Handle: INSERT INTO/OVERWRITE [catalog.][db.]`table`
    // Supports 1, 2, or 3-part identifiers
    const insertMatch = sql.match(
      /INSERT\s+(?:INTO|OVERWRITE)\s+`?(\w+)`?(?:\s*\.\s*`?(\w+)`?)?(?:\s*\.\s*`?(\w+)`?)?/i
    );
    if (insertMatch) {
      const [, p1, p2, p3] = insertMatch;
      targets.push(resolveIdentifier([p1, p2, p3], defaultDb));
    }
    const cteNames = collectCTENames(sql);
    extractFromTables(sql, sources, defaultDb, cteNames);
  }

  if (relationType === 'CTAS') {
    const ctasMatch = sql.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?(?:\s*\.\s*`?(\w+)`?)?(?:\s*\.\s*`?(\w+)`?)?/i
    );
    if (ctasMatch) {
      const [, p1, p2, p3] = ctasMatch;
      targets.push(resolveIdentifier([p1, p2, p3], defaultDb));
    }
    extractFromTables(sql, sources, defaultDb);
  }

  if (relationType === 'VIEW') {
    const viewMatch = sql.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?(\w+)`?(?:\s*\.\s*`?(\w+)`?)?(?:\s*\.\s*`?(\w+)`?)?/i
    );
    if (viewMatch) {
      const [, p1, p2, p3] = viewMatch;
      targets.push(resolveIdentifier([p1, p2, p3], defaultDb));
    }
    extractFromTables(sql, sources, defaultDb);
  }

  // Allow partial lineage: targets with no sources is still useful metadata
  if (targets.length === 0) return null;

  return {
    sources: dedup(sources),
    targets: dedup(targets),
    relationType,
    parsed: false,
  };
}

/**
 * Extract table names from FROM / JOIN clauses using regex.
 * Optionally excludes CTE names from the source tables.
 */
function extractFromTables(sql: string, sources: TableRef[], defaultDb: string, cteNames?: Set<string>) {
  // Match FROM/JOIN with 1, 2, or 3-part identifiers: [catalog.][db.]table
  const pattern = /(?:FROM|JOIN)\s+`?(\w+)`?(?:\s*\.\s*`?(\w+)`?)?(?:\s*\.\s*`?(\w+)`?)?(?:\s+(?:AS\s+)?`?\w+`?)?/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const [, p1, p2, p3] = match;
    // Skip SQL keywords that may be confused as table names
    const skipWords = new Set(['SELECT', 'WHERE', 'SET', 'VALUES', 'DUAL', 'INFORMATION_SCHEMA', 'LATERAL']);
    const tableName = p3 || p2 || p1;
    if (skipWords.has(tableName.toUpperCase())) continue;
    if (skipWords.has(p1.toUpperCase())) continue;
    // Skip CTE aliases — they are not real tables
    if (cteNames && cteNames.has(p1.toLowerCase())) continue;
    if (cteNames && !p2 && cteNames.has(tableName.toLowerCase())) continue;

    sources.push(resolveIdentifier([p1, p2, p3], defaultDb));
  }
}

/**
 * Extract CTE (Common Table Expression) names from a WITH clause.
 * e.g. "WITH t0 (...) AS (...), t1 (...) AS (...)" → { "t0", "t1" }
 */
function collectCTENames(sql: string): Set<string> {
  const names = new Set<string>();
  // Match WITH clause: WITH `name` (cols) AS (...)
  const withMatch = sql.match(/\bWITH\s+/i);
  if (!withMatch) return names;

  // Extract CTE names: pattern is `name` followed by ( or AS
  const afterWith = sql.substring((withMatch.index || 0) + withMatch[0].length);
  const ctePattern = /`?(\w+)`?\s*(?:\(|AS\b)/gi;
  let m;
  while ((m = ctePattern.exec(afterWith)) !== null) {
    const name = m[1].toLowerCase();
    // Stop if we hit the main SELECT/INSERT
    if (name === 'select' || name === 'insert') break;
    names.add(name);
    // Skip to next comma-separated CTE (find the next top-level comma or SELECT)
  }
  return names;
}

/* ── Helpers ──────────────────────────────────────────────── */

function dedup(refs: TableRef[]): TableRef[] {
  const seen = new Set<string>();
  return refs.filter(r => {
    const key = `${r.catalog}.${r.db}.${r.table}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Query SQL parsing (SELECT statements) ───────────────── */

/** System databases — tables from these DBs are excluded from query source lineage */
const SYSTEM_DB_SET = new Set([
  'information_schema', 'starrocks_audit_db__', '_statistics_',
  'sys', 'mysql', 'performance_schema', 'starrocks_monitor',
]);

/**
 * Parse a SELECT SQL statement and extract all referenced source tables.
 * Used for building query-type lineage nodes.
 * Filters out system database tables from the results.
 * @param sql The SELECT SQL text
 * @param defaultDb The default database context from the audit log
 * @returns Array of source TableRef (excluding system tables), or null if none found
 */
export function parseQuerySources(sql: string, defaultDb: string): TableRef[] | null {
  let trimmed = sql.trim().replace(/;$/, '');
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  // Must be a SELECT or WITH...SELECT (CTE)
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) return null;
  // Exclude WITH...INSERT (handled by non-query parser)
  if (upper.startsWith('WITH') && upper.includes('INSERT ')) return null;

  const sources: TableRef[] = [];

  // Try AST parsing first
  try {
    const ast = parser.astify(trimmed, { database: 'mysql' });
    const stmts = Array.isArray(ast) ? ast : [ast];
    for (const stmt of stmts) {
      if (!stmt) continue;
      collectSourceTables(stmt, sources, defaultDb);
    }
    if (sources.length > 0) {
      const filtered = filterSystemTables(dedup(sources));
      return filtered.length > 0 ? filtered : null;
    }
  } catch {
    // AST failed, fall through to regex
  }

  // Regex fallback
  try {
    const cteNames = collectCTENames(trimmed);
    extractFromTables(trimmed, sources, defaultDb, cteNames);
    if (sources.length > 0) {
      const filtered = filterSystemTables(dedup(sources));
      return filtered.length > 0 ? filtered : null;
    }
  } catch {
    // Both methods failed
  }

  return null;
}

/** Remove tables that belong to system databases */
function filterSystemTables(refs: TableRef[]): TableRef[] {
  return refs.filter(r => !SYSTEM_DB_SET.has(r.db.toLowerCase()));
}

