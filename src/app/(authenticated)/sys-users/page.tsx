'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, ErrorBanner, SuccessToast, DataTable } from '@/components/ui';
import { UserCog, Plus, Trash2, Pencil, X, Check, AlertCircle, ShieldCheck, Eye, Edit3, RefreshCw, Search, Lock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

interface SysUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_active: number;
  last_login_at: string | null;
  clusters: { id: number; name: string }[];
}

const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员', desc: '全部权限 + 集群/用户管理', color: '#ef4444' },
  { value: 'editor', label: '编辑者', desc: '可查询 + 部分管理功能', color: '#3b82f6' },
  { value: 'viewer', label: '只读者', desc: '仅查看数据', color: '#22c55e' },
];

export default function SysUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<SysUser[]>([]);
  const [allClusters, setAllClusters] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<SysUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Form
  const [form, setForm] = useState({
    username: '', password: '', display_name: '', role: 'viewer', cluster_ids: [] as number[],
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');

  const filteredUsers = users.filter(u =>
    !search || u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.display_name.toLowerCase().includes(search.toLowerCase())
  );

  const fetchUsers = useCallback(async () => {
    try {
      const [usersRes, clustersRes] = await Promise.all([
        fetch('/api/sys-users'),
        fetch('/api/clusters'),
      ]);
      const usersData = await usersRes.json();
      const clustersData = await clustersRes.json();
      if (usersData.error) { setError(usersData.error); return; }
      setUsers(usersData.users || []);
      setAllClusters((clustersData.clusters || []).map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })));
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function openCreate() {
    setEditUser(null);
    setForm({ username: '', password: '', display_name: '', role: 'viewer', cluster_ids: [] });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(u: SysUser) {
    setEditUser(u);
    setForm({
      username: u.username, password: '', display_name: u.display_name,
      role: u.role, cluster_ids: u.clusters.map(c => c.id),
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.username || (!editUser && !form.password)) {
      setFormError(editUser ? '用户名不能为空' : '请填写用户名和密码');
      return;
    }
    setSaving(true); setFormError('');
    try {
      const method = editUser ? 'PUT' : 'POST';
      const body = editUser
        ? { id: editUser.id, ...form, password: form.password || undefined }
        : form;

      const res = await fetch('/api/sys-users', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setFormError(data.error);
      } else {
        setShowModal(false);
        setSuccess(editUser ? '用户已更新' : '用户已创建');
        setTimeout(() => setSuccess(''), 3000);
        fetchUsers();
      }
    } catch (err) { setFormError(String(err)); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch('/api/sys-users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else {
        setSuccess('用户已删除');
        setTimeout(() => setSuccess(''), 3000);
        fetchUsers();
      }
    } catch (err) { setError(String(err)); }
    finally { setDeleteConfirm(null); }
  }

  async function handleToggleActive(u: SysUser) {
    try {
      const res = await fetch('/api/sys-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, is_active: u.is_active ? 0 : 1 }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else { fetchUsers(); }
    } catch (err) { setError(String(err)); }
  }

  if (user?.role !== 'admin') {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <AlertCircle size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
        <div>权限不足，仅管理员可访问此页面</div>
      </div>
    );
  }

  const roleOpt = (role: string) => ROLE_OPTIONS.find(r => r.value === role);

  return (
    <>
      <PageHeader title="系统用户" breadcrumb={[{ label: '系统管理' }, { label: '系统用户' }]}
        description={<>管理系统登录账号 · {users.length} 个用户</>}
      />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />
        <div className="table-toolbar">
          <div className="table-search">
            <Search size={14} className="table-search-icon" />
            <input placeholder="搜索用户名或显示名..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="toolbar-actions">
            <button className="btn btn-secondary" onClick={fetchUsers} disabled={loading}>
              <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> 刷新
            </button>
            <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> 创建用户</button>
          </div>
        </div>
        <DataTable loading={loading} empty={filteredUsers.length === 0} emptyIcon={<UserCog size={48} />} emptyText="暂无用户"
          footerLeft={<>共 <strong style={{ color: 'var(--text-secondary)' }}>{users.length}</strong> 个用户</>}>
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>#</th>
              <th>用户名</th>
              <th>显示名</th>
              <th>角色</th>
              <th>可访问集群</th>
              <th>状态</th>
              <th>最后登录</th>
              <th style={{ width: '140px', textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u, i) => {
              const role = roleOpt(u.role);
              return (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                  <td style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td>{u.display_name || '—'}</td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 600,
                      color: role?.color, backgroundColor: `${role?.color}15`,
                    }}>
                      {u.role === 'admin' ? <ShieldCheck size={12} /> : u.role === 'editor' ? <Edit3 size={12} /> : <Eye size={12} />}
                      {role?.label}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                    {u.role === 'admin' ? '全部' : u.clusters.length > 0 ? u.clusters.map(c => c.name).join(', ') : '—'}
                  </td>
                  <td>
                    <span
                      className={`status-badge ${u.is_active ? 'status-green' : 'status-red'}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleToggleActive(u)}
                      title={u.is_active ? '点击禁用' : '点击启用'}
                    >
                      {u.is_active ? '● 已启用' : '● 已禁用'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                    {u.last_login_at || '从未登录'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(u)} title="编辑">
                        <Pencil size={14} />
                      </button>
                      <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleteConfirm(u.id)} title="删除"
                        disabled={u.username === 'admin'}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </div>

      {/* Create/Edit Modal */}
      <Modal open={showModal} title={editUser ? '编辑用户' : '创建用户'} onClose={() => setShowModal(false)} maxWidth="480px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">用户名 *</label>
            <input className="input" placeholder="英文字母、数字、下划线" value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              disabled={!!editUser} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">密码 {editUser && <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>(留空则不修改)</span>}</label>
            <input className="input" type="password" placeholder={editUser ? '留空则不修改' : '设置密码'}
              value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            {/* Real-time password strength checklist */}
            {(form.password.length > 0 || !editUser) && form.password.length > 0 && (() => {
              const rules = [
                { ok: form.password.length >= 8, label: '至少 8 位字符' },
                { ok: /[A-Z]/.test(form.password), label: '包含大写字母' },
                { ok: /[a-z]/.test(form.password), label: '包含小写字母' },
                { ok: /[0-9]/.test(form.password), label: '包含数字' },
                { ok: /[^A-Za-z0-9]/.test(form.password), label: '包含特殊字符（如 !@#$%）' },
              ];
              return (
                <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                  {rules.map((r, i) => (
                    <span key={i} style={{
                      fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '3px',
                      color: r.ok ? 'var(--success-600, #16a34a)' : 'var(--text-tertiary)',
                      transition: 'color 0.15s',
                    }}>
                      {r.ok ? '✓' : '○'} {r.label}
                    </span>
                  ))}
                </div>
              );
            })()}
            {form.password.length === 0 && !editUser && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                密码要求：至少 8 位，包含大小写字母、数字、特殊字符
              </div>
            )}
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">显示名称</label>
            <input className="input" placeholder="如：张三" value={form.display_name}
              onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              角色 *
              {editUser?.username === 'admin' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                  <Lock size={10} /> 内置管理员不可修改
                </span>
              )}
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {ROLE_OPTIONS.map(r => {
                const isAdminLocked = editUser?.username === 'admin';
                const isSelected = form.role === r.value;
                return (
                  <button key={r.value} type="button"
                    onClick={() => !isAdminLocked && setForm(f => ({ ...f, role: r.value }))}
                    disabled={isAdminLocked}
                    style={{
                      flex: 1, padding: '8px 6px', borderRadius: 'var(--radius-md)',
                      border: isSelected ? `2px solid ${r.color}` : '1px solid var(--border-secondary)',
                      backgroundColor: isSelected ? `${r.color}10` : 'var(--bg-secondary)',
                      cursor: isAdminLocked ? 'not-allowed' : 'pointer', textAlign: 'center', transition: 'all 0.15s',
                      opacity: isAdminLocked && !isSelected ? 0.4 : 1,
                    }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: isSelected ? r.color : 'var(--text-primary)' }}>
                      {r.label}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>{r.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
          {form.role !== 'admin' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">可访问集群</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {allClusters.length === 0 && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>暂无集群</span>
                )}
                {allClusters.map(c => {
                  const checked = form.cluster_ids.includes(c.id);
                  return (
                    <label key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px',
                      borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.82rem',
                      border: checked ? '1px solid var(--primary-500)' : '1px solid var(--border-secondary)',
                      background: checked ? 'var(--primary-50)' : 'transparent',
                      color: checked ? 'var(--primary-600)' : 'var(--text-secondary)',
                    }}>
                      <input type="checkbox" checked={checked} style={{ display: 'none' }}
                        onChange={() => setForm(f => ({
                          ...f,
                          cluster_ids: checked ? f.cluster_ids.filter(id => id !== c.id) : [...f.cluster_ids, c.id],
                        }))} />
                      {checked && <Check size={12} />}
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {formError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger-500)', fontSize: '0.82rem', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.15)' }}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
              <X size={14} /> 取消
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.username || (!editUser && !form.password)}>
              {saving ? <span className="spinner" /> : <><Check size={14} /> {editUser ? '保存' : '创建'}</>}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmModal
        open={deleteConfirm !== null}
        title="删除用户"
        message={`确定要删除用户 "${users.find(u => u.id === deleteConfirm)?.username}" 吗？此操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}
