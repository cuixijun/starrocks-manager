'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageHeader } from '@/components/ui';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch } from '@/lib/fetch-patch';
import ForceGraph from '@/components/lineage/ForceGraph';
import TableLineagePanel from '@/components/lineage/TableLineagePanel';
import { buildGraph, filterGraph, type BuiltGraph } from '@/components/lineage/graph-layout';
import type {
  RawLineageGraph,
  LineageStats,
  SyncResult,
  SyncLog,
  GraphNode,
} from '@/components/lineage/graph-types';
import { DB_COLORS } from '@/components/lineage/graph-types';
import {
  RefreshCw,
  Search,
  Database,
  Table2,
  ArrowUpDown,
  ChevronDown,
  Activity,
  Clock,
  Loader2,
  Info,
  AlertCircle,
  Check,
  X,
  Timer,
  Play,
  Eye,
  EyeOff,
} from 'lucide-react';

/* ── Custom DB Dropdown (kept from original) ──────────────── */

function DbDropdown({ databases, value, onChange, colorMap }: {
  databases: { db_name: string; cnt: number }[];
  value: string;
  onChange: (v: string) => void;
  colorMap: Map<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search when opening
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = search
    ? databases.filter(d => d.db_name.toLowerCase().includes(search.toLowerCase()))
    : databases;

  return (
    <div className="ln-dropdown" ref={ref}>
      <button className="ln-dropdown-trigger" onClick={() => setOpen(!open)}>
        <Database size={13} />
        <span className="ln-dropdown-label">{value || '全部数据库'}</span>
        <ChevronDown size={12} className={`ln-dropdown-arrow ${open ? 'ln-dropdown-arrow--open' : ''}`} />
      </button>
      {open && (
        <div className="ln-dropdown-menu">
          <div className="ln-dropdown-search">
            <Search size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <input
              ref={searchRef}
              className="ln-dropdown-search-input"
              placeholder="搜索数据库..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            {search && (
              <button className="ln-dropdown-search-clear" onClick={(e) => { e.stopPropagation(); setSearch(''); }}>
                <X size={10} />
              </button>
            )}
          </div>
          <button
            className={`ln-dropdown-item ${!value ? 'ln-dropdown-item--active' : ''}`}
            onClick={() => { onChange(''); setOpen(false); }}
          >
            <Database size={12} />
            <span>全部数据库</span>
            {!value && <Check size={12} className="ln-dropdown-check" />}
          </button>
          {filtered.length === 0 ? (
            <div className="ln-dropdown-empty">无匹配数据库</div>
          ) : (
            filtered.map(d => {
              const idx = colorMap.get(d.db_name) ?? 0;
              const active = value === d.db_name;
              return (
                <button
                  key={d.db_name}
                  className={`ln-dropdown-item ${active ? 'ln-dropdown-item--active' : ''}`}
                  onClick={() => { onChange(active ? '' : d.db_name); setOpen(false); }}
                >
                  <span className="ln-legend-dot" style={{ background: DB_COLORS[idx % DB_COLORS.length].dot }} />
                  <span className="ln-dropdown-item-text">{d.db_name}</span>
                  <span className="ln-dropdown-item-count">{d.cnt}</span>
                  {active && <Check size={12} className="ln-dropdown-check" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Page Component ──────────────────────────────────── */

export default function LineagePage() {
  const { session } = useSession();
  const { activeCluster } = useAuth();
  const sessionId = session?.sessionId || '';
  const clusterId = activeCluster?.id || 0;

  const [stats, setStats] = useState<LineageStats | null>(null);
  const [rawGraph, setRawGraph] = useState<RawLineageGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dbFilter, setDbFilter] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [showSyncLogs, setShowSyncLogs] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');
  const [nodeDepth, setNodeDepth] = useState<number | 'all'>(2);
  const [hideQueryNodes, setHideQueryNodes] = useState(false);

  /* ── Schedule state (server-side managed) ──────────── */
  const SCHEDULE_OPTIONS = [
    { value: 0,   label: '手动同步',   shortLabel: '手动' },
    { value: 5,   label: '每 5 分钟',  shortLabel: '5m' },
    { value: 10,  label: '每 10 分钟', shortLabel: '10m' },
    { value: 30,  label: '每 30 分钟', shortLabel: '30m' },
    { value: 60,  label: '每 1 小时',  shortLabel: '1h' },
  ] as const;
  type ScheduleValue = typeof SCHEDULE_OPTIONS[number]['value'];

  const [scheduleMin, setScheduleMin] = useState<ScheduleValue>(0);
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const [nextSyncCountdown, setNextSyncCountdown] = useState<number | null>(null);
  const nextSyncTimeRef = useRef<number | null>(null);

  /* ── Data loading ─────────────────────────────────────── */

  const loadStats = useCallback(async () => {
    if (!clusterId) return;
    try {
      const res = await apiFetch(`/api/lineage?type=stats&clusterId=${clusterId}`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.warn('[Lineage] Failed to load stats:', err);
    }
  }, [clusterId]);

  const loadGraph = useCallback(async () => {
    if (!clusterId) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/lineage?type=graph&clusterId=${clusterId}`);
      const data: RawLineageGraph = await res.json();
      setRawGraph(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  const handleSync = useCallback(async () => {
    if (!clusterId) return;
    setSyncing(true);
    setSyncResult(null);
    setError('');
    try {
      // S-1 fix: no longer send sessionId — server constructs it from clusterId
      const res = await apiFetch(`/api/lineage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterId }),
      });
      const result: SyncResult = await res.json();
      setSyncResult(result);
      await loadStats();
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  }, [clusterId, loadStats, loadGraph]);

  const loadSyncLogs = useCallback(async () => {
    if (!clusterId) return;
    try {
      const res = await apiFetch(`/api/lineage/sync-logs?clusterId=${clusterId}`);
      const data = await res.json();
      setSyncLogs(data.logs || []);
    } catch (err) {
      console.warn('[Lineage] Failed to load sync logs:', err);
    }
  }, [clusterId]);

  useEffect(() => {
    if (clusterId) { loadStats(); loadGraph(); }
  }, [clusterId, loadStats, loadGraph]);

  /* ── Schedule: server-side timer management ─────────── */

  // Load schedule from server on mount
  const loadSchedule = useCallback(async () => {
    if (!clusterId) return;
    try {
      const res = await apiFetch(`/api/lineage/schedule?clusterId=${clusterId}`);
      const data = await res.json();
      setScheduleMin(data.intervalMinutes ?? 0);
      nextSyncTimeRef.current = data.nextSyncTime ?? null;
    } catch (err) {
      console.warn('[Lineage] Failed to load schedule:', err);
    }
  }, [clusterId]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const handleScheduleChange = useCallback(async (val: ScheduleValue) => {
    if (!clusterId) return;
    setScheduleMin(val);
    setShowScheduleMenu(false);
    try {
      const res = await apiFetch(`/api/lineage/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterId, intervalMinutes: val }),
      });
      const data = await res.json();
      nextSyncTimeRef.current = data.nextSyncTime ?? null;
    } catch (err) {
      // Rollback optimistic update on failure
      console.warn('[Lineage] Failed to update schedule:', err);
      loadSchedule();
    }
  }, [clusterId, loadSchedule]);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (scheduleRef.current && !scheduleRef.current.contains(e.target as HTMLElement)) setShowScheduleMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Countdown display (polls server's nextSyncTime)
  useEffect(() => {
    if (scheduleMin === 0) { setNextSyncCountdown(null); return; }

    // Poll next sync time from server every 30s for accuracy
    const pollNextSync = async () => {
      if (!clusterId) return;
      try {
        const res = await apiFetch(`/api/lineage/schedule?clusterId=${clusterId}`);
        const data = await res.json();
        nextSyncTimeRef.current = data.nextSyncTime ?? null;
      } catch { /* ignore */ }
    };
    const pollId = setInterval(pollNextSync, 30_000);

    // Client-side countdown tick every second
    const tick = () => {
      if (nextSyncTimeRef.current) {
        const remaining = Math.max(0, Math.ceil((nextSyncTimeRef.current - Date.now()) / 1000));
        setNextSyncCountdown(remaining);
        // When countdown hits 0, reload data after a short delay (server synced)
        if (remaining === 0) {
          setTimeout(() => { loadStats(); loadGraph(); pollNextSync(); }, 3000);
        }
      }
    };
    tick();
    const tickId = setInterval(tick, 1000);

    return () => { clearInterval(pollId); clearInterval(tickId); };
  }, [scheduleMin, clusterId, loadStats, loadGraph]);

  /* ── Graph building & filtering ───────────────────────── */

  // Debounce search input to avoid re-layout on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const builtGraph: BuiltGraph | null = useMemo(() => {
    if (!rawGraph) return null;
    return buildGraph(rawGraph);
  }, [rawGraph]);

  const filteredGraph = useMemo(() => {
    if (!builtGraph) return { nodes: [], links: [], dbColorMap: new Map<string, number>() };
    return filterGraph(builtGraph, debouncedSearch, dbFilter, nodeDepth, selectedNode?.id, hideQueryNodes);
  }, [builtGraph, debouncedSearch, dbFilter, nodeDepth, selectedNode?.id, hideQueryNodes]);

  const dbColorMap = filteredGraph.dbColorMap;

  /* ── Selection handlers ───────────────────────────────── */

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(prev => prev?.id === node.id ? null : node);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleNavigate = useCallback((dbName: string, tableName: string) => {
    // Find node in graph
    const node = filteredGraph.nodes.find(n => n.dbName === dbName && n.tableName === tableName);
    if (node) {
      setSelectedNode(node);
    }
  }, [filteredGraph.nodes]);

  // ESC key to deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setShowSyncLogs(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── Render ───────────────────────────────────────────── */

  return (
    <>
      <PageHeader
        title="SQL 血缘分析"
        breadcrumb={[{ label: '数据治理' }, { label: 'SQL 血缘' }]}
        description="基于审计日志的表级数据血缘关系图"
      />
      <div className="page-body">
        {error && <div className="error-banner">{error}</div>}

        {!clusterId ? (
          <div className="empty-state">
            <Database size={48} />
            <div className="empty-state-text">请先在集群管理中激活一个集群</div>
          </div>
        ) : (
          <div className="ln-container fade-in">
            {/* ── Toolbar ── */}
            <div className="ln-toolbar">
              <div className="ln-toolbar-left">
                <div className="ln-search-wrap">
                  <Search size={13} style={{ color: 'var(--text-tertiary)' }} />
                  <input
                    className="ln-search-input"
                    placeholder="搜索表名或数据库..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button className="ln-search-clear" onClick={() => setSearchTerm('')}>×</button>
                  )}
                </div>
                {stats && stats.databases.length > 0 && (
                  <DbDropdown
                    databases={stats.databases}
                    value={dbFilter}
                    onChange={setDbFilter}
                    colorMap={dbColorMap}
                  />
                )}
                <button
                  className={`ln-toggle-btn ${hideQueryNodes ? 'ln-toggle-active' : ''}`}
                  onClick={() => setHideQueryNodes(v => !v)}
                  title={hideQueryNodes ? '显示查询节点' : '隐藏查询节点'}
                >
                  {hideQueryNodes ? <EyeOff size={13} /> : <Eye size={13} />}
                  <span>{hideQueryNodes ? '查询已隐藏' : '查询节点'}</span>
                </button>
                </div>
                <div className="ln-toolbar-right">
                {stats && (
                  <div className="ln-stats-chips">
                    <span className="ln-chip"><Table2 size={12} /> {stats.totalNodes} 表</span>
                    <span className="ln-chip"><ArrowUpDown size={12} /> {stats.totalEdges} 关系</span>
                    {stats.lastSync && <span className="ln-chip"><Clock size={12} /> {stats.lastSync.sync_time.slice(5, 16)}</span>}
                  </div>
                )}
                <div className="ln-sync-group">
                  <button className="ln-btn-sync" onClick={handleSync} disabled={syncing}>
                    {syncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                    {syncing ? '同步中...' : '同步血缘'}
                  </button>

                  {/* Schedule Dropdown */}
                  <div className="ln-schedule-wrap" ref={scheduleRef}>
                    <button
                      className={`ln-schedule-trigger ${scheduleMin > 0 ? 'ln-schedule-active' : ''}`}
                      onClick={() => setShowScheduleMenu(!showScheduleMenu)}
                      title={scheduleMin > 0 ? `自动同步: ${SCHEDULE_OPTIONS.find(o => o.value === scheduleMin)?.label}` : '设置定时同步'}
                    >
                      <Timer size={13} />
                      {scheduleMin > 0 && (
                        <span className="ln-schedule-badge">
                          {SCHEDULE_OPTIONS.find(o => o.value === scheduleMin)?.shortLabel}
                        </span>
                      )}
                    </button>
                    {showScheduleMenu && (
                      <div className="ln-schedule-menu">
                        <div className="ln-schedule-title">定时同步频率</div>
                        {SCHEDULE_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            className={`ln-dropdown-item ${scheduleMin === opt.value ? 'ln-dropdown-item--active' : ''}`}
                            onClick={() => handleScheduleChange(opt.value as ScheduleValue)}
                          >
                            {opt.value === 0 ? <Play size={12} /> : <Timer size={12} />}
                            <span>{opt.label}</span>
                            {scheduleMin === opt.value && <Check size={12} className="ln-dropdown-check" />}
                          </button>
                        ))}
                        {scheduleMin > 0 && nextSyncCountdown !== null && (
                          <div className="ln-schedule-countdown">
                            <Clock size={10} />
                            下次同步: {Math.floor(nextSyncCountdown / 60)}:{String(nextSyncCountdown % 60).padStart(2, '0')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <button className="ln-btn-logs" onClick={() => { setShowSyncLogs(!showSyncLogs); if (!showSyncLogs) loadSyncLogs(); }}>
                  <Activity size={14} />
                </button>
              </div>
            </div>

            {/* Sync toast */}
            {syncResult && (
              <div className={`ln-sync-toast ${syncResult.status === 'FAILED' ? 'error' : ''}`}>
                <Info size={14} />
                <span>
                  同步完成: 发现 {syncResult.digestsFound + (syncResult.queryDigestsFound || 0)} 条 SQL, 新增 {syncResult.edgesCreated + (syncResult.queryEdgesCreated || 0)} / 更新 {syncResult.edgesUpdated} 条关系
                  {syncResult.queryNodesCreated > 0 && `, 查询节点 ${syncResult.queryNodesCreated} 个`}
                  {syncResult.parseErrors > 0 && `, ${syncResult.parseErrors} 条解析失败`}
                </span>
                <button onClick={() => setSyncResult(null)}>×</button>
              </div>
            )}

            {/* ── Main graph area ── */}
            <div className="ln-main">
              {/* Left DB sidebar legend */}
              {!loading && stats && stats.databases.length > 1 && (
                <aside className="ln-sidebar-legend">
                  <div className="ln-sidebar-legend-title">数据库</div>
                  <div className="ln-sidebar-legend-list">
                    {stats.databases.map((d) => {
                      // L-6 fix: use dbColorMap from buildGraph for consistent color assignment
                      const colorIdx = dbColorMap.get(d.db_name) ?? 0;
                      return (
                        <button
                          key={d.db_name}
                          className={`ln-legend-item ${dbFilter === d.db_name ? 'ln-legend-active' : ''}`}
                          onClick={() => setDbFilter(d.db_name === dbFilter ? '' : d.db_name)}
                        >
                          <span className="ln-legend-dot" style={{ background: DB_COLORS[colorIdx % DB_COLORS.length].dot }} />
                          <span className="ln-legend-text">{d.db_name}</span>
                          <span className="ln-legend-count">{d.cnt}</span>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              )}

              {loading ? (
                <div className="ln-canvas-wrap">
                  <div className="loading-overlay"><div className="spinner" /> 加载血缘数据...</div>
                </div>
              ) : (
                <>
                  {/* M-7: large graph warning */}
                  {filteredGraph.nodes.length > 1000 && (
                    <div className="ln-sync-toast" style={{ zIndex: 5 }}>
                      <Info size={14} />
                      <span>
                        当前显示 {filteredGraph.nodes.length} 个节点，数据量较大可能影响渲染性能。建议筛选数据库或调整深度。
                      </span>
                    </div>
                  )}
                  <ForceGraph
                    nodes={filteredGraph.nodes}
                    links={filteredGraph.links}
                    selectedNodeId={selectedNode?.id ?? null}
                    onNodeClick={handleNodeClick}
                    onBackgroundClick={handleBackgroundClick}
                    nodeDepth={nodeDepth}
                    onDepthChange={setNodeDepth}
                  />
                </>
              )}

              {/* Table exploration panel */}
              {selectedNode && (
                <TableLineagePanel
                  clusterId={clusterId}
                  dbName={selectedNode.dbName}
                  tableName={selectedNode.tableName}
                  colorIdx={selectedNode.colorIdx}
                  nodeType={selectedNode.nodeType}
                  dbColorMap={dbColorMap}
                  onClose={() => setSelectedNode(null)}
                  onNavigate={handleNavigate}
                />
              )}

              {/* Sync logs panel */}
              {showSyncLogs && (
                <aside className="ln-detail-panel">
                  <div className="ln-detail-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 className="ln-detail-title" style={{ margin: 0 }}><Activity size={14} /> 同步记录</h4>
                      <button className="ln-explore-close" onClick={() => setShowSyncLogs(false)}>
                        <X size={12} />
                      </button>
                    </div>
                    {syncLogs.length === 0 ? (
                      <div className="ln-empty-detail">暂无同步记录</div>
                    ) : (
                      <div className="ln-sync-log-list">
                        {syncLogs.map(log => (
                          <div key={log.id} className={`ln-sync-log-item ${log.status === 'FAILED' ? 'error' : ''}`}>
                            <div className="ln-sync-log-time">{log.sync_time.slice(5, 19)}</div>
                            <div className="ln-sync-log-stats">
                              <span className={`ln-sync-status ${log.status.toLowerCase()}`}>{log.status}</span>
                              <span>发现 {log.digests_found}</span>
                              <span>+{log.edges_created} / ↻{log.edges_updated}</span>
                              {log.parse_errors > 0 && <span className="ln-parse-err"><AlertCircle size={11} /> {log.parse_errors}</span>}
                            </div>
                            {log.error_msg && <div className="ln-sync-log-err">{log.error_msg}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
