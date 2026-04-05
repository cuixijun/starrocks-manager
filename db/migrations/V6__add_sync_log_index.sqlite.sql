-- ============================================================
-- V6 — Add index on lineage_sync_log.cluster_id (N-7 fix)
-- All sync_log queries filter by cluster_id; without this index
-- queries degrade as the log table grows.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sync_log_cluster
  ON lineage_sync_log(cluster_id);
