/**
 * Classify GRANT statements into structured categories for display.
 *
 * Categories:
 *   - system:   OPERATE ON SYSTEM, NODE, WAREHOUSE, RESOURCE GROUP
 *   - ddl:      CREATE, ALTER, DROP, REFRESH on any object
 *   - dml:      SELECT, INSERT, UPDATE, DELETE, EXPORT
 *   - function: anything targeting FUNCTION / GLOBAL FUNCTIONS
 *   - catalog:  USAGE on CATALOG / ALL CATALOGS (internal scope)
 *   - other:    anything that doesn't match
 *
 * Scope: internal (default_catalog) vs external (named catalog).
 * USAGE ON CATALOG is always internal regardless of catalog name.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParsedPrivilege {
  privilege: string;   // e.g. "SELECT, INSERT"
  target: string;      // e.g. "ALL TABLES IN DATABASE bigdata"
  raw: string;         // original GRANT string
}

export type PrivCategory = 'system' | 'ddl' | 'dml' | 'function' | 'catalog' | 'other';

export interface CategorisedGroup {
  category: PrivCategory;
  label: string;
  color: string;        // CSS color token
  bgColor: string;      // light bg
  borderColor: string;
  icon: string;         // lucide icon name hint
  items: ParsedPrivilege[];
  sectionId: string;    // unique id for scroll-to navigation
}

export interface CatalogGroup {
  catalogName: string;
  isInternal: boolean;
  categories: CategorisedGroup[];
  totalCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DDL_KEYWORDS = new Set([
  'CREATE', 'ALTER', 'DROP', 'REFRESH', 'CREATE TABLE', 'CREATE VIEW',
  'CREATE DATABASE', 'CREATE MATERIALIZED VIEW', 'CREATE WAREHOUSE',
]);

const DML_KEYWORDS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXPORT',
]);

const SYSTEM_KEYWORDS = new Set([
  'OPERATE', 'NODE', 'CREATE WAREHOUSE', 'REPOSITORY',
]);

const CATEGORY_META: Record<PrivCategory, { label: string; color: string; bgColor: string; borderColor: string; icon: string }> = {
  system:   { label: '系统权限', color: 'var(--accent-600)',   bgColor: 'rgba(139,92,246,0.08)',  borderColor: 'rgba(139,92,246,0.2)',  icon: 'Shield' },
  ddl:      { label: 'DDL 权限', color: 'var(--warning-600)',  bgColor: 'rgba(234,179,8,0.08)',   borderColor: 'rgba(234,179,8,0.2)',   icon: 'Wrench' },
  dml:      { label: 'DML 权限', color: 'var(--success-600)',  bgColor: 'rgba(22,163,74,0.08)',   borderColor: 'rgba(22,163,74,0.2)',   icon: 'Database' },
  function: { label: '函数权限', color: 'var(--info-600, #0284c7)', bgColor: 'rgba(2,132,199,0.08)', borderColor: 'rgba(2,132,199,0.2)', icon: 'Code' },
  catalog:  { label: 'Catalog 权限', color: 'var(--primary-600)', bgColor: 'rgba(37,99,235,0.08)', borderColor: 'rgba(37,99,235,0.2)', icon: 'FolderOpen' },
  other:    { label: '其他权限', color: 'var(--text-secondary)', bgColor: 'var(--bg-secondary)',    borderColor: 'var(--border-secondary)', icon: 'MoreHorizontal' },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function parseGrant(raw: string): ParsedPrivilege | null {
  const m = raw.match(/GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i);
  if (!m) return null;
  return { privilege: m[1].trim(), target: m[2].trim(), raw };
}

function classifyPrivilege(priv: ParsedPrivilege): PrivCategory {
  const { privilege, target } = priv;
  const privUpper = privilege.toUpperCase();
  const targetUpper = target.toUpperCase();

  // System: ON SYSTEM / NODE / WAREHOUSE (without table context)
  if (targetUpper === 'SYSTEM' || targetUpper.includes('WAREHOUSE') || targetUpper.includes('RESOURCE GROUP')) {
    return 'system';
  }
  if (privUpper.includes('NODE') || privUpper.includes('OPERATE')) {
    return 'system';
  }

  // Function
  if (targetUpper.includes('FUNCTION')) {
    return 'function';
  }

  // Catalog-level: USAGE/CREATE DATABASE/DROP/ALTER on CATALOG xxx or ALL CATALOGS
  if (targetUpper.startsWith('CATALOG ') || targetUpper === 'ALL CATALOGS') {
    return 'catalog';
  }

  // Mixed privileges: split and check majority
  const privTokens = privUpper.split(/,\s*/).map(t => t.trim());

  const hasDDL = privTokens.some(t => DDL_KEYWORDS.has(t));
  const hasDML = privTokens.some(t => DML_KEYWORDS.has(t));

  // If purely DML
  if (hasDML && !hasDDL) return 'dml';
  // If purely DDL
  if (hasDDL && !hasDML) return 'ddl';
  // Mixed: classify as DML+DDL → use 'dml' as primary (more common)
  if (hasDML && hasDDL) return 'dml';

  return 'other';
}

