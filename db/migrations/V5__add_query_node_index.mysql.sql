-- ============================================================
-- V5 — Add index for query node lookups (L-4 fix)
-- upsertQueryNode queries (cluster_id, db_name, table_name, node_type)
-- which doesn't match the existing UNIQUE(cluster_id, catalog_name, db_name, table_name)
-- ============================================================

CREATE INDEX idx_nodes_query_lookup
  ON lineage_nodes(cluster_id, db_name, table_name, node_type);
