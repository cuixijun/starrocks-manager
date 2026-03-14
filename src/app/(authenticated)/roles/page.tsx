'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  ShieldCheck, Plus, Trash2, RefreshCw, Search, X,
  UserPlus, UserMinus, ChevronUp, ChevronDown, ChevronsUpDown, Clock
} from 'lucide-react';

type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={13} style={{ opacity: 0.35 }} />;
  return dir === 'asc'
    ? <ChevronUp size={13} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={13} style={{ color: 'var(--primary-500)' }} />;
}

const SYSTEM_ROLES = new Set(['root', 'cluster_admin', 'db_admin', 'user_admin', 'public']);

export default function RolesPage() {
  const { session } = useSession();
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showGrant, setShowGrant] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [grantForm, setGrantForm] = useState({ roleName: '', userName: '', userHost: '%', action: 'grant' as 'grant' | 'revoke' });
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRoles = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/roles?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const names: string[] = (data.roles || []).map((r: Record<string, unknown>) =>
          String(r['Name'] || r['name'] || r['Value'] || Object.values(r)[0] || '')
        );
        setRoles(names);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchRoles(); }, [session, fetchRoles]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  async function handleCreateRole() {
    if (!session || !newRole) return;
    setError('');
    try {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'create', roleName: newRole }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setShowCreate(false); setNewRole(''); setSuccess('角色创建成功'); fetchRoles(); }
    } catch (err) { setError(String(err)); }
  }

  async function handleDeleteRole(name: string) {
    if (!session || !confirm(`确定要删除角色 '${name}' 吗？`)) return;
    try {
      const res = await fetch('/api/roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, roleName: name }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else fetchRoles();
    } catch (err) { setError(String(err)); }
  }

  async function handleGrantRevoke() {
    if (!session || !grantForm.roleName || !grantForm.userName) return;
    setError('');
    try {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          action: grantForm.action,
          roleName: grantForm.roleName,
          userName: grantForm.userName,
          userHost: grantForm.userHost,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setShowGrant(false);
        setSuccess(grantForm.action === 'grant' ? '角色授予成功' : '角色撤销成功');
        setGrantForm({ roleName: '', userName: '', userHost: '%', action: 'grant' });
        fetchRoles();
      }
    } catch (err) { setError(String(err)); }
  }

  const filtered = roles
    .filter(name => name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a));

  const systemCount = filtered.filter(n => SYSTEM_ROLES.has(n)).length;
  const customCount = filtered.length - systemCount;

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">角色管理</h1>
            <p className="page-description">
              管理 StarRocks 角色 · {roles.length} 个角色
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => fetchRoles(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowGrant(true)}>
              <UserPlus size={16} /> 分配角色
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> 创建角色
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}
        {success && <div className="toast toast-success">{success}</div>}

        <div className="search-bar mb-4">
          <Search />
          <input className="input" placeholder="搜索角色..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><ShieldCheck size={48} /><div className="empty-state-text">暂无角色</div></div>
        ) : (
          <div className="table-container fade-in">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '48px', textAlign: 'center' }}>#</th>
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      角色名称 <SortIcon active dir={sortDir} />
                    </span>
                  </th>
                  <th>类型</th>
                  <th style={{ textAlign: 'center', width: '80px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((name, idx) => {
                  const isSystem = SYSTEM_ROLES.has(name);
                  return (
                    <tr key={name}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{idx + 1}</td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '30px', height: '30px', borderRadius: 'var(--radius-md)',
                            backgroundColor: isSystem ? 'rgba(139,92,246,0.1)' : 'var(--primary-50)',
                            color: isSystem ? 'var(--accent-600)' : 'var(--primary-600)',
                            border: `1px solid ${isSystem ? 'rgba(139,92,246,0.2)' : 'var(--primary-100)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <ShieldCheck size={14} />
                          </div>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{name}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
                          backgroundColor: isSystem ? 'rgba(139,92,246,0.08)' : 'var(--bg-secondary)',
                          color: isSystem ? 'var(--accent-600)' : 'var(--text-secondary)',
                          border: `1px solid ${isSystem ? 'rgba(139,92,246,0.2)' : 'var(--border-secondary)'}`,
                        }}>
                          {isSystem ? '● 系统角色' : '● 自定义角色'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {!isSystem ? (
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ color: 'var(--danger-500)' }}
                            onClick={() => handleDeleteRole(name)}
                            title="删除角色"
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--border-secondary)',
              fontSize: '0.78rem', color: 'var(--text-tertiary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个角色
                {search && ` (过滤自 ${roles.length} 个)`}
              </span>
              <span style={{ display: 'inline-flex', gap: '12px' }}>
                <span style={{ color: 'var(--accent-600)' }}>系统 {systemCount}</span>
                <span style={{ color: 'var(--primary-600)' }}>自定义 {customCount}</span>
              </span>
            </div>
          </div>
        )}

        {/* Create Role Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">创建角色</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowCreate(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">角色名称</label>
                  <input className="input" placeholder="role_name" value={newRole} onChange={e => setNewRole(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleCreateRole} disabled={!newRole}>
                  <Plus size={16} /> 创建
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grant/Revoke Modal */}
        {showGrant && (
          <div className="modal-overlay" onClick={() => setShowGrant(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">分配 / 撤销角色</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowGrant(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">操作</label>
                  <select className="input" value={grantForm.action} onChange={e => setGrantForm({ ...grantForm, action: e.target.value as 'grant' | 'revoke' })}>
                    <option value="grant">授予 (GRANT)</option>
                    <option value="revoke">撤销 (REVOKE)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">角色名</label>
                  <input className="input" placeholder="role_name" value={grantForm.roleName} onChange={e => setGrantForm({ ...grantForm, roleName: e.target.value })} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">用户名</label>
                    <input className="input" placeholder="username" value={grantForm.userName} onChange={e => setGrantForm({ ...grantForm, userName: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">主机</label>
                    <input className="input" placeholder="%" value={grantForm.userHost} onChange={e => setGrantForm({ ...grantForm, userHost: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowGrant(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleGrantRevoke} disabled={!grantForm.roleName || !grantForm.userName}>
                  {grantForm.action === 'grant' ? <UserPlus size={16} /> : <UserMinus size={16} />}
                  {grantForm.action === 'grant' ? '授予' : '撤销'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
