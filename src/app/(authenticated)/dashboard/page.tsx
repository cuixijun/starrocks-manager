'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/hooks/useAuth';
import {
  Server,
  Cpu,
  HardDrive,
  Activity,
  Users,
  Clock,
  XCircle,
  RefreshCw,
  Database,
  Network,
  Filter,
  LayoutDashboard,
} from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { CommandLogButton } from '@/components/ui';
import SearchableSelect from '@/components/SearchableSelect';
import Breadcrumb from '@/components/Breadcrumb';

interface NodeInfo {
  [key: string]: string | number;
}

interface ProcessInfo {
  Id?: string | number;
  User?: string;
  Host?: string;
  Db?: string;
  Command?: string;
  Time?: string | number;
  State?: string;
  Info?: string;
  [key: string]: unknown;
}

export default function DashboardPage() {
  const { session, clusterOffline, retryConnection, retrying } = useSession();
  const { activeCluster, setClusterStatus } = useAuth();
  // Dashboard needs its own sessionId from activeCluster (bypassing the offline gate)
  // because it's the page that first detects and reports cluster failures
  const clusterSessionId = activeCluster ? `${activeCluster.host}:${activeCluster.port}` : null;
  const [frontends, setFrontends] = useState<NodeInfo[]>([]);
  const [backends, setBackends] = useState<NodeInfo[]>([]);
  const [computeNodes, setComputeNodes] = useState<NodeInfo[]>([]);
  const [brokers, setBrokers] = useState<NodeInfo[]>([]);
  const [queries, setQueries] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [killConfirm, setKillConfirm] = useState<string | number | null>(null);

  // Query section independent state
  const [queryRefreshing, setQueryRefreshing] = useState(false);
  const [queryInterval, setQueryInterval] = useState(60); // seconds, 0 = manual only
  const [commandFilter, setCommandFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const queryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [countdown, setCountdown] = useState(60);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const connectionFailedRef = useRef(false);

  // Helper to mark connection as failed (both state + ref)

  const markFailed = useCallback(() => {
    connectionFailedRef.current = true;
    setConnectionFailed(true);
    setClusterStatus('offline');
  }, [setClusterStatus]);

  const markConnected = useCallback(() => {
    connectionFailedRef.current = false;
    setConnectionFailed(false);
    setClusterStatus('online');
  }, [setClusterStatus]);

  const fetchCluster = useCallback(async () => {
    if (!clusterSessionId || connectionFailedRef.current) return;
    try {
      const res = await fetch(`/api/cluster?sessionId=${encodeURIComponent(clusterSessionId)}`);
      const cluster = await res.json();
      if (cluster.error) {
        setError(cluster.error);
        // Detect connection failure — stop polling (503 = cluster unreachable)
        if (!res.ok) {
          markFailed();
        }
      } else {
        setFrontends(cluster.frontends || []);
        setBackends(cluster.backends || []);
        setComputeNodes(cluster.computeNodes || []);
        setBrokers(cluster.brokers || []);
        // Connection successful — mark as online if was previously unknown/failed
        if (!connectionFailedRef.current) {
          setClusterStatus('online');
        }
      }
    } catch (err) {
      setError(String(err));
      markFailed();
    }
  }, [clusterSessionId, markFailed]);

  const fetchQueries = useCallback(async () => {
    if (!session || connectionFailedRef.current) return;
    try {
      const res = await fetch(`/api/queries?sessionId=${encodeURIComponent(session.sessionId)}`);
      const data = await res.json();
      if (res.ok) {
        setQueries(data.queries || []);
      }
    } catch { /* ignore */ }
  }, [session]);

  const fetchAll = useCallback(async () => {
    if (!clusterSessionId) return;
    try {
      await Promise.all([fetchCluster(), fetchQueries()]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clusterSessionId, fetchCluster, fetchQueries]);

  // Clear stale data when cluster switches
  useEffect(() => {
    const handleSwitch = () => {
      setFrontends([]);
      setBackends([]);
      setComputeNodes([]);
      setBrokers([]);
      setQueries([]);
      setError('');
      setLoading(true);
      connectionFailedRef.current = false;
      setConnectionFailed(false);
    };
    window.addEventListener('cluster-switched', handleSwitch);
    return () => window.removeEventListener('cluster-switched', handleSwitch);
  }, []);

  // Initial load — only runs once per session
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterSessionId]);

  // Cluster auto-refresh interval (30s) — stops on connectionFailed
  useEffect(() => {
    if (connectionFailed) return;
    const interval = setInterval(fetchCluster, 30000);
    return () => clearInterval(interval);
  }, [fetchCluster, connectionFailed]);

  // Independent query auto-refresh + countdown — stops when connectionFailed
  useEffect(() => {
    if (queryTimerRef.current) clearInterval(queryTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (queryInterval > 0 && !connectionFailed) {
      setCountdown(queryInterval);
      queryTimerRef.current = setInterval(() => {
        fetchQueries();
        setCountdown(queryInterval);
      }, queryInterval * 1000);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => (prev > 1 ? prev - 1 : queryInterval));
      }, 1000);
    }
    return () => {
      if (queryTimerRef.current) clearInterval(queryTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [queryInterval, fetchQueries, connectionFailed]);

  function handleRefresh() {
    // Clear failure state to allow retry
    markConnected();
    setError('');
    setRefreshing(true);
    fetchAll();
    // Reset the query countdown timer so it restarts from full interval
    if (queryInterval > 0) {
      setCountdown(queryInterval);
      // Restart the auto-refresh interval
      if (queryTimerRef.current) clearInterval(queryTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      queryTimerRef.current = setInterval(() => {
        fetchQueries();
        setCountdown(queryInterval);
      }, queryInterval * 1000);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => (prev > 1 ? prev - 1 : queryInterval));
      }, 1000);
    }
  }

  function handleQueryRefresh() {
    setQueryRefreshing(true);
    fetchQueries().finally(() => setQueryRefreshing(false));
    if (queryInterval > 0) setCountdown(queryInterval);
  }

  async function handleKillQuery(id: string | number) {
    if (!session) return;
    try {
      await fetch('/api/queries', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, queryId: id }),
      });
      fetchQueries();
    } catch { /* ignore */ }
    setKillConfirm(null);
  }

  function getNodeValue(node: NodeInfo, ...keys: string[]): string {
    for (const key of keys) {
      if (node[key] !== undefined) return String(node[key]);
    }
    return '-';
  }

  function isAlive(node: NodeInfo): boolean {
    const alive = getNodeValue(node, 'Alive', 'alive', 'IsAlive');
    return alive === 'true' || alive === 'TRUE' || alive === '1';
  }

  // Derived filter values
  const commandTypes = useMemo(() => {
    const set = new Set<string>();
    queries.forEach(q => { if (q.Command) set.add(q.Command); });
    return Array.from(set).sort();
  }, [queries]);

  const userNames = useMemo(() => {
    const set = new Set<string>();
    queries.forEach(q => { if (q.User) set.add(q.User); });
    return Array.from(set).sort();
  }, [queries]);

  const filteredQueries = useMemo(() => {
    return queries.filter(q => {
      if (commandFilter !== 'all' && q.Command !== commandFilter) return false;
      if (userFilter !== 'all' && q.User !== userFilter) return false;
      return true;
    });
  }, [queries, commandFilter, userFilter]);

  if (loading) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[{ label: '监控', icon: <LayoutDashboard size={13} /> }, { label: '仪表盘' }]} />
          <h1 className="page-title">仪表盘</h1>
        </div>
        <div className="page-body">
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        </div>
      </>
    );
  }

  const totalNodes = frontends.length + backends.length + computeNodes.length + brokers.length;
  const aliveNodes = [...frontends, ...backends, ...computeNodes, ...brokers].filter(isAlive).length;
  const activeQueries = queries.filter(q => q.Command !== 'Sleep' && q.Command !== 'Daemon').length;

  return (
    <>
      <div className="page-header">
        <Breadcrumb items={[{ label: '监控', icon: <LayoutDashboard size={13} /> }, { label: '仪表盘' }]} />
        <div className="page-header-row">
          <div>
            <h1 className="page-title">仪表盘</h1>
            <p className="page-description">集群概览 · {session?.host}:{session?.port}</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="table-toolbar">
          <div />
          <div className="toolbar-actions">
            <CommandLogButton source="dashboard" title="仪表盘" />
            <button className="btn btn-secondary" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'animate-pulse' : ''} />
              刷新
            </button>
          </div>
        </div>
        {connectionFailed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '14px 18px', marginBottom: '16px',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            color: 'var(--danger-500)',
          }}>
            <XCircle size={20} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: '0.88rem' }}>
              <strong>集群连接不可用</strong>
              <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px' }}>
                {session?.host}:{session?.port} 无法连接，自动刷新已暂停
              </span>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={() => {
              setConnectionFailed(false);
              setError('');
              handleRefresh();
            }}>
              <RefreshCw size={14} /> 重试连接
            </button>
          </div>
        )}
        {error && !connectionFailed && (
          <div className="error-banner">{error}</div>
        )}

        {/* Stats */}
        <div className="grid-4 mb-6">
          <div className="stat-card">
            <div className="stat-card-icon blue"><Server size={20} /></div>
            <div className="stat-card-label">节点总数</div>
            <div className="stat-card-value">{totalNodes}</div>
            <div className="stat-card-detail">{aliveNodes} 在线 / {totalNodes - aliveNodes} 离线</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon green"><Cpu size={20} /></div>
            <div className="stat-card-label">FE 节点</div>
            <div className="stat-card-value">{frontends.length}</div>
            <div className="stat-card-detail">{frontends.filter(isAlive).length} 在线</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon purple"><HardDrive size={20} /></div>
            <div className="stat-card-label">CN/Broker 节点</div>
            <div className="stat-card-value">{backends.length + computeNodes.length + brokers.length}</div>
            <div className="stat-card-detail">{backends.length > 0 ? `BE ${backends.length} + ` : ''}CN {computeNodes.length} + Broker {brokers.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon orange"><Activity size={20} /></div>
            <div className="stat-card-label">活跃查询</div>
            <div className="stat-card-value">{activeQueries}</div>
            <div className="stat-card-detail">共 {queries.length} 个连接</div>
          </div>
        </div>

        {/* FE Nodes */}
        {frontends.length > 0 && (
          <div className="card mb-4">
            <div className="card-header">
              <div>
                <div className="card-title"><Server size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />Frontend 节点</div>
              </div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>名称</th><th>IP</th><th>端口</th><th>角色</th><th>状态</th><th>版本</th><th>启动时间</th><th>最后心跳</th>
                  </tr>
                </thead>
                <tbody>
                  {frontends.map((fe, i) => (
                    <tr key={i}>
                      <td className="text-mono">{getNodeValue(fe, 'Name', 'name')}</td>
                      <td className="text-mono">{getNodeValue(fe, 'IP', 'Host', 'ip', 'host')}</td>
                      <td>{getNodeValue(fe, 'EditLogPort', 'HttpPort', 'QueryPort')}</td>
                      <td><span className={`badge ${getNodeValue(fe, 'Role', 'role') === 'LEADER' ? 'badge-info' : 'badge-neutral'}`}>{getNodeValue(fe, 'Role', 'role', 'IsMaster')}</span></td>
                      <td><span className={`badge ${isAlive(fe) ? 'badge-success' : 'badge-danger'}`}><span className={`badge-dot ${isAlive(fe) ? 'green' : 'red'}`} />{isAlive(fe) ? '在线' : '离线'}</span></td>
                      <td className="text-xs">{getNodeValue(fe, 'Version', 'version')}</td>
                      <td className="text-xs">{getNodeValue(fe, 'StartTime', 'LastStartTime')}</td>
                      <td className="text-xs">{getNodeValue(fe, 'LastHeartbeat')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* BE Nodes */}
        {backends.length > 0 && (
          <div className="card mb-4">
            <div className="card-header">
              <div className="card-title"><HardDrive size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />Backend 节点</div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>ID</th><th>IP</th><th>端口</th><th>状态</th><th>Tablet 数量</th><th>已用空间</th><th>总空间</th><th>启动时间</th><th>最后心跳</th></tr>
                </thead>
                <tbody>
                  {backends.map((be, i) => (
                    <tr key={i}>
                      <td>{getNodeValue(be, 'BackendId', 'ID', 'id')}</td>
                      <td className="text-mono">{getNodeValue(be, 'IP', 'Host', 'ip', 'host')}</td>
                      <td>{getNodeValue(be, 'HeartbeatPort', 'BePort')}</td>
                      <td><span className={`badge ${isAlive(be) ? 'badge-success' : 'badge-danger'}`}><span className={`badge-dot ${isAlive(be) ? 'green' : 'red'}`} />{isAlive(be) ? '在线' : '离线'}</span></td>
                      <td>{getNodeValue(be, 'TabletNum', 'NumTablets')}</td>
                      <td>{getNodeValue(be, 'UsedCapacity', 'DataUsedCapacity')}</td>
                      <td>{getNodeValue(be, 'TotalCapacity')}</td>
                      <td className="text-xs">{getNodeValue(be, 'LastStartTime')}</td>
                      <td className="text-xs">{getNodeValue(be, 'LastHeartbeat')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CN Nodes */}
        {computeNodes.length > 0 && (
          <div className="card mb-4">
            <div className="card-header">
              <div className="card-title"><Cpu size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />Compute 节点</div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>ID</th><th>IP</th><th>端口</th><th>状态</th><th>CPU 核数</th><th>内存</th><th>启动时间</th><th>最后心跳</th></tr>
                </thead>
                <tbody>
                  {computeNodes.map((cn, i) => (
                    <tr key={i}>
                      <td>{getNodeValue(cn, 'ComputeNodeId', 'ID', 'id')}</td>
                      <td className="text-mono">{getNodeValue(cn, 'IP', 'Host', 'ip', 'host')}</td>
                      <td>{getNodeValue(cn, 'HeartbeatPort', 'BePort')}</td>
                      <td><span className={`badge ${isAlive(cn) ? 'badge-success' : 'badge-danger'}`}><span className={`badge-dot ${isAlive(cn) ? 'green' : 'red'}`} />{isAlive(cn) ? '在线' : '离线'}</span></td>
                      <td>{getNodeValue(cn, 'CpuCores', 'NumCPUCores')}</td>
                      <td>{getNodeValue(cn, 'MemUsedPct', 'MemUsage')}</td>
                      <td className="text-xs">{getNodeValue(cn, 'LastStartTime')}</td>
                      <td className="text-xs">{getNodeValue(cn, 'LastHeartbeat')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Broker Nodes */}
        {brokers.length > 0 && (
          <div className="card mb-4">
            <div className="card-header">
              <div className="card-title"><Network size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />Broker 节点</div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>名称</th><th>IP</th><th>端口</th><th>状态</th><th>启动时间</th><th>最后心跳</th><th>错误信息</th></tr>
                </thead>
                <tbody>
                  {brokers.map((br, i) => (
                    <tr key={i}>
                      <td className="text-mono">{getNodeValue(br, 'Name', 'name')}</td>
                      <td className="text-mono">{getNodeValue(br, 'IP', 'Host', 'ip', 'host')}</td>
                      <td>{getNodeValue(br, 'Port', 'port')}</td>
                      <td><span className={`badge ${isAlive(br) ? 'badge-success' : 'badge-danger'}`}><span className={`badge-dot ${isAlive(br) ? 'green' : 'red'}`} />{isAlive(br) ? '在线' : '离线'}</span></td>
                      <td className="text-xs">{getNodeValue(br, 'LastStartTime')}</td>
                      <td className="text-xs">{getNodeValue(br, 'LastUpdateTime', 'LastHeartbeat')}</td>
                      <td className="text-xs" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getNodeValue(br, 'ErrMsg', 'LastErrMsg')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Running Queries ─── */}
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ flex: '0 0 auto' }}>
              <div className="card-title">
                <Activity size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                运行中查询
                <span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: '8px' }}>
                  {filteredQueries.length === queries.length ? `${queries.length} 个连接` : `${filteredQueries.length} / ${queries.length}`}
                </span>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              {/* Command filter chips */}
              {commandTypes.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginRight: '4px' }}>
                  {[
                    { key: 'all', label: `全部(${queries.length})` },
                    ...commandTypes.map(cmd => ({ key: cmd, label: `${cmd}(${queries.filter(q => q.Command === cmd).length})` })),
                  ].map(chip => {
                    const isActive = commandFilter === chip.key;
                    return (
                      <button
                        key={chip.key}
                        onClick={() => setCommandFilter(isActive && chip.key !== 'all' ? 'all' : chip.key)}
                        style={{
                          padding: '2px 10px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                          border: '1px solid', transition: 'all 0.15s ease', lineHeight: '18px', whiteSpace: 'nowrap',
                          ...(isActive
                            ? { backgroundColor: 'var(--primary-600)', color: '#fff', borderColor: 'var(--primary-600)' }
                            : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)', borderColor: 'var(--border-primary)' }),
                        }}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* User filter */}
              {userNames.length > 1 && (
                <div style={{ width: '160px', flexShrink: 0 }}>
                  <SearchableSelect
                    options={[
                      { label: '全部用户', value: 'all' },
                      ...userNames.map(u => ({ label: u, value: u })),
                    ]}
                    value={userFilter}
                    onChange={v => setUserFilter(v)}
                    placeholder="全部用户"
                    searchPlaceholder="搜索用户..."
                    searchThreshold={4}
                  />
                </div>
              )}
              {/* Auto-refresh interval */}
              <div style={{ width: '90px', flexShrink: 0 }}>
                <SearchableSelect
                  options={[
                    { label: '⏸ 手动', value: '0' },
                    { label: '⏱ 10s', value: '10' },
                    { label: '⏱ 30s', value: '30' },
                    { label: '⏱ 60s', value: '60' },
                  ]}
                  value={String(queryInterval)}
                  onChange={v => { setQueryInterval(Number(v)); if (Number(v) > 0) setCountdown(Number(v)); }}
                  placeholder="60s"
                  searchThreshold={99}
                />
              </div>
              {/* Manual refresh / countdown */}
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleQueryRefresh}
                disabled={queryRefreshing}
                style={{ height: '32px', minWidth: '32px', padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, gap: '4px', fontSize: '0.75rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                title="刷新查询列表"
              >
                <RefreshCw size={13} style={{ animation: queryRefreshing ? 'spin 1s linear infinite' : 'none', flexShrink: 0 }} />
                {queryInterval > 0 && !queryRefreshing && (
                  <span style={{ color: 'var(--text-tertiary)' }}>{countdown}s</span>
                )}
              </button>
            </div>
          </div>

          {filteredQueries.length === 0 ? (
            <div className="empty-state">
              <Database size={36} />
              <div className="empty-state-text">{queries.length === 0 ? '暂无运行中的查询' : '无匹配的查询'}</div>
              {queries.length > 0 && (
                <button className="btn btn-secondary btn-sm" style={{ marginTop: '8px' }} onClick={() => { setCommandFilter('all'); setUserFilter('all'); }}>
                  <Filter size={13} /> 清除筛选
                </button>
              )}
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>ID</th><th>用户</th><th>数据库</th><th>命令</th><th>耗时(s)</th><th>状态</th><th>SQL</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueries.map((q, i) => (
                    <tr key={i}>
                      <td>{q.Id}</td>
                      <td><span className="flex items-center gap-2"><Users size={14} />{q.User}</span></td>
                      <td>{q.Db || '-'}</td>
                      <td><span className={`badge ${q.Command === 'Query' ? 'badge-info' : 'badge-neutral'}`}>{q.Command}</span></td>
                      <td><span className="flex items-center gap-2"><Clock size={14} />{q.Time}</span></td>
                      <td className="text-xs truncate" style={{ maxWidth: '150px' }}>{q.State || '-'}</td>
                      <td className="text-mono text-xs truncate" style={{ maxWidth: '300px' }}>{q.Info || '-'}</td>
                      <td>
                        {q.Command !== 'Daemon' && (
                          <button className="btn btn-danger btn-sm" onClick={() => setKillConfirm(q.Id!)} title="终止查询">
                            <XCircle size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <ConfirmModal
        open={killConfirm !== null}
        title="终止查询"
        message={`确定要终止查询 #${killConfirm} 吗？`}
        confirmText="终止"
        onConfirm={() => killConfirm !== null && handleKillQuery(killConfirm)}
        onCancel={() => setKillConfirm(null)}
      />
    </>
  );
}
