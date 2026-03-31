-- ============================================================
-- V3 — 血缘查询节点支持
-- 扩展 node_type 支持 QUERY 类型 (无 DDL 变更，仅文档声明)
-- lineage_nodes.node_type: TABLE / VIEW / QUERY
-- 查询节点 table_name 格式: query_{digest}
-- Flyway-style migration: DO NOT MODIFY after first execution.
-- ============================================================

-- 本次迁移无 DDL 变更
-- lineage_nodes.node_type (VARCHAR(32)) 已可容纳 'QUERY' 值
-- lineage_edges.relation_type (VARCHAR(32)) 已可容纳 'QUERY' 值
-- 此文件仅作为版本标记，声明系统从 V3 起支持查询 SQL 血缘
SELECT 1;
