-- ============================================================
-- V4 — 血缘同步定时调度配置
-- Flyway-style migration: DO NOT MODIFY after first execution.
-- ============================================================

-- 每集群一条记录，存储同步频率 (分钟)
CREATE TABLE IF NOT EXISTS lineage_schedule (
  id INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  cluster_id INTEGER NOT NULL COMMENT '集群 ID',
  interval_minutes INTEGER NOT NULL DEFAULT 0 COMMENT '同步间隔(分钟), 0=手动',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uk_cluster (cluster_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='血缘同步调度配置';
