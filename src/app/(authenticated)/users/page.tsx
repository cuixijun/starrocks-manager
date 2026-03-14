'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  Users, Plus, Trash2, RefreshCw, Search, X,
  ChevronUp, ChevronDown, ChevronsUpDown, Clock, Key, ShieldCheck, ChevronRight
} from 'lucide-react';

interface UserEntry {
  identity: string;   // e.g. 'root'@'%'
  grants: string[];
}

type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />;
  return dir === 'asc'
    ? <ChevronUp size={12} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={12} style={{ color: 'var(--primary-500)' }} />;
}

/** Parse 'username'@'host' into { user, host } */
function parseIdentity(identity: string): { user: string; host: string } {
  const m = identity.match(/^['`]?([^'`@]+)['`]?@['`]?([^'`]*)['`]?$/);
  if (m) return { user: m[1], host: m[2] };
  return { user: identity, host: '%' };
}

const DEFAULT_FORM = { username: '', host: '%', password: '', roles: '' };

export default function UsersPage() {
  const { session } = useSession();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [expandedGrants, setExpandedGrants] = useState<Set<string>>(new Set());
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchUsers = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/users?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setUsers(data.users || []);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchUsers(); }, [session, fetchUsers]);
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  async function handleCreate() {
    if (!session || !form.username) return;
    setCreating(true); setError('');
    try {
      const roles = form.roles ? form.roles.split(',').map(r => r.trim()).filter(Boolean) : [];
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          username: form.username,
          host: form.host,
          password: form.password,
          roles,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setShowCreate(false); setForm(DEFAULT_FORM); setSuccess('用户创建成功'); fetchUsers(); }
    } catch (err) { setError(String(err)); }
    finally { setCreating(false); }
  }

  async function handleDelete(identity: string) {
    if (!session || !confirm(`确定要删除用户 ${identity} 吗？`)) return;
    const { user, host } = parseIdentity(identity);
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, username: user, host }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess('用户已删除'); fetchUsers(); }
    } catch (err) { setError(String(err)); }
  }

  function toggleGrants(identity: string) {
    setExpandedGrants(prev => {
      const next = new Set(prev);
      if (next.has(identity)) next.delete(identity); else next.add(identity);
      return next;
    });
  }

  const SYSTEM_USERS = new Set(['root', 'starrocks']);

  const filtered = users
    .filter(u => u.identity.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortDir === 'asc'
      ? a.identity.localeCompare(b.identity)
      : b.identity.localeCompare(a.identity)
    );

  const systemCount = filtered.filter(u => SYSTEM_USERS.has(parseIdentity(u.identity).user)).length;
  const customCount = filtered.length - systemCount;

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">用户管理</h1>
            <p className="page-description">
              管理 StarRocks 数据库用户 · {users.length} 个用户
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => fetchUsers(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> 创建用户
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
          <input
            className="input"
            placeholder="搜索用户名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><Users size={48} /><div className="empty-state-text">暂无用户</div></div>
        ) : (
          <div className="table-container fade-in">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '44px', textAlign: 'center' }}>#</th>
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      用户名 <SortIcon active dir={sortDir} />
                    </span>
                  </th>
                  <th>主机</th>
                  <th>类型</th>
                  <th>权限授权</th>
                  <th style={{ textAlign: 'center', width: '72px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, idx) => {
                  const { user, host } = parseIdentity(u.identity);
                  const isSystem = SYSTEM_USERS.has(user);
                  const isExpanded = expandedGrants.has(u.identity);
                  const grantCount = u.grants.length;

                  // Extract role-like grants for display
                  const shortGrants = u.grants
                    .map(g => {
                      const roleMatch = g.match(/GRANT\s+['`]?([^'`\s,]+)['`]?\s+TO/i);
                      const privMatch = g.match(/GRANT\s+([A-Z_,\s]+?)\s+ON/i);
                      if (roleMatch) return { type: 'role', label: roleMatch[1] };
                      if (privMatch) return { type: 'priv', label: privMatch[1].trim().split(',')[0].trim() + (privMatch[1].includes(',') ? '...' : '') };
                      return { type: 'other', label: g.slice(0, 40) };
                    });

                  return (
                    <tr key={u.identity}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{idx + 1}</td>

                      {/* Username */}
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '30px', height: '30px', borderRadius: 'var(--radius-md)',
                            backgroundColor: isSystem ? 'rgba(139,92,246,0.1)' : 'rgba(37,99,235,0.08)',
                            color: isSystem ? 'var(--accent-600)' : 'var(--primary-600)',
                            border: `1px solid ${isSystem ? 'rgba(139,92,246,0.2)' : 'rgba(37,99,235,0.2)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <Users size={14} />
                          </div>
                          <code style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                            {user}
                          </code>
                        </div>
                      </td>

                      {/* Host */}
                      <td>
                        <code style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)', padding: '2px 7px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                          {host || '%'}
                        </code>
                      </td>

                      {/* Type */}
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '3px 10px', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 600,
                          backgroundColor: isSystem ? 'rgba(139,92,246,0.08)' : 'var(--bg-secondary)',
                          color: isSystem ? 'var(--accent-600)' : 'var(--text-secondary)',
                          border: `1px solid ${isSystem ? 'rgba(139,92,246,0.2)' : 'var(--border-secondary)'}`,
                        }}>
                          {isSystem ? '● 系统用户' : '● 普通用户'}
                        </span>
                      </td>

                      {/* Grants */}
                      <td>
                        {grantCount === 0 ? (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>无权限</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {(isExpanded ? shortGrants : shortGrants.slice(0, 3)).map((g, i) => (
                                <span key={i} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                                  padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 500,
                                  backgroundColor: g.type === 'role' ? 'rgba(22,163,74,0.08)' : 'rgba(37,99,235,0.08)',
                                  color: g.type === 'role' ? 'var(--success-600)' : 'var(--primary-600)',
                                  border: `1px solid ${g.type === 'role' ? 'rgba(22,163,74,0.2)' : 'rgba(37,99,235,0.2)'}`,
                                  maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {g.type === 'role' ? <ShieldCheck size={10} /> : <Key size={10} />}
                                  {g.label}
                                </span>
                              ))}
                              {!isExpanded && grantCount > 3 && (
                                <button
                                  onClick={() => toggleGrants(u.identity)}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                    padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 500,
                                    backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                                    border: '1px solid var(--border-secondary)', cursor: 'pointer',
                                  }}
                                >
                                  <ChevronRight size={10} /> +{grantCount - 3} 条
                                </button>
                              )}
                            </div>
                            {isExpanded && (
                              <button
                                onClick={() => toggleGrants(u.identity)}
                                style={{ fontSize: '0.72rem', color: 'var(--primary-600)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '0' }}
                              >
                                ▲ 收起
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'center' }}>
                        {!isSystem ? (
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ color: 'var(--danger-500)' }}
                            onClick={() => handleDelete(u.identity)}
                            title="删除用户"
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
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个用户
                {search && ` (过滤自 ${users.length} 个)`}
              </span>
              <span style={{ display: 'inline-flex', gap: '12px' }}>
                <span style={{ color: 'var(--accent-600)' }}>系统 {systemCount}</span>
                <span style={{ color: 'var(--primary-600)' }}>普通 {customCount}</span>
              </span>
            </div>
          </div>
        )}

        {/* Create User Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">创建用户</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowCreate(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">用户名 <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                    <input className="input" placeholder="username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">主机</label>
                    <input className="input" placeholder="%" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">密码</label>
                  <input className="input" type="password" placeholder="（留空则不设密码）" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">授予角色（逗号分隔，可选）</label>
                  <input className="input" placeholder="role1, role2" value={form.roles} onChange={e => setForm({ ...form, roles: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !form.username}>
                  {creating ? <span className="spinner" /> : <Plus size={16} />} 创建
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
