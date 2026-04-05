-- ============================================================
-- V7 — Add index on lineage_edges(cluster_id, last_exec_time)
-- M-6 fix: cleanup query DELETE ... WHERE last_exec_time < ?
-- needs this index to avoid full table scan.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_edge_last_exec
  ON lineage_edges(cluster_id, last_exec_time);
