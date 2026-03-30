'use client';

/**
 * TableLineagePanel — right-side drawer showing upstream/downstream
 * lineage tree for a selected table.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/fetch-patch';
import { getDbColor } from './graph-types';
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
} from 'lucide-react';

interface TableLineagePanelProps {
  clusterId: number;
  dbName: string;
  tableName: string;
  colorIdx: number;
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
  dbColorMap,
  onClose,
  onNavigate,
}: TableLineagePanelProps) {
  const [loading, setLoading] = useState(false);
  const [graph, setGraph] = useState<RawLineageGraph | null>(null);
  const [expandedSql, setExpandedSql] = useState<number | null>(null);
  const [upExpanded, setUpExpanded] = useState(true);
  const [downExpanded, setDownExpanded] = useState(true);

  const isDark = typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark';

  const loadLineage = useCallback(async () => {
    if (!clusterId || !dbName || !tableName) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/lineage/table?clusterId=${clusterId}&db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(tableName)}&direction=both&depth=3`
      );
      const data: RawLineageGraph = await res.json();
      setGraph(data);
    } catch { /* ignore */ }
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
    // Upstream: edges where target = rootNode
    const upEdges = graph.edges.filter(e => e.target_node_id === rootNode.id);
    const upNodes = new Map<number, RawLineageNode>();
    upEdges.forEach(e => {
      const n = graph.nodes.find(node => node.id === e.source_node_id);
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
      const n = graph.nodes.find(node => node.id === e.target_node_id);
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

  const color = getDbColor(colorIdx, isDark);

  return (
    <aside className="ln-explore-panel">
      <div className="ln-explore-content">
        {/* Header */}
        <div className="ln-explore-header">
          <button className="ln-explore-close" onClick={onClose}>
            <X size={14} />
          </button>
          <div className="ln-explore-title">
            <div className="ln-explore-badge" style={{ background: color.fill, color: color.border }}>
              <Table2 size={14} />
            </div>
            <div className="ln-explore-names">
              <span className="ln-explore-db" style={{ color: color.border }}>{dbName}</span>
              <span className="ln-explore-table">{tableName}</span>
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
