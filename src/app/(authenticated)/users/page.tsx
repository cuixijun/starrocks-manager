'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePagination } from '@/hooks/usePagination';
import { Pagination } from '@/components/ui';
import PrivilegeDetailModal, { CatalogSectionBlock } from '@/components/PrivilegeDetailModal';
import { classifyGrants, type CatalogGrant } from '@/utils/grantClassifier';
import {
  Users, Plus, Trash2, RefreshCw, Search, X,
  ChevronUp, ChevronDown, ChevronsUpDown, Clock, Key, ShieldCheck, ChevronRight,
  Shield, UserPlus, Eye,
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
  // Privilege detail modal
  const [showPrivDetail, setShowPrivDetail] = useState<{ identity: string; grants: string[]; catalogGrants?: { grant: string; catalog: string }[] } | null>(null);

  // Grant privilege modal
  const [showGrant, setShowGrant] = useState<string | null>(null); // user identity
  const [grantAction, setGrantAction] = useState<'grant_privilege' | 'revoke_privilege'>('grant_privilege');
  const [grantPriv, setGrantPriv] = useState('SELECT');
  const [grantObjType, setGrantObjType] = useState('TABLE');
  const [grantObjName, setGrantObjName] = useState('');
  // Role assignment modal
  const [showRoleAssign, setShowRoleAssign] = useState<string | null>(null);
  const [roleAction, setRoleAction] = useState<'grant_role' | 'revoke_role'>('grant_role');
  const [roleNameInput, setRoleNameInput] = useState('');
  const [allRoles, setAllRoles] = useState<string[]>([]);
  const [rolePrivCache, setRolePrivCache] = useState<Record<string, { grants: string[]; catalogGrants?: CatalogGrant[] }>>({}); 
  const [rolePrivLoading, setRolePrivLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<string>('');

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

  // Fetch all roles when the role assignment modal opens (only if not already cached)
  useEffect(() => {
    if (showRoleAssign && session) {
      setRoleNameInput('');
      setPreviewTab('');
      // Only fetch roles list if not already loaded
      if (allRoles.length === 0) {
        fetch(`/api/roles?sessionId=${encodeURIComponent(session.sessionId)}`)
          .then(r => r.json())
          .then(data => {
            if (!data.error) {
              const names: string[] = (data.roles || []).map((r: Record<string, unknown>) =>
                String(r['Name'] || r['name'] || r['Value'] || Object.values(r)[0] || '')
              );
              setAllRoles(names);
            }
          });
      }
    }
  }, [showRoleAssign, session]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function toggleRoles(identity: string) {
    setExpandedGrants(prev => {
      const next = new Set<string>();
      // Only allow ONE row expanded at a time
      if (!prev.has(identity)) next.add(identity);
      return next;
    });
  }

  const SYSTEM_USERS = new Set(['root', 'starrocks']);

  async function handleGrantPrivilege() {
    if (!session || !showGrant || !grantObjName) return;
    setError('');
    try {
      const res = await fetch('/api/grants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          action: grantAction,
          grantee: showGrant,
          privilege: grantPriv,
          objectType: grantObjType,
          objectName: grantObjName,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSuccess(`${grantAction === 'grant_privilege' ? '授权' : '撤销'}成功`);
        setShowGrant(null);
        fetchUsers(true);
      }
    } catch (err) { setError(String(err)); }
  }

  async function handleRoleAssign() {
    if (!session || !showRoleAssign || !roleNameInput) return;
    setError('');
    try {
      const res = await fetch('/api/grants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          action: roleAction,
          grantee: showRoleAssign,
          roleName: roleNameInput,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSuccess(`${roleAction === 'grant_role' ? '角色授予' : '角色撤销'}成功`);
        setShowRoleAssign(null);
        setRoleNameInput('');
        fetchUsers(true);
      }
    } catch (err) { setError(String(err)); }
  }

  const filtered = users
    .filter(u => u.identity.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aUser = parseIdentity(a.identity).user;
      const bUser = parseIdentity(b.identity).user;
      const aSystem = SYSTEM_USERS.has(aUser) ? 0 : 1;
      const bSystem = SYSTEM_USERS.has(bUser) ? 0 : 1;
      if (aSystem !== bSystem) return aSystem - bSystem;
      return sortDir === 'asc'
        ? aUser.localeCompare(bUser)
        : bUser.localeCompare(aUser);
    });

  const pg = usePagination(filtered);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pg.resetPage(); }, [search, sortDir]);

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
                  <th>角色</th>
                  <th>权限项</th>
                  <th style={{ textAlign: 'center', width: '130px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pg.paginatedData.map((u, idx) => {
                  const globalIdx = (pg.page - 1) * pg.pageSize + idx;
                  const { user, host } = parseIdentity(u.identity);
                  const isSystem = SYSTEM_USERS.has(user);
                  const isExpanded = expandedGrants.has(u.identity);

                  // Parse grants into roles and privileges
                  const roleNames: string[] = [];
                  const privEntries: string[] = [];
                  u.grants.forEach(g => {
                    const roleMatch = g.match(/GRANT\s+((?:['`][^'`]+['`](?:\s*,\s*)?)+)\s+TO/i);
                    if (roleMatch) {
                      const roles = roleMatch[1].match(/['`]([^'`]+)['`]/g) || [];
                      roles.forEach(r => roleNames.push(r.replace(/['`]/g, '')));
                      return;
                    }
                    privEntries.push(g);
                  });

                  return (
                    <tr key={u.identity}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{globalIdx + 1}</td>

                      {/* Username */}
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: 'var(--radius-md)',
                            backgroundColor: isSystem ? 'rgba(139,92,246,0.1)' : 'rgba(37,99,235,0.08)',
                            color: isSystem ? 'var(--accent-600)' : 'var(--primary-600)',
                            borderWidth: '1px', borderStyle: 'solid', borderColor: isSystem ? 'rgba(139,92,246,0.2)' : 'rgba(37,99,235,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <Users size={13} />
                          </div>
                          <code style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                            {user}
                          </code>
                        </div>
                      </td>

                      {/* Host */}
                      <td>
                        <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-secondary)' }}>
                          {host || '%'}
                        </code>
                      </td>

                      {/* Type */}
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                          backgroundColor: isSystem ? 'rgba(139,92,246,0.08)' : 'var(--bg-secondary)',
                          color: isSystem ? 'var(--accent-600)' : 'var(--text-secondary)',
                          borderWidth: '1px', borderStyle: 'solid', borderColor: isSystem ? 'rgba(139,92,246,0.2)' : 'var(--border-secondary)',
                        }}>
                          {isSystem ? '● 系统' : '● 普通'}
                        </span>
                      </td>

                      {/* Roles column */}
                      <td>
                        {roleNames.length === 0 ? (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                            {(isExpanded ? roleNames : roleNames.slice(0, 2)).map((r, i) => (
                              <span key={i} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                                padding: '1px 7px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 500,
                                backgroundColor: 'rgba(22,163,74,0.08)', color: 'var(--success-600)',
                                borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(22,163,74,0.2)',
                                maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                <ShieldCheck size={9} />{r}
                              </span>
                            ))}
                            {!isExpanded && roleNames.length > 2 && (
                              <button
                                onClick={() => toggleRoles(u.identity)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '2px',
                                  padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 500,
                                  backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                                  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-secondary)', cursor: 'pointer',
                                }}
                              >
                                +{roleNames.length - 2}
                              </button>
                            )}
                            {isExpanded && roleNames.length > 2 && (
                              <button
                                onClick={() => toggleRoles(u.identity)}
                                style={{ fontSize: '0.68rem', color: 'var(--primary-600)', background: 'none', border: 'none', cursor: 'pointer', padding: '0' }}
                              >
                                ▲
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Privileges column */}
                      <td>
                        {privEntries.length === 0 ? (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>—</span>
                        ) : (
                          <button
                            onClick={async () => {
                              try {
                                const gRes = await fetch(`/api/grants?sessionId=${encodeURIComponent(session!.sessionId)}&target=${encodeURIComponent(u.identity)}`);
                                const gData = await gRes.json();
                                setShowPrivDetail({
                                  identity: u.identity,
                                  grants: gData.grants || privEntries,
                                  catalogGrants: gData.catalogGrants,
                                });
                              } catch {
                                setShowPrivDetail({ identity: u.identity, grants: privEntries });
                              }
                            }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 500,
                              backgroundColor: 'rgba(37,99,235,0.06)', color: 'var(--primary-600)',
                              borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(37,99,235,0.15)',
                              cursor: 'pointer', transition: 'all 0.15s',
                            }}
                          >
                            <Key size={10} />{privEntries.length} 项权限
                            <Eye size={10} style={{ marginLeft: '2px', opacity: 0.6 }} />
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                          <button
                            disabled={isSystem}
                            onClick={() => !isSystem && setShowGrant(u.identity)}
                            title={isSystem ? '系统用户请通过命令行管理' : '授权'}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '3px 10px', borderRadius: '6px', fontSize: '0.75rem',
                              border: `1px solid ${isSystem ? 'var(--border-secondary)' : 'var(--primary-200)'}`,
                              backgroundColor: isSystem ? 'transparent' : 'var(--primary-50)',
                              color: isSystem ? 'var(--text-tertiary)' : 'var(--primary-600)',
                              cursor: isSystem ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s',
                              fontWeight: 500, whiteSpace: 'nowrap',
                              opacity: isSystem ? 0.4 : 1,
                            }}
                          >
                            <Shield size={12} /> 授权
                          </button>
                          <button
                            disabled={isSystem}
                            onClick={() => !isSystem && setShowRoleAssign(u.identity)}
                            title={isSystem ? '系统用户请通过命令行管理' : '分配角色'}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '3px 10px', borderRadius: '6px', fontSize: '0.75rem',
                              border: '1px solid var(--border-secondary)',
                              backgroundColor: 'transparent',
                              color: isSystem ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                              cursor: isSystem ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s',
                              fontWeight: 500, whiteSpace: 'nowrap',
                              opacity: isSystem ? 0.4 : 1,
                            }}
                          >
                            <UserPlus size={12} /> 角色
                          </button>
                          <span style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-secondary)', margin: '0 2px' }} />
                          <button
                            className="btn btn-ghost btn-icon"
                            disabled={isSystem}
                            style={{
                              color: isSystem ? 'var(--text-quaternary, #d1d5db)' : 'var(--text-tertiary)',
                              padding: '4px', borderRadius: '6px',
                              transition: 'all 0.15s',
                              opacity: isSystem ? 0.4 : 1,
                              cursor: isSystem ? 'not-allowed' : 'pointer',
                            }}
                            onClick={() => !isSystem && handleDelete(u.identity)}
                            title={isSystem ? '系统用户不可删除' : '删除用户'}
                            onMouseEnter={e => { if (!isSystem) { e.currentTarget.style.color = 'var(--danger-500)'; e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.08)'; } }}
                            onMouseLeave={e => { if (!isSystem) { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; } }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--border-secondary)',
              fontSize: '0.78rem', color: 'var(--text-tertiary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            }}>
              <span>
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个用户
                {search && ` (过滤自 ${users.length} 个)`}
                <span style={{ marginLeft: '12px', color: 'var(--accent-600)' }}>系统 {systemCount}</span>
                <span style={{ marginLeft: '8px', color: 'var(--primary-600)' }}>普通 {customCount}</span>
              </span>
              <Pagination page={pg.page} pageSize={pg.pageSize} totalPages={pg.totalPages} totalItems={pg.totalItems} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
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

        {/* Grant Privilege Modal */}
        {showGrant && (
          <div className="modal-overlay" onClick={() => setShowGrant(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
              <div className="modal-header">
                <div className="modal-title">授权 / 撤销权限 — {showGrant}</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowGrant(null)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">操作</label>
                  <select className="input" value={grantAction} onChange={e => setGrantAction(e.target.value as 'grant_privilege' | 'revoke_privilege')}>
                    <option value="grant_privilege">授予 (GRANT)</option>
                    <option value="revoke_privilege">撤销 (REVOKE)</option>
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">权限类型</label>
                    <select className="input" value={grantPriv} onChange={e => setGrantPriv(e.target.value)}>
                      <option value="ALL">ALL (全部)</option>
                      <option value="SELECT">SELECT</option>
                      <option value="INSERT">INSERT</option>
                      <option value="UPDATE">UPDATE</option>
                      <option value="DELETE">DELETE</option>
                      <option value="ALTER">ALTER</option>
                      <option value="DROP">DROP</option>
                      <option value="CREATE TABLE">CREATE TABLE</option>
                      <option value="CREATE VIEW">CREATE VIEW</option>
                      <option value="CREATE MATERIALIZED VIEW">CREATE MV</option>
                      <option value="USAGE">USAGE</option>
                      <option value="IMPERSONATE">IMPERSONATE</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">对象类型</label>
                    <select className="input" value={grantObjType} onChange={e => setGrantObjType(e.target.value)}>
                      <option value="TABLE">TABLE</option>
                      <option value="ALL TABLES IN DATABASE">ALL TABLES IN DATABASE</option>
                      <option value="ALL TABLES IN ALL DATABASES">ALL TABLES IN ALL DATABASES</option>
                      <option value="DATABASE">DATABASE</option>
                      <option value="ALL DATABASES">ALL DATABASES</option>
                      <option value="CATALOG">CATALOG</option>
                      <option value="ALL CATALOGS">ALL CATALOGS</option>
                      <option value="MATERIALIZED VIEW">MATERIALIZED VIEW</option>
                      <option value="ALL MATERIALIZED VIEWS IN DATABASE">ALL MVs IN DATABASE</option>
                      <option value="FUNCTION">FUNCTION</option>
                      <option value="ALL FUNCTIONS IN DATABASE">ALL FUNCTIONS IN DATABASE</option>
                      <option value="ALL GLOBAL FUNCTIONS">ALL GLOBAL FUNCTIONS</option>
                      <option value="RESOURCE GROUP">RESOURCE GROUP</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">对象名 <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>（如 db.table 或 db_name，ALL 类型填空即可）</span></label>
                  <input className="input" placeholder="database.table 或 database_name" value={grantObjName} onChange={e => setGrantObjName(e.target.value)} />
                </div>
                {/* SQL Preview */}
                <div style={{ marginTop: '8px', padding: '10px 14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: '4px' }}>SQL 预览</div>
                  <code style={{ fontSize: '0.78rem', color: 'var(--primary-600)', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
                    {grantAction === 'grant_privilege' ? 'GRANT' : 'REVOKE'} {grantPriv} ON {grantObjType} {grantObjName || '...'} {grantAction === 'grant_privilege' ? 'TO' : 'FROM'} {showGrant}
                  </code>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowGrant(null)}>取消</button>
                <button className="btn btn-primary" onClick={handleGrantPrivilege} disabled={!grantObjName && !grantObjType.startsWith('ALL')}>
                  <Shield size={16} /> {grantAction === 'grant_privilege' ? '授权' : '撤销'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Role Assignment Modal */}
        {showRoleAssign && (() => {
          // Find this user's existing roles
          const thisUser = users.find(u => u.identity === showRoleAssign);
          const existingRoles: string[] = [];
          if (thisUser) {
            thisUser.grants.forEach(g => {
              const roleMatch = g.match(/GRANT\s+((?:['`][^'`]+['`](?:\s*,\s*)?)+)\s+TO/i);
              if (roleMatch) {
                const roles = roleMatch[1].match(/['`]([^'`]+)['`]/g) || [];
                roles.forEach(r => existingRoles.push(r.replace(/['`]/g, '')));
              }
            });
          }
          // All tabs: existing roles + the one being selected (if not already there)
          const previewRoles = [...existingRoles];
          if (roleNameInput && !previewRoles.includes(roleNameInput)) {
            previewRoles.push(roleNameInput);
          }
          const activeTab = previewTab || (previewRoles[0] || '');
          const cachedPriv = rolePrivCache[activeTab];
          const catalogGroups = cachedPriv ? classifyGrants(cachedPriv.grants, cachedPriv.catalogGrants) : [];

          return (
            <div className="modal-overlay" onClick={() => setShowRoleAssign(null)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
                <div className="modal-header">
                  <div className="modal-title">分配 / 撤销角色 — {showRoleAssign}</div>
                  <button className="btn-ghost btn-icon" onClick={() => setShowRoleAssign(null)}><X size={18} /></button>
                </div>
                <div className="modal-body" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">操作</label>
                      <select className="input" value={roleAction} onChange={e => setRoleAction(e.target.value as 'grant_role' | 'revoke_role')}>
                        <option value="grant_role">授予角色 (GRANT)</option>
                        <option value="revoke_role">撤销角色 (REVOKE)</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">角色名</label>
                      <select
                        className="input"
                        value={roleNameInput}
                        onChange={e => {
                          const v = e.target.value;
                          setRoleNameInput(v);
                          setPreviewTab(v);
                          // Auto-fetch privileges for this role
                          if (v && !rolePrivCache[v] && session) {
                            setRolePrivLoading(true);
                            fetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(`ROLE '${v}'`)}`)
                              .then(r => r.json())
                              .then(data => {
                                if (!data.error) {
                                  setRolePrivCache(prev => ({ ...prev, [v]: { grants: data.grants || [], catalogGrants: data.catalogGrants } }));
                                }
                              })
                              .finally(() => setRolePrivLoading(false));
                          }
                        }}
                      >
                        <option value="">请选择角色...</option>
                        {allRoles.filter(r => !['root', 'cluster_admin', 'db_admin', 'user_admin', 'public'].includes(r)).map(r => (
                          <option key={r} value={r}>{r}{existingRoles.includes(r) ? ' ✓' : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Privilege Preview Section */}
                  {previewRoles.length > 0 && (
                    <div style={{
                      border: '1px solid var(--border-secondary)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                    }}>
                      {/* Role Tabs Header */}
                      <div style={{
                        display: 'flex', alignItems: 'center',
                        padding: '6px 12px',
                        backgroundColor: 'var(--bg-tertiary)',
                        borderBottom: '1px solid var(--border-secondary)',
                        gap: '6px',
                      }}>
                        <Eye size={13} style={{ color: 'var(--primary-500)' }} />
                        <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)' }}>角色权限预览</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginLeft: '2px' }}>点击标签切换</span>
                      </div>
                      {/* Role Tabs */}
                      <div style={{
                        display: 'flex', gap: '0',
                        borderBottom: '1px solid var(--border-secondary)',
                        backgroundColor: 'var(--bg-secondary)',
                        overflowX: 'auto',
                      }}>
                        {previewRoles.map(r => (
                          <button
                            key={r}
                            onClick={() => {
                              setPreviewTab(r);
                              // Fetch privileges if not cached
                              if (!rolePrivCache[r] && session) {
                                setRolePrivLoading(true);
                                fetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(`ROLE '${r}'`)}`)
                                  .then(res => res.json())
                                  .then(data => {
                                    if (!data.error) {
                                      setRolePrivCache(prev => ({ ...prev, [r]: { grants: data.grants || [], catalogGrants: data.catalogGrants } }));
                                    }
                                  })
                                  .finally(() => setRolePrivLoading(false));
                              }
                            }}
                            style={{
                              padding: '6px 14px', fontSize: '0.76rem', fontWeight: 500,
                              border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                              borderBottom: activeTab === r ? '2px solid var(--primary-500)' : '2px solid transparent',
                              backgroundColor: activeTab === r ? 'var(--bg-primary)' : 'transparent',
                              color: activeTab === r ? 'var(--primary-600)' : 'var(--text-tertiary)',
                              transition: 'all 0.15s',
                            }}
                          >
                            {r}
                            {existingRoles.includes(r) && (
                              <span style={{ marginLeft: '4px', fontSize: '0.65rem', opacity: 0.6 }}>已分配</span>
                            )}
                            {rolePrivCache[r] ? (
                              <span style={{
                                marginLeft: '5px', fontSize: '0.6rem', fontWeight: 600,
                                padding: '0 5px', borderRadius: '999px',
                                backgroundColor: 'rgba(22,163,74,0.1)', color: 'var(--success-600)',
                                border: '1px solid rgba(22,163,74,0.2)',
                              }}>✓</span>
                            ) : (
                              <span style={{
                                marginLeft: '5px', fontSize: '0.58rem', fontWeight: 500,
                                padding: '0 5px', borderRadius: '999px',
                                backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
                                border: '1px solid var(--border-secondary)',
                              }}>未加载</span>
                            )}
                          </button>
                        ))}
                      </div>
                      {/* Privilege Content */}
                      <div style={{ maxHeight: '280px', overflowY: 'auto', padding: '8px' }}>
                        {rolePrivLoading ? (
                          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                            <div className="spinner" style={{ width: '20px', height: '20px', margin: '0 auto 8px' }} />
                            加载权限中...
                          </div>
                        ) : !cachedPriv ? (
                          <div
                            onClick={() => {
                              const firstRole = previewRoles[0];
                              if (firstRole) {
                                setPreviewTab(firstRole);
                                if (!rolePrivCache[firstRole] && session) {
                                  setRolePrivLoading(true);
                                  fetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(`ROLE '${firstRole}'`)}`)
                                    .then(r => r.json())
                                    .then(data => {
                                      if (!data.error) {
                                        setRolePrivCache(prev => ({ ...prev, [firstRole]: { grants: data.grants || [], catalogGrants: data.catalogGrants } }));
                                      }
                                    })
                                    .finally(() => setRolePrivLoading(false));
                                }
                              }
                            }}
                            style={{
                              padding: '28px 20px', textAlign: 'center',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                              cursor: 'pointer', transition: 'background-color 0.2s',
                              borderRadius: 'var(--radius-sm)',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(37,99,235,0.04)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div style={{
                              width: '40px', height: '40px', borderRadius: '50%',
                              backgroundColor: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              animation: 'pulse 2s infinite',
                            }}>
                              <Eye size={18} style={{ color: 'var(--primary-500)' }} />
                            </div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-600)' }}>
                              点击加载权限详情
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                              立即查看当前角色拥有的所有权限
                            </div>
                          </div>
                        ) : cachedPriv.grants.length === 0 ? (
                          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                            该角色暂无权限
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {catalogGroups.map((cg, i) => (
                              <CatalogSectionBlock key={i} group={cg} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SQL Preview */}
                  <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: '4px' }}>SQL 预览</div>
                    <code style={{ fontSize: '0.78rem', color: 'var(--primary-600)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {roleAction === 'grant_role' ? 'GRANT' : 'REVOKE'} &apos;{roleNameInput || '...'}&apos; {roleAction === 'grant_role' ? 'TO' : 'FROM'} {showRoleAssign}
                    </code>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setShowRoleAssign(null)}>取消</button>
                  <button className="btn btn-primary" onClick={handleRoleAssign} disabled={!roleNameInput}>
                    <UserPlus size={16} /> {roleAction === 'grant_role' ? '授予' : '撤销'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Privilege Detail Modal */}
        {showPrivDetail && (
          <PrivilegeDetailModal
            title={showPrivDetail.identity}
            grants={showPrivDetail.grants}
            catalogGrants={showPrivDetail.catalogGrants}
            onClose={() => setShowPrivDetail(null)}
          />
        )}
      </div>
    </>
  );
}
