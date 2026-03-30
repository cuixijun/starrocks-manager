-- ============================================================
-- V2 — 血缘分析元数据表
-- Flyway-style migration: DO NOT MODIFY after first execution.
-- ============================================================

-- 血缘节点 (表/视图)
CREATE TABLE IF NOT EXISTS lineage_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL,
  catalog_name TEXT NOT NULL DEFAULT 'default_catalog',
  db_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'TABLE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cluster_id, catalog_name, db_name, table_name)
);

-- 血缘边 (依赖关系)
CREATE TABLE IF NOT EXISTS lineage_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL,
  source_node_id INTEGER NOT NULL,
  target_node_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL,
  digest TEXT DEFAULT '',
  sample_sql TEXT,
  exec_count INTEGER DEFAULT 1,
  last_exec_time DATETIME,
  users TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_edge ON lineage_edges(cluster_id, source_node_id, target_node_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_edge_source ON lineage_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edge_target ON lineage_edges(target_node_id);

-- 同步记录
CREATE TABLE IF NOT EXISTS lineage_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL,
  sync_time DATETIME NOT NULL,
  digests_found INTEGER DEFAULT 0,
  edges_created INTEGER DEFAULT 0,
  edges_updated INTEGER DEFAULT 0,
  parse_errors INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  error_msg TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
