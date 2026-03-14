'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { Shield, RefreshCw, Search, Plus, X } from 'lucide-react';

export default function PrivilegesPage() {
  const { session } = useSession();
  const [grants, setGrants] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showGrant, setShowGrant] = useState(false);
  const [form, setForm] = useState({
    action: 'grant' as 'grant' | 'revoke',
    privilege: 'SELECT',
    objectType: 'TABLE',
    objectName: '',
    grantee: '',
    granteeType: 'user' as 'user' | 'role',
  });

  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'CREATE TABLE', 'USAGE', 'ALL'];
  const objectTypes = ['TABLE', 'DATABASE', 'CATALOG', 'VIEW', 'MATERIALIZED VIEW', 'FUNCTION', 'RESOURCE', 'SYSTEM'];

  useEffect(() => {
    if (session) fetchPrivileges();
  }, [session]);

  async function fetchPrivileges() {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/privileges?sessionId=${encodeURIComponent(session.sessionId)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setGrants(data.grants || []);
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }

  async function handleSubmit() {
    if (!session || !form.grantee || !form.privilege) return;
    setError('');
    try {
      const res = await fetch('/api/privileges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, ...form }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setShowGrant(false);
        setSuccess(`权限${form.action === 'grant' ? '授予' : '撤销'}成功`);
        fetchPrivileges();
      }
    } catch (err) { setError(String(err)); }
  }

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  // Parse granted privileges for display
  const grantEntries = grants.map(g => {
    const identity = String(g['UserIdentity'] || g['user_identity'] || '');
    const grantStr = String(g['Grants'] || g['grants'] || g['Privilege'] || '');
    return { identity, grants: grantStr };
  }).filter(g => g.identity.toLowerCase().includes(search.toLowerCase()) || g.grants.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">权限管理</h1>
            <p className="page-description">查看和管理数据库权限</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={fetchPrivileges}><RefreshCw size={16} /> 刷新</button>
            <button className="btn btn-primary" onClick={() => setShowGrant(true)}><Plus size={16} /> 授权 / 撤权</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>{error}</div>}
        {success && <div className="toast toast-success">{success}</div>}

        <div className="search-bar mb-4">
          <Search />
          <input className="input" placeholder="搜索用户或权限..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : grantEntries.length === 0 ? (
          <div className="empty-state"><Shield size={48} /><div className="empty-state-text">暂无权限信息</div></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>用户标识</th>
                  <th>权限详情</th>
                </tr>
              </thead>
              <tbody>
                {grantEntries.map((g, i) => (
                  <tr key={i}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Shield size={16} />
                        <span className="text-mono" style={{ fontWeight: 500 }}>{g.identity}</span>
                      </div>
                    </td>
                    <td className="text-xs" style={{ whiteSpace: 'pre-wrap', maxWidth: '600px', color: 'var(--text-secondary)' }}>
                      {g.grants || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Grant/Revoke Privilege Modal */}
        {showGrant && (
          <div className="modal-overlay" onClick={() => setShowGrant(false)}>
            <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">授权 / 撤权</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowGrant(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">操作</label>
                  <select className="input" value={form.action} onChange={e => setForm({...form, action: e.target.value as 'grant' | 'revoke'})}>
                    <option value="grant">授予 (GRANT)</option>
                    <option value="revoke">撤销 (REVOKE)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">权限</label>
                  <select className="input" value={form.privilege} onChange={e => setForm({...form, privilege: e.target.value})}>
                    {privileges.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">对象类型</label>
                    <select className="input" value={form.objectType} onChange={e => setForm({...form, objectType: e.target.value})}>
                      {objectTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">对象名称</label>
                    <input className="input" placeholder="db.table 或 * " value={form.objectName} onChange={e => setForm({...form, objectName: e.target.value})} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">授权目标类型</label>
                    <select className="input" value={form.granteeType} onChange={e => setForm({...form, granteeType: e.target.value as 'user' | 'role'})}>
                      <option value="user">用户</option>
                      <option value="role">角色</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">用户名 / 角色名</label>
                    <input className="input" placeholder="username 或 role_name" value={form.grantee} onChange={e => setForm({...form, grantee: e.target.value})} />
                  </div>
                </div>
                <div style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                  预览: {form.action === 'revoke' ? 'REVOKE' : 'GRANT'} {form.privilege} ON {form.objectType} {form.objectName || '*'} {form.action === 'revoke' ? 'FROM' : 'TO'} {form.granteeType === 'role' ? `ROLE '${form.grantee}'` : `'${form.grantee}'`}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowGrant(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.grantee || !form.privilege}>
                  <Shield size={16} />
                  {form.action === 'grant' ? '授予' : '撤销'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