/**
 * Extract catalog name from target string.
 * USAGE ON CATALOG is always internal, regardless of catalog name.
 * E.g. "ALL TABLES IN DATABASE bigdata" → "default_catalog" (internal)
 *      "CATALOG hive_catalog" → "default_catalog" (USAGE is internal)
 *      "ALL CATALOGS" → "default_catalog" (internal)
 */
function extractCatalog(target: string, category: PrivCategory): string {
  const upper = target.toUpperCase();
  // USAGE ON CATALOG is always internal scope
  if (category === 'catalog') return 'default_catalog';
  // SYSTEM, FUNCTION etc. → internal
  if (upper === 'SYSTEM' || upper.includes('FUNCTION') || upper.includes('WAREHOUSE') || upper.includes('RESOURCE GROUP')) {
    return 'default_catalog';
  }
  // Check for "IN CATALOG xxx" pattern (rare)
  const inCat = target.match(/IN\s+CATALOG\s+['`]?([^'`\s;]+)['`]?/i);
  if (inCat) return inCat[1];
  // Default: internal
  return 'default_catalog';
}

// ── Main API ───────────────────────────────────────────────────────────

export interface CatalogGrant {
  grant: string;
  catalog: string;
}

export function classifyGrants(grants: string[], catalogGrants?: CatalogGrant[]): CatalogGroup[] {
  // Build a lookup: grant string → catalog name (from API)
  const catalogLookup = new Map<string, string>();
  if (catalogGrants) {
    for (const cg of catalogGrants) {
      catalogLookup.set(cg.grant, cg.catalog);
    }
  }

  // Parse all grants
  const parsed: { priv: ParsedPrivilege; category: PrivCategory; catalog: string }[] = [];

  for (const raw of grants) {
    const priv = parseGrant(raw);
    if (!priv) {
      parsed.push({
        priv: { privilege: '', target: '', raw },
        category: 'other',
        catalog: catalogLookup.get(raw) || 'default_catalog',
      });
      continue;
    }
    const category = classifyPrivilege(priv);
    // Use API-provided catalog if available; otherwise infer from target
    const catalog = catalogLookup.get(raw) || extractCatalog(priv.target, category);
    parsed.push({ priv, category, catalog });
  }

  // Group by catalog
  const byCatalog = new Map<string, typeof parsed>();
  for (const item of parsed) {
    const key = item.catalog;
    if (!byCatalog.has(key)) byCatalog.set(key, []);
    byCatalog.get(key)!.push(item);
  }

  // Convert to CatalogGroup[]
  const result: CatalogGroup[] = [];
  const ORDER: PrivCategory[] = ['system', 'ddl', 'dml', 'function', 'catalog', 'other'];

  for (const [catName, items] of byCatalog) {
    // Group by category within this catalog
    const byCategory = new Map<PrivCategory, ParsedPrivilege[]>();
    for (const item of items) {
      if (!byCategory.has(item.category)) byCategory.set(item.category, []);
      byCategory.get(item.category)!.push(item.priv);
    }

    const categories: CategorisedGroup[] = [];
    for (const cat of ORDER) {
      const catItems = byCategory.get(cat);
      if (!catItems || catItems.length === 0) continue;
      const meta = CATEGORY_META[cat];
      // Unique section id for scroll-to navigation
      const sectionId = `priv-${catName}-${cat}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      categories.push({ category: cat, items: catItems, sectionId, ...meta });
    }

    result.push({
      catalogName: catName,
      isInternal: catName === 'default_catalog',
      categories,
      totalCount: items.length,
    });
  }

  // Sort: internal first, then external alphabetically
  result.sort((a, b) => {
    if (a.catalogName === 'default_catalog') return -1;
    if (b.catalogName === 'default_catalog') return 1;
    return a.catalogName.localeCompare(b.catalogName);
  });

  return result;
}

export { CATEGORY_META };
