'use client';

/**
 * TableLineagePanel — right-side drawer showing upstream/downstream
 * lineage tree for a selected table.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/fetch-patch';
import { getDbColor, getQueryNodeColor } from './graph-types';
import type { RawLineageNode, RawLineageEdge, RawLineageGraph } from './graph-types';
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  Table2,
  Code2,
  Clock,
  Users,
  Hash,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
  Download,
  Copy,
  Check,
} from 'lucide-react';

interface TableLineagePanelProps {
  clusterId: number;
  dbName: string;
  tableName: string;
  colorIdx: number;
  nodeType: 'TABLE' | 'VIEW' | 'QUERY';
  dbColorMap: Map<string, number>;
  onClose: () => void;
  onNavigate: (dbName: string, tableName: string) => void;
}

interface RelationDetail {
  node: RawLineageNode;
  edges: RawLineageEdge[];
  direction: 'upstream' | 'downstream';
}

export default function TableLineagePanel({
  clusterId,
  dbName,
  tableName,
  colorIdx,
  nodeType,
  dbColorMap,
  onClose,
  onNavigate,
}: TableLineagePanelProps) {
  const [loading, setLoading] = useState(false);
  const [graph, setGraph] = useState<RawLineageGraph | null>(null);
  const [expandedSql, setExpandedSql] = useState<number | null>(null);
  const [upExpanded, setUpExpanded] = useState(true);
  const [downExpanded, setDownExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  // L-1 fix: reactive isDark — listen to data-theme attribute changes (matches ForceGraph pattern)
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  );
  useEffect(() => {
    const el = document.documentElement;
    setIsDark(el.getAttribute('data-theme') === 'dark');
    const observer = new MutationObserver(() => {
      setIsDark(el.getAttribute('data-theme') === 'dark');
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const loadLineage = useCallback(async () => {
    if (!clusterId || !dbName || !tableName) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/lineage/table?clusterId=${clusterId}&db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(tableName)}&direction=both&depth=3`
      );
      const data: RawLineageGraph = await res.json();
      setGraph(data);
    } catch (err) {
      console.warn('[Lineage] Failed to load table lineage:', err);
    }
    finally { setLoading(false); }
  }, [clusterId, dbName, tableName]);

  useEffect(() => {
    loadLineage();
  }, [loadLineage]);

  // Find root node
  const rootNode = graph?.nodes.find(n => n.db_name === dbName && n.table_name === tableName);

  // Compute upstream / downstream relations
  const relations: RelationDetail[] = [];
  if (graph && rootNode) {
    // Pre-build O(1) node lookup index (fixes O(E×N) → O(E))
    const nodeMap = new Map<number, RawLineageNode>();
    graph.nodes.forEach(n => nodeMap.set(n.id, n));

    // Upstream: edges where target = rootNode
    const upEdges = graph.edges.filter(e => e.target_node_id === rootNode.id);
    const upNodes = new Map<number, RawLineageNode>();
    upEdges.forEach(e => {
      const n = nodeMap.get(e.source_node_id);
      if (n) upNodes.set(n.id, n);
    });
    upNodes.forEach(node => {
      relations.push({
        node,
        edges: upEdges.filter(e => e.source_node_id === node.id),
        direction: 'upstream',
      });
    });

    // Downstream: edges where source = rootNode
    const downEdges = graph.edges.filter(e => e.source_node_id === rootNode.id);
    const downNodes = new Map<number, RawLineageNode>();
    downEdges.forEach(e => {
      const n = nodeMap.get(e.target_node_id);
      if (n) downNodes.set(n.id, n);
    });
    downNodes.forEach(node => {
      relations.push({
        node,
        edges: downEdges.filter(e => e.target_node_id === node.id),
        direction: 'downstream',
      });
    });
  }

  const upstreamRelations = relations.filter(r => r.direction === 'upstream');
  const downstreamRelations = relations.filter(r => r.direction === 'downstream');

  const isQuery = nodeType === 'QUERY';
  const color = isQuery ? getQueryNodeColor(isDark) : getDbColor(colorIdx, isDark);

  /* ── Export: download a plain-text lineage report ──────── */
  const handleExport = useCallback(() => {
    const displayName = isQuery
      ? `查询 ${tableName.replace(/^query_/, '').substring(0, 20)}`
      : `${dbName}.${tableName}`;

    const lines: string[] = [
      `========================================`,
      `SQL 血缘关系报告`,
      `========================================`,
      `节点: ${displayName}`,
      `类型: ${nodeType}`,
      `导出时间: ${new Date().toLocaleString('zh-CN')}`,
      ``,
      `── 上游来源 (${upstreamRelations.length}) ──`,
    ];

    if (upstreamRelations.length === 0) {
      lines.push(`  (无上游依赖)`);
    } else {
      upstreamRelations.forEach(rel => {
        const edge = rel.edges[0];
        lines.push(`  ${rel.node.db_name}.${rel.node.table_name}`);
        if (edge) {
          lines.push(`    类型: ${edge.relation_type}  执行次数: ${edge.exec_count}  最后执行: ${edge.last_exec_time?.slice(0, 19) || '-'}`);
        }
      });
    }

    lines.push(``);
    lines.push(`── 下游消费 (${downstreamRelations.length}) ──`);

    if (downstreamRelations.length === 0) {
      lines.push(`  (无下游消费)`);
    } else {
      downstreamRelations.forEach(rel => {
        const edge = rel.edges[0];
        lines.push(`  ${rel.node.db_name}.${rel.node.table_name}`);
        if (edge) {
          lines.push(`    类型: ${edge.relation_type}  执行次数: ${edge.exec_count}  最后执行: ${edge.last_exec_time?.slice(0, 19) || '-'}`);
        }
      });
    }

    lines.push(``);
    lines.push(`========================================`);

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lineage_${tableName}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [dbName, tableName, nodeType, isQuery, upstreamRelations, downstreamRelations]);

  /* ── Copy: upstream + downstream table list to clipboard ── */
  const handleCopy = useCallback(async () => {
    const upList = upstreamRelations.map(r => `${r.node.db_name}.${r.node.table_name}`);
    const downList = downstreamRelations.map(r => `${r.node.db_name}.${r.node.table_name}`);

    const text = [
      `上游 (${upList.length}):`,
      ...upList.map(t => `  ${t}`),
      ``,
      `下游 (${downList.length}):`,
      ...downList.map(t => `  ${t}`),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [upstreamRelations, downstreamRelations]);

  return (
    <aside className="ln-explore-panel">
      <div className="ln-explore-content">
        {/* Header */}
        <div className="ln-explore-header">
          <div className="ln-explore-header-actions">
            <button
              className="ln-explore-action-btn"
              onClick={handleCopy}
              title={copied ? '已复制' : '复制上下游表清单'}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button
              className="ln-explore-action-btn"
              onClick={handleExport}
              title="导出血缘报告"
            >
              <Download size={13} />
            </button>
            <button className="ln-explore-close" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
          <div className="ln-explore-title">
            <div className="ln-explore-badge" style={{ background: color.fill, color: color.border }}>
              {isQuery ? <Code2 size={14} /> : <Table2 size={14} />}
            </div>
            <div className="ln-explore-names">
              <span className="ln-explore-db" style={{ color: color.border }}>
                {isQuery ? '⚡ 查询' : dbName}
              </span>
              <span className="ln-explore-table">
                {isQuery ? tableName.replace(/^query_/, '').substring(0, 20) : tableName}
              </span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="ln-explore-loading">
            <Loader2 size={16} className="spin" />
            <span>加载血缘关系...</span>
          </div>
        ) : (
          <>
            {/* Upstream */}
            <div className="ln-explore-section">
              <button
                className="ln-explore-section-header"
                onClick={() => setUpExpanded(!upExpanded)}
              >
                {upExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <ArrowDownRight size={13} style={{ transform: 'rotate(180deg)' }} />
                <span>上游来源</span>
                <span className="ln-explore-count">{upstreamRelations.length}</span>
              </button>
              {upExpanded && (
                <div className="ln-explore-list">
                  {upstreamRelations.length === 0 ? (
                    <div className="ln-explore-empty">无上游依赖</div>
                  ) : (
                    upstreamRelations.map(rel => {
                      const relColorIdx = dbColorMap.get(rel.node.db_name) ?? 0;
                      const relColor = getDbColor(relColorIdx, isDark);
                      const edge = rel.edges[0];
                      return (
                        <div key={rel.node.id} className="ln-explore-item">
                          <div className="ln-explore-item-header">
                            <span className="ln-explore-item-dot" style={{ background: relColor.dot }} />
                            <button
                              className="ln-explore-item-name"
                              onClick={() => onNavigate(rel.node.db_name, rel.node.table_name)}
                            >
                              <span className="ln-explore-item-db">{rel.node.db_name}.</span>
                              {rel.node.table_name}
                            </button>
                            <span className="ln-explore-item-type">{edge?.relation_type}</span>
                          </div>
                          {edge && (
                            <div className="ln-explore-item-meta">
                              <span><Hash size={10} /> ×{edge.exec_count}</span>
                              <span><Clock size={10} /> {edge.last_exec_time?.slice(5, 16)}</span>
                              {edge.sample_sql && (
                                <button
                                  className="ln-explore-sql-toggle"
                                  onClick={() => setExpandedSql(expandedSql === edge.id ? null : edge.id)}
                                >
                                  <Code2 size={10} /> SQL
                                </button>
                              )}
                            </div>
                          )}
                          {expandedSql === edge?.id && edge.sample_sql && (
                            <pre className="ln-explore-sql">{edge.sample_sql}</pre>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Downstream */}
            <div className="ln-explore-section">
              <button
                className="ln-explore-section-header"
                onClick={() => setDownExpanded(!downExpanded)}
              >
                {downExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <ArrowUpRight size={13} />
                <span>下游消费</span>
                <span className="ln-explore-count">{downstreamRelations.length}</span>
              </button>
              {downExpanded && (
                <div className="ln-explore-list">
                  {downstreamRelations.length === 0 ? (
                    <div className="ln-explore-empty">无下游消费</div>
                  ) : (
                    downstreamRelations.map(rel => {
                      const relColorIdx = dbColorMap.get(rel.node.db_name) ?? 0;
                      const relColor = getDbColor(relColorIdx, isDark);
                      const edge = rel.edges[0];
                      return (
                        <div key={rel.node.id} className="ln-explore-item">
                          <div className="ln-explore-item-header">
                            <span className="ln-explore-item-dot" style={{ background: relColor.dot }} />
                            <button
                              className="ln-explore-item-name"
                              onClick={() => onNavigate(rel.node.db_name, rel.node.table_name)}
                            >
                              <span className="ln-explore-item-db">{rel.node.db_name}.</span>
                              {rel.node.table_name}
                            </button>
                            <span className="ln-explore-item-type">{edge?.relation_type}</span>
                          </div>
                          {edge && (
                            <div className="ln-explore-item-meta">
                              <span><Hash size={10} /> ×{edge.exec_count}</span>
                              <span><Clock size={10} /> {edge.last_exec_time?.slice(5, 16)}</span>
                              {edge.sample_sql && (
                                <button
                                  className="ln-explore-sql-toggle"
                                  onClick={() => setExpandedSql(expandedSql === edge.id ? null : edge.id)}
                                >
                                  <Code2 size={10} /> SQL
                                </button>
                              )}
                            </div>
                          )}
                          {expandedSql === edge?.id && edge.sample_sql && (
                            <pre className="ln-explore-sql">{edge.sample_sql}</pre>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
