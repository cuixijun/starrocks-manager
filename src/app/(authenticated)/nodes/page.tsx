'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  RefreshCw, Server, Plus, Trash2, X, Cpu, HardDrive,
  Activity, Clock, AlertTriangle,
} from 'lucide-react';

type NodeTab = 'fe' | 'cn';

const str = (v: unknown) => String(v ?? '');

function StatusDot({ alive }: { alive: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
      backgroundColor: alive ? 'var(--success-500)' : 'var(--danger-500)',
      boxShadow: alive ? '0 0 6px rgba(22,163,74,0.5)' : '0 0 6px rgba(239,68,68,0.5)',
    }} />
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '100px' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '3px', backgroundColor: 'var(--bg-tertiary)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: '3px', backgroundColor: color, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color, minWidth: '40px', textAlign: 'right' }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function NodesPage() {
  const { session } = useSession();
  const [tab, setTab] = useState<NodeTab>('fe');
  const [frontends, setFrontends] = useState<Record<string, unknown>[]>([]);
  const [computeNodes, setComputeNodes] = useState<Record<string, unknown>[]>([]);
  const [backends, setBackends] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ host: '', port: '', nodeType: 'cn' as string });

  const fetchNodes = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/nodes?sessionId=${encodeURIComponent(session.sessionId)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setFrontends(data.frontends || []);
        setComputeNodes(data.computeNodes || []);
        setBackends(data.backends || []);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchNodes(); }, [session, fetchNodes]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); } }, [success]);

  async function handleAdd() {
    if (!session || !addForm.host || !addForm.port) return;
    try {
      const res = await fetch('/api/nodes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'add', nodeType: addForm.nodeType, host: addForm.host, port: addForm.port }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess('节点添加成功'); setShowAdd(false); setAddForm({ host: '', port: '', nodeType: 'cn' }); fetchNodes(true); }
    } catch (err) { setError(String(err)); }
  }

  async function handleDrop(nodeType: string, host: string, port: string) {
    if (!session || !confirm(`确定要移除节点 ${host}:${port} 吗？`)) return;
    try {
      const res = await fetch('/api/nodes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'drop', nodeType, host, port }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess('节点已移除'); fetchNodes(true); }
    } catch (err) { setError(String(err)); }
  }

  async function handleDecommission(nodeType: string, host: string, port: string) {
    if (!session || !confirm(`确定要下线（Decommission）节点 ${host}:${port} 吗？此操作将迁移数据后再下线。`)) return;
    try {
      const res = await fetch('/api/nodes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'decommission', nodeType, host, port }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess('下线指令已发送'); fetchNodes(true); }
    } catch (err) { setError(String(err)); }
  }

  const feAlive = frontends.filter(f => str(f['Alive']).toLowerCase() === 'true').length;
  const cnAlive = computeNodes.filter(c => str(c['Alive']).toLowerCase() === 'true').length;

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">节点管理</h1>
            <p className="page-description">
              管理集群 FE / CN 节点 ·
              <span style={{ marginLeft: '8px' }}>
                <span style={{ color: feAlive === frontends.length ? 'var(--success-600)' : 'var(--warning-600)' }}>FE {feAlive}/{frontends.length}</span>
                <span style={{ margin: '0 6px', color: 'var(--text-tertiary)' }}>·</span>
                <span style={{ color: cnAlive === computeNodes.length ? 'var(--success-600)' : 'var(--warning-600)' }}>CN {cnAlive}/{computeNodes.length}</span>
                {backends.length > 0 && (
                  <>
                    <span style={{ margin: '0 6px', color: 'var(--text-tertiary)' }}>·</span>
                    <span>BE {backends.length}</span>
                  </>
                )}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => fetchNodes(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={16} /> 添加节点
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>{error}</div>}
        {success && <div className="toast toast-success">{success}</div>}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '20px', borderBottom: '2px solid var(--border-primary)' }}>
          {[
            { key: 'fe' as const, label: `FE 节点 (${frontends.length})`, icon: <Server size={14} /> },
            { key: 'cn' as const, label: `CN 节点 (${computeNodes.length})`, icon: <Cpu size={14} /> },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '10px 22px', fontSize: '0.85rem', fontWeight: 600,
              border: 'none', borderBottom: `2px solid ${tab === t.key ? 'var(--primary-500)' : 'transparent'}`,
              background: 'none', cursor: 'pointer', marginBottom: '-2px',
              color: tab === t.key ? 'var(--primary-600)' : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : tab === 'fe' ? (
          /* FE Nodes */
          frontends.length === 0 ? (
            <div className="empty-state"><Server size={48} /><div className="empty-state-text">暂无 FE 节点</div></div>
          ) : (
            <div className="table-container fade-in" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th style={{ width: '44px', textAlign: 'center' }}>#</th>
                    <th style={{ minWidth: '130px' }}>IP</th>
                    <th style={{ minWidth: '80px' }}>角色</th>
                    <th style={{ minWidth: '60px' }}>状态</th>
                    <th>Query 端口</th>
                    <th>HTTP 端口</th>
                    <th>EditLog 端口</th>
                    <th style={{ minWidth: '100px' }}>版本</th>
                    <th style={{ minWidth: '130px' }}>启动时间</th>
                    <th style={{ minWidth: '130px' }}>最后心跳</th>
                    <th>Helper</th>
                    <th style={{ minWidth: '100px' }}>错误信息</th>
                    <th style={{ textAlign: 'center', width: '64px' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {frontends.map((fe, idx) => {
                    const ip = str(fe['IP']);
                    const role = str(fe['Role']);
                    const alive = str(fe['Alive']).toLowerCase() === 'true';
                    const isLeader = role === 'LEADER';
                    const editLogPort = str(fe['EditLogPort']);

                    return (
                      <tr key={idx}>
                        <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{idx + 1}</td>
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '30px', height: '30px', borderRadius: 'var(--radius-md)',
                              backgroundColor: isLeader ? 'rgba(234,179,8,0.1)' : 'rgba(37,99,235,0.08)',
                              color: isLeader ? 'var(--warning-600)' : 'var(--primary-600)',
                              border: `1px solid ${isLeader ? 'rgba(234,179,8,0.25)' : 'rgba(37,99,235,0.2)'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              <Server size={14} />
                            </div>
                            <code style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{ip}</code>
                          </div>
                        </td>
                        <td>
                          <span style={{
                            padding: '3px 10px', borderRadius: '999px', fontSize: '0.73rem', fontWeight: 700,
                            backgroundColor: isLeader ? 'rgba(234,179,8,0.1)' : 'rgba(37,99,235,0.08)',
                            color: isLeader ? 'var(--warning-600)' : 'var(--primary-600)',
                            border: `1px solid ${isLeader ? 'rgba(234,179,8,0.25)' : 'rgba(37,99,235,0.2)'}`,
                          }}>
                            {role}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <StatusDot alive={alive} />
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: alive ? 'var(--success-600)' : 'var(--danger-500)' }}>{alive ? '在线' : '离线'}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.82rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>{str(fe['QueryPort'])}</td>
                        <td style={{ fontSize: '0.82rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>{str(fe['HttpPort'])}</td>
                        <td style={{ fontSize: '0.82rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>{editLogPort}</td>
                        <td><span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, backgroundColor: 'rgba(139,92,246,0.08)', color: 'var(--accent-600)', border: '1px solid rgba(139,92,246,0.2)' }}>{str(fe['Version'])}</span></td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{str(fe['StartTime'])}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{str(fe['LastHeartbeat'])}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{str(fe['IsHelper']) === 'true' ? '✓' : '—'}</td>
                        <td>
                          {str(fe['ErrMsg']) ? (
                            <span style={{ fontSize: '0.72rem', color: 'var(--danger-500)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <AlertTriangle size={12} /> {str(fe['ErrMsg'])}
                            </span>
                          ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {!isLeader && (
                            <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger-500)' }} onClick={() => handleDrop('fe', ip, editLogPort)} title="移除节点">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-secondary)', fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>共 <strong style={{ color: 'var(--text-secondary)' }}>{frontends.length}</strong> 个 FE 节点</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> SHOW FRONTENDS</span>
              </div>
            </div>
          )
        ) : (
          /* CN Nodes */
          computeNodes.length === 0 ? (
            <div className="empty-state"><Cpu size={48} /><div className="empty-state-text">暂无 CN 节点</div></div>
          ) : (
            <>
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                {[
                  { label: '总节点', value: computeNodes.length, icon: <Server size={18} />, color: 'var(--primary-600)', bg: 'rgba(37,99,235,0.08)' },
                  { label: '在线', value: cnAlive, icon: <Activity size={18} />, color: 'var(--success-600)', bg: 'rgba(22,163,74,0.08)' },
                  { label: '总 CPU 核', value: computeNodes.reduce((s, c) => s + (parseInt(str(c['CpuCores'])) || 0), 0), icon: <Cpu size={18} />, color: 'var(--accent-600)', bg: 'rgba(139,92,246,0.08)' },
                  { label: '运行中查询', value: computeNodes.reduce((s, c) => s + (parseInt(str(c['NumRunningQueries'])) || 0), 0), icon: <Activity size={18} />, color: 'var(--warning-600)', bg: 'rgba(234,179,8,0.08)' },
                  { label: '总 Tablets', value: computeNodes.reduce((s, c) => s + (parseInt(str(c['TabletNum'])) || 0), 0).toLocaleString(), icon: <HardDrive size={18} />, color: 'var(--primary-600)', bg: 'rgba(37,99,235,0.08)' },
                ].map((card, i) => (
                  <div key={i} style={{
                    padding: '14px 18px', borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                    display: 'flex', alignItems: 'center', gap: '12px',
                  }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: 'var(--radius-md)',
                      backgroundColor: card.bg, color: card.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {card.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>{card.label}</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: card.color }}>{card.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="table-container fade-in" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', tableLayout: 'auto' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '44px', textAlign: 'center' }}>#</th>
                      <th style={{ minWidth: '130px' }}>IP</th>
                      <th style={{ minWidth: '60px' }}>状态</th>
                      <th style={{ minWidth: '60px' }}>CPU</th>
                      <th style={{ minWidth: '120px' }}>内存使用</th>
                      <th style={{ minWidth: '120px' }}>CPU 使用</th>
                      <th style={{ minWidth: '70px' }}>内存限制</th>
                      <th style={{ minWidth: '60px' }}>查询数</th>
                      <th style={{ minWidth: '60px' }}>Tablets</th>
                      <th style={{ minWidth: '100px' }}>版本</th>
                      <th style={{ minWidth: '130px' }}>启动时间</th>
                      <th style={{ minWidth: '130px' }}>最后心跳</th>
                      <th style={{ minWidth: '100px' }}>错误信息</th>
                      <th style={{ textAlign: 'center', width: '80px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computeNodes.map((cn, idx) => {
                      const ip = str(cn['IP']);
                      const alive = str(cn['Alive']).toLowerCase() === 'true';
                      const cpuCores = parseInt(str(cn['CpuCores'])) || 0;
                      const memPct = parseFloat(str(cn['MemUsedPct']).replace(/\s*%/, '')) || 0;
                      const cpuPct = parseFloat(str(cn['CpuUsedPct']).replace(/\s*%/, '')) || 0;
                      const memLimit = str(cn['MemLimit']);
                      const queries = parseInt(str(cn['NumRunningQueries'])) || 0;
                      const tablets = parseInt(str(cn['TabletNum'])) || 0;
                      const heartbeatPort = str(cn['HeartbeatPort']);
                      const decommissioned = str(cn['SystemDecommissioned']).toLowerCase() === 'true';

                      return (
                        <tr key={idx} style={decommissioned ? { opacity: 0.5 } : undefined}>
                          <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{idx + 1}</td>
                          <td>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{
                                width: '30px', height: '30px', borderRadius: 'var(--radius-md)',
                                backgroundColor: alive ? 'rgba(22,163,74,0.08)' : 'rgba(239,68,68,0.08)',
                                color: alive ? 'var(--success-600)' : 'var(--danger-500)',
                                border: `1px solid ${alive ? 'rgba(22,163,74,0.2)' : 'rgba(239,68,68,0.2)'}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              }}>
                                <Cpu size={14} />
                              </div>
                              <div>
                                <code style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{ip}</code>
                                {decommissioned && <div style={{ fontSize: '0.68rem', color: 'var(--warning-600)', fontWeight: 600 }}>DECOMMISSIONING</div>}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <StatusDot alive={alive} />
                              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: alive ? 'var(--success-600)' : 'var(--danger-500)' }}>{alive ? '在线' : '离线'}</span>
                            </div>
                          </td>
                          <td style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'center' }}>{cpuCores}</td>
                          <td><ProgressBar pct={memPct} color={memPct > 80 ? 'var(--danger-500)' : memPct > 60 ? 'var(--warning-600)' : 'var(--success-600)'} /></td>
                          <td><ProgressBar pct={cpuPct} color={cpuPct > 80 ? 'var(--danger-500)' : cpuPct > 60 ? 'var(--warning-600)' : 'var(--success-600)'} /></td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{memLimit}</td>
                          <td style={{ textAlign: 'center', fontSize: '0.85rem', fontWeight: 600, color: queries > 0 ? 'var(--primary-600)' : 'var(--text-tertiary)' }}>{queries}</td>
                          <td style={{ textAlign: 'right', fontSize: '0.85rem', fontWeight: 600 }}>{tablets.toLocaleString()}</td>
                          <td><span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, backgroundColor: 'rgba(139,92,246,0.08)', color: 'var(--accent-600)', border: '1px solid rgba(139,92,246,0.2)' }}>{str(cn['Version'])}</span></td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{str(cn['LastStartTime'])}</td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{str(cn['LastHeartbeat'])}</td>
                          <td>
                            {str(cn['ErrMsg']) ? (
                              <span style={{ fontSize: '0.72rem', color: 'var(--danger-500)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <AlertTriangle size={12} /> {str(cn['ErrMsg'])}
                              </span>
                            ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '2px', justifyContent: 'center' }}>
                              {!decommissioned && (
                                <button className="btn btn-ghost btn-icon" style={{ color: 'var(--warning-600)' }} onClick={() => handleDecommission('cn', ip, heartbeatPort)} title="安全下线 (Decommission)">
                                  <AlertTriangle size={14} />
                                </button>
                              )}
                              <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger-500)' }} onClick={() => handleDrop('cn', ip, heartbeatPort)} title="移除节点">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-secondary)', fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>共 <strong style={{ color: 'var(--text-secondary)' }}>{computeNodes.length}</strong> 个 CN 节点</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> SHOW COMPUTE NODES</span>
                </div>
              </div>
            </>
          )
        )}

        {/* Add Node Modal */}
        {showAdd && (
          <div className="modal-overlay" onClick={() => setShowAdd(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
              <div className="modal-header">
                <div className="modal-title">添加节点</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowAdd(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">节点类型</label>
                  <select className="input" value={addForm.nodeType} onChange={e => setAddForm({ ...addForm, nodeType: e.target.value })}>
                    <option value="cn">CN (Compute Node)</option>
                    <option value="be">BE (Backend)</option>
                    <option value="fe_follower">FE Follower</option>
                    <option value="fe_observer">FE Observer</option>
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">主机 IP <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                    <input className="input" placeholder="10.0.0.1" value={addForm.host} onChange={e => setAddForm({ ...addForm, host: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">端口 <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                    <input className="input" placeholder={addForm.nodeType.startsWith('fe') ? '9010' : '9050'} value={addForm.port} onChange={e => setAddForm({ ...addForm, port: e.target.value })} />
                  </div>
                </div>
                <div style={{ marginTop: '8px', padding: '10px 14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: '4px' }}>SQL 预览</div>
                  <code style={{ fontSize: '0.78rem', color: 'var(--primary-600)', fontFamily: "'JetBrains Mono', monospace" }}>
                    ALTER SYSTEM ADD {addForm.nodeType === 'fe_follower' ? 'FOLLOWER' : addForm.nodeType === 'fe_observer' ? 'OBSERVER' : addForm.nodeType === 'cn' ? 'COMPUTE NODE' : 'BACKEND'} &quot;{addForm.host || '...'}:{addForm.port || '...'}&quot;
                  </code>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleAdd} disabled={!addForm.host || !addForm.port}>
                  <Plus size={16} /> 添加
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
