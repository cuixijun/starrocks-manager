'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, ErrorBanner, SuccessToast, DataTable } from '@/components/ui';
import {
  RefreshCw, Save, Check,
  ShieldCheck, Edit3, Eye, AlertCircle, Lock,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '@/lib/fetch-patch';

interface PermissionMeta {
  label: string;
  group: string;
  description: string;
  order: number;
}

interface PermGroup {
  key: string;
  label: string;
  order: number;
}

const ROLES = [
  { key: 'admin',  label: '管理员', color: '#ef4444', icon: ShieldCheck },
  { key: 'editor', label: '编辑者', color: '#3b82f6', icon: Edit3 },
  { key: 'viewer', label: '只读者', color: '#22c55e', icon: Eye },
];

// Subtle, restrained group colors for visual distinction
const GROUP_COLORS: Record<string, string> = {
  monitor:    '#3b82f6', // blue
  data:       '#8b5cf6', // purple
  task:       '#06b6d4', // teal
  permission: '#ef4444', // red
  ops:        '#10b981', // emerald
  system:     '#64748b', // slate
};

export default function SysPermissionsPage() {
  const { user } = useAuth();
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [meta, setMeta] = useState<Record<string, PermissionMeta>>({});
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const isDirty = dirtyRoles.size > 0;

  const fetchData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiFetch('/api/sys-permissions');
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setMatrix(data.matrix || {});
      setMeta(data.meta || {});
      setGroups((data.groups || []).sort((a: PermGroup, b: PermGroup) => a.order - b.order));
      setDirtyRoles(new Set());
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); } }, [success]);

  function togglePerm(role: string, perm: string) {
    if (role === 'admin') return;
    setMatrix(prev => ({
      ...prev,
      [role]: { ...prev[role], [perm]: !prev[role]?.[perm] },
    }));
    setDirtyRoles(prev => new Set(prev).add(role));
  }

  function toggleAllForRole(role: string, group: string, grant: boolean) {
    if (role === 'admin') return;
    const permsInGroup = Object.entries(meta)
      .filter(([, m]) => m.group === group)
      .map(([k]) => k);
    setMatrix(prev => {
      const updated = { ...prev[role] };
      for (const p of permsInGroup) updated[p] = grant;
      return { ...prev, [role]: updated };
    });
    setDirtyRoles(prev => new Set(prev).add(role));
  }

  function toggleGroup(groupKey: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  }

  async function handleSaveAll() {
    setSaving(true); setError('');
    try {
      for (const role of Array.from(dirtyRoles)) {
        const res = await apiFetch('/api/sys-permissions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, permissions: matrix[role] }),
        });
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
      }
      setSuccess('权限配置已保存');
      setDirtyRoles(new Set());
      window.dispatchEvent(new CustomEvent('permissions-changed'));
    } catch (err) { setError(String(err)); }
    finally { setSaving(false); }
  }

  if (user?.role !== 'admin') {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <AlertCircle size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
        <div>权限不足，仅管理员可访问此页面</div>
      </div>
    );
  }

  const allPermKeys = Object.keys(meta).sort((a, b) => {
    const ga = meta[a].group, gb = meta[b].group;
    const go = groups.findIndex(g => g.key === ga) - groups.findIndex(g => g.key === gb);
    if (go !== 0) return go;
    return meta[a].order - meta[b].order;
  });

  return (
    <>
      <PageHeader title="权限配置" breadcrumb={[{ label: '系统设置' }, { label: '权限配置' }]}
        description={<>配置各角色的功能访问权限 · {allPermKeys.length} 个权限项</>}
      />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />

        {/* Toolbar */}
        <div className="table-toolbar">
          <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Lock size={13} />
            管理员始终拥有全部权限，仅可配置编辑者和只读者
          </div>
          <div className="toolbar-actions">
            {isDirty && (
              <span style={{
                fontSize: '0.72rem', color: 'var(--warning-600, #ca8a04)',
                padding: '3px 10px', borderRadius: '999px',
                backgroundColor: 'rgba(234,179,8,0.1)',
                fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px',
              }}>
                ● 未保存
              </span>
            )}
            <button className="btn btn-primary" onClick={handleSaveAll} disabled={!isDirty || saving}>
              {saving ? (
                <><span className="spinner" style={{ width: '14px', height: '14px' }} /> 保存中...</>
              ) : (
                <><Save size={16} /> 保存</>
              )}
            </button>
            <button className="btn btn-secondary" onClick={fetchData} disabled={loading}>
              <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> 刷新
            </button>
          </div>
        </div>

        {/* Permission Matrix */}
        <DataTable
          loading={loading}
          empty={allPermKeys.length === 0}
          emptyIcon={<Lock size={48} />}
          emptyText="暂无权限项"
          footerLeft={
            <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
              共 <strong style={{ color: 'var(--text-secondary)' }}>{allPermKeys.length}</strong> 个权限项 · {groups.length} 个分组
            </span>
          }
        >
          <thead>
            <tr>
              <th style={{ minWidth: '200px' }}>功能模块</th>
              <th style={{ minWidth: '140px' }}>说明</th>
              {ROLES.map(r => (
                <th key={r.key} style={{ textAlign: 'center', width: '120px' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '2px 10px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 600,
                    color: r.color, backgroundColor: `${r.color}12`,
                  }}>
                    <r.icon size={12} /> {r.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => {
              const groupPerms = allPermKeys.filter(k => meta[k].group === group.key);
              if (groupPerms.length === 0) return null;
              const isCollapsed = collapsedGroups.has(group.key);
              const CollapseIcon = isCollapsed ? ChevronRight : ChevronDown;

              // Compute summary counts for collapsed state
              const editorCount = groupPerms.filter(p => matrix.editor?.[p]).length;
              const viewerCount = groupPerms.filter(p => matrix.viewer?.[p]).length;
              const groupColor = GROUP_COLORS[group.key] || '#64748b';

              return (
                <React.Fragment key={group.key}>
                  {/* Group header */}
                  <tr
                    style={{
                      backgroundColor: `${groupColor}08`,
                      cursor: 'pointer', userSelect: 'none',
                      borderBottom: `1px solid ${groupColor}15`,
                      borderLeft: `3px solid ${groupColor}`,
                    }}
                    onClick={() => toggleGroup(group.key)}
                  >
                    <td colSpan={2} style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CollapseIcon size={14} style={{ color: groupColor, flexShrink: 0, opacity: 0.7 }} />
                        <span style={{ fontWeight: 700, fontSize: '0.84rem', color: groupColor }}>
                          {group.label}
                        </span>
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 600, color: groupColor,
                          padding: '1px 7px', borderRadius: '999px', lineHeight: '16px',
                          backgroundColor: `${groupColor}12`, opacity: 0.8,
                        }}>
                          {groupPerms.length}
                        </span>
                      </div>
                    </td>
                    {ROLES.map(r => (
                      <td key={r.key} style={{ textAlign: 'center', padding: '4px' }} onClick={e => e.stopPropagation()}>
                        {r.key === 'admin' ? (
                          isCollapsed ? (
                            <span style={{
                              fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-tertiary)',
                              padding: '2px 8px', borderRadius: '999px',
                              backgroundColor: 'var(--bg-secondary)',
                            }}>
                              {groupPerms.length}<span style={{ opacity: 0.5 }}>/{groupPerms.length}</span>
                            </span>
                          ) : null
                        ) : (
                          isCollapsed ? (
                            <span style={{
                              fontSize: '0.82rem', fontWeight: 600,
                              padding: '2px 8px', borderRadius: '999px',
                              color: (r.key === 'editor' ? editorCount : viewerCount) === groupPerms.length
                                ? r.color : (r.key === 'editor' ? editorCount : viewerCount) === 0 ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                              backgroundColor: (r.key === 'editor' ? editorCount : viewerCount) === groupPerms.length
                                ? `${r.color}10` : 'var(--bg-secondary)',
                            }}>
                              {r.key === 'editor' ? editorCount : viewerCount}<span style={{ opacity: 0.5 }}>/{groupPerms.length}</span>
                            </span>
                          ) : (
                            <button
                              className="btn-action btn-action-primary"
                              title={`${r.label} 全选`}
                              style={{ width: '22px', height: '22px' }}
                              onClick={() => toggleAllForRole(r.key, group.key, true)}
                            >
                              <Check size={10} />
                            </button>
                          )
                        )}
                      </td>
                    ))}
                  </tr>
                  {/* Permission rows */}
                  {!isCollapsed && groupPerms.map(permKey => {
                    const m = meta[permKey];
                    return (
                      <tr key={permKey} style={{ borderLeft: `3px solid ${groupColor}20` }}>
                        <td>
                          <span style={{ fontSize: '0.84rem', fontWeight: 500, color: 'var(--text-primary)', paddingLeft: '22px', display: 'inline-block' }}>
                            {m.label}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                          {m.description}
                        </td>
                        {ROLES.map(r => {
                          const checked = matrix[r.key]?.[permKey] ?? false;
                          const isAdmin = r.key === 'admin';
                          return (
                            <td key={r.key} style={{ textAlign: 'center' }}>
                              <label style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: '30px', height: '30px', borderRadius: 'var(--radius-sm)',
                                cursor: isAdmin ? 'not-allowed' : 'pointer',
                                transition: 'background-color 0.15s',
                                backgroundColor: checked && !isAdmin ? `${r.color}10` : 'transparent',
                              }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={isAdmin}
                                  onChange={() => togglePerm(r.key, permKey)}
                                  style={{
                                    width: '15px', height: '15px',
                                    accentColor: r.color,
                                    cursor: isAdmin ? 'not-allowed' : 'pointer',
                                    opacity: isAdmin ? 0.4 : 1,
                                  }}
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
