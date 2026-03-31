-- ============================================================
-- V4 — 血缘同步定时调度配置
-- Flyway-style migration: DO NOT MODIFY after first execution.
-- ============================================================

-- 每集群一条记录，存储同步频率 (分钟)
CREATE TABLE IF NOT EXISTS lineage_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL UNIQUE,
  interval_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
