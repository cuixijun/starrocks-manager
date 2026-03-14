'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
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
} from 'lucide-react';

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
  const { session } = useSession();
  const [frontends, setFrontends] = useState<NodeInfo[]>([]);
  const [backends, setBackends] = useState<NodeInfo[]>([]);
  const [computeNodes, setComputeNodes] = useState<NodeInfo[]>([]);
  const [queries, setQueries] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!session) return;
    try {
      const [clusterRes, queryRes] = await Promise.all([
        fetch(`/api/cluster?sessionId=${encodeURIComponent(session.sessionId)}`),
        fetch(`/api/queries?sessionId=${encodeURIComponent(session.sessionId)}`),
      ]);
      const cluster = await clusterRes.json();
      const queryData = await queryRes.json();

      if (cluster.error) setError(cluster.error);
      else {
        setFrontends(cluster.frontends || []);
        setBackends(cluster.backends || []);
        setComputeNodes(cluster.computeNodes || []);
      }
      setQueries(queryData.queries || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  function handleRefresh() {
    setRefreshing(true);
    fetchData();
  }

  async function handleKillQuery(id: string | number) {
    if (!session || !confirm('确定要终止这个查询吗？')) return;
    try {
      await fetch('/api/queries', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, queryId: id }),
      });
      fetchData();
    } catch { /* ignore */ }
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

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1 className="page-title">仪表盘</h1>
        </div>
        <div className="page-body">
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        </div>
      </>
    );
  }

  const totalNodes = frontends.length + backends.length + computeNodes.length;
  const aliveNodes = [...frontends, ...backends, ...computeNodes].filter(isAlive).length;
  const activeQueries = queries.filter(q => q.Command !== 'Sleep' && q.Command !== 'Daemon').length;

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">仪表盘</h1>
            <p className="page-description">集群概览 · {session?.host}:{session?.port}</p>
          </div>
          <button className="btn btn-secondary" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'animate-pulse' : ''} />
            刷新
          </button>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            {error}
          </div>
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
            <div className="stat-card-label">BE/CN 节点</div>
            <div className="stat-card-value">{backends.length + computeNodes.length}</div>
            <div className="stat-card-detail">BE {backends.length} + CN {computeNodes.length}</div>
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
                    <th>名称</th>
                    <th>IP</th>
                    <th>端口</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>版本</th>
                    <th>最后心跳</th>
                  </tr>
                </thead>
                <tbody>
                  {frontends.map((fe, i) => (
                    <tr key={i}>
                      <td className="text-mono">{getNodeValue(fe, 'Name', 'name')}</td>
                      <td className="text-mono">{getNodeValue(fe, 'IP', 'Host', 'ip', 'host')}</td>
                      <td>{getNodeValue(fe, 'EditLogPort', 'HttpPort', 'QueryPort')}</td>
                      <td>
                        <span className={`badge ${getNodeValue(fe, 'Role', 'role') === 'LEADER' ? 'badge-info' : 'badge-neutral'}`}>
                          {getNodeValue(fe, 'Role', 'role', 'IsMaster')}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${isAlive(fe) ? 'badge-success' : 'badge-danger'}`}>
                          <span className={`badge-dot ${isAlive(fe) ? 'green' : 'red'}`} />
                          {isAlive(fe) ? '在线' : '离线'}
                        </span>
                      </td>
                      <td className="text-xs">{getNodeValue(fe, 'Version', 'version')}</td>
                      <td className="text-xs">{getNodeValue(fe, 'LastHeartbeat', 'LastStartTime')}</td>
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
                  <tr>
                    <th>ID</th>
                    <th>IP</th>
                    <th>端口</th>
                    <th>状态</th>
                    <th>Tablet 数量</th>
                    <th>已用空间</th>
                    <th>总空间</th>
                    <th>最后心跳</th>
                  </tr>
                </thead>
                <tbody>
                  {backends.map((be, i) => (
                    <tr key={i}>
                      <td>{getNodeValue(be, 'BackendId', 'ID', 'id')}</td>
                      <td className="text-mono">{getNodeValue(be, 'IP', 'Host', 'ip', 'host')}</td>
                      <td>{getNodeValue(be, 'HeartbeatPort', 'BePort')}</td>
                      <td>
                        <span className={`badge ${isAlive(be) ? 'badge-success' : 'badge-danger'}`}>
                          <span className={`badge-dot ${isAlive(be) ? 'green' : 'red'}`} />
                          {isAlive(be) ? '在线' : '离线'}
                        </span>
                      </td>
                      <td>{getNodeValue(be, 'TabletNum', 'NumTablets')}</td>
                      <td>{getNodeValue(be, 'UsedCapacity', 'DataUsedCapacity')}</td>
                      <td>{getNodeValue(be, 'TotalCapacity')}</td>
                      <td className="text-xs">{getNodeValue(be, 'LastHeartbeat', 'LastStartTime')}</td>
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
                  <tr>
                    <th>ID</th>
                    <th>IP</th>
                    <th>端口</th>
                    <th>状态</th>
                    <th>CPU 核数</th>
                    <th>内存</th>
                    <th>最后心跳</th>
                  </tr>
                </thead>
                <tbody>
                  {computeNodes.map((cn, i) => (
                    <tr key={i}>
                      <td>{getNodeValue(cn, 'ComputeNodeId', 'ID', 'id')}</td>
                      <td className="text-mono">{getNodeValue(cn, 'IP', 'Host', 'ip', 'host')}</td>
                      <td>{getNodeValue(cn, 'HeartbeatPort', 'BePort')}</td>
                      <td>
                        <span className={`badge ${isAlive(cn) ? 'badge-success' : 'badge-danger'}`}>
                          <span className={`badge-dot ${isAlive(cn) ? 'green' : 'red'}`} />
                          {isAlive(cn) ? '在线' : '离线'}
                        </span>
                      </td>
                      <td>{getNodeValue(cn, 'CpuCores', 'NumCPUCores')}</td>
                      <td>{getNodeValue(cn, 'MemUsedPct', 'MemUsage')}</td>
                      <td className="text-xs">{getNodeValue(cn, 'LastHeartbeat', 'LastStartTime')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Running Queries */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">
                <Activity size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                运行中查询
              </div>
              <div className="card-subtitle">{queries.length} 个连接</div>
            </div>
          </div>
          {queries.length === 0 ? (
            <div className="empty-state">
              <Database size={36} />
              <div className="empty-state-text">暂无运行中的查询</div>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>用户</th>
                    <th>数据库</th>
                    <th>命令</th>
                    <th>耗时(s)</th>
                    <th>状态</th>
                    <th>SQL</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q, i) => (
                    <tr key={i}>
                      <td>{q.Id}</td>
                      <td>
                        <span className="flex items-center gap-2">
                          <Users size={14} />
                          {q.User}
                        </span>
                      </td>
                      <td>{q.Db || '-'}</td>
                      <td>
                        <span className={`badge ${q.Command === 'Query' ? 'badge-info' : 'badge-neutral'}`}>
                          {q.Command}
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <Clock size={14} />
                          {q.Time}
                        </span>
                      </td>
                      <td className="text-xs truncate" style={{ maxWidth: '150px' }}>{q.State || '-'}</td>
                      <td className="text-mono text-xs truncate" style={{ maxWidth: '300px' }}>
                        {q.Info || '-'}
                      </td>
                      <td>
                        {q.Command !== 'Daemon' && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleKillQuery(q.Id!)}
                            title="终止查询"
                          >
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
    </>
  );
}
