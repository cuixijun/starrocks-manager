-- ============================================================
-- V2 — 血缘分析元数据表
-- Flyway-style migration: DO NOT MODIFY after first execution.
-- ============================================================

-- 血缘节点 (表/视图)
CREATE TABLE IF NOT EXISTS lineage_nodes (
  id INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  cluster_id INTEGER NOT NULL COMMENT '关联集群 ID',
  catalog_name VARCHAR(128) NOT NULL DEFAULT 'default_catalog' COMMENT '数据目录',
  db_name VARCHAR(128) NOT NULL COMMENT '数据库名',
  table_name VARCHAR(256) NOT NULL COMMENT '表名',
  node_type VARCHAR(32) NOT NULL DEFAULT 'TABLE' COMMENT '节点类型: TABLE / VIEW',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uk_node (cluster_id, catalog_name, db_name, table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='血缘节点';

-- 血缘边 (依赖关系)
CREATE TABLE IF NOT EXISTS lineage_edges (
  id INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  cluster_id INTEGER NOT NULL COMMENT '关联集群 ID',
  source_node_id INTEGER NOT NULL COMMENT '上游节点 ID',
  target_node_id INTEGER NOT NULL COMMENT '下游节点 ID',
  relation_type VARCHAR(32) NOT NULL COMMENT '关系: INSERT_SELECT / CTAS / VIEW',
  digest VARCHAR(64) DEFAULT '' COMMENT 'SQL 指纹',
  sample_sql TEXT COMMENT 'SQL 样本',
  exec_count INTEGER DEFAULT 1 COMMENT '执行频次',
  last_exec_time DATETIME COMMENT '最后执行时间',
  users TEXT COMMENT '关联用户 (JSON 数组)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '首次发现时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX idx_edge_source (source_node_id),
  INDEX idx_edge_target (target_node_id),
  UNIQUE KEY uk_edge (cluster_id, source_node_id, target_node_id, relation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='血缘边';

-- 同步记录
CREATE TABLE IF NOT EXISTS lineage_sync_log (
  id INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  cluster_id INTEGER NOT NULL COMMENT '集群 ID',
  sync_time DATETIME NOT NULL COMMENT '同步时间',
  digests_found INTEGER DEFAULT 0 COMMENT '发现的 digest 数',
  edges_created INTEGER DEFAULT 0 COMMENT '新增边数',
  edges_updated INTEGER DEFAULT 0 COMMENT '更新边数',
  parse_errors INTEGER DEFAULT 0 COMMENT '解析失败数',
  status VARCHAR(16) NOT NULL COMMENT 'SUCCESS / PARTIAL / FAILED',
  error_msg TEXT COMMENT '错误信息',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='血缘同步记录';
