'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePagination } from '@/hooks/usePagination';
import { Pagination, CommandLogButton} from '@/components/ui';
import Breadcrumb from '@/components/Breadcrumb';
import Link from 'next/link';
import {
  Database, Search, Table2, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown, ArrowRight, Clock, Eye, Layers,
  Plus, Trash2, AlertTriangle, X
} from 'lucide-react';
import { apiFetch } from '@/lib/fetch-patch';

interface DbInfo {
  name: string;
  tableCount: number;
  viewCount: number;
  mvCount: number;
  cachedAt?: string;
}

type SortKey = 'name' | 'tableCount';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} style={{ opacity: 0.35 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={13} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={13} style={{ color: 'var(--primary-500)' }} />;
}

export default function DatabasesPage() {
  const { session } = useSession();
  const [databases, setDatabases] = useState<DbInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete confirm dialog state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteForce, setDeleteForce] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const SYSTEM_DBS = ['information_schema', '_statistics_', 'sys'];

  const fetchDatabases = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/databases?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setDatabases(
          (data.databases || []).map((d: { name: string; tableCount: number; viewCount?: number; mvCount?: number }) => ({
            name: d.name,
            tableCount: d.tableCount ?? 0,
            viewCount: d.viewCount ?? 0,
            mvCount: d.mvCount ?? 0,
            cachedAt: ts,
          }))
        );
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    fetchDatabases();
  }, [session, fetchDatabases]);

  // ── Create database ──
  async function handleCreate() {
    if (!session || !newDbName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await apiFetch('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, name: newDbName.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setShowCreate(false);
        setNewDbName('');
        fetchDatabases(true);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }

  // ── Drop database ──
  async function handleDelete() {
    if (!session || !deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      const res = await apiFetch('/api/databases', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, name: deleteTarget, force: deleteForce }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setDeleteTarget(null);
        setDeleteForce(false);
        setDeleteConfirmName('');
        fetchDatabases(true);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleting(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const filtered = databases
    .filter(db => db.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      // System databases always at the bottom
      const aSystem = SYSTEM_DBS.includes(a.name.toLowerCase());
      const bSystem = SYSTEM_DBS.includes(b.name.toLowerCase());
      if (aSystem !== bSystem) return aSystem ? 1 : -1;

      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      if (sortKey === 'tableCount') cmp = a.tableCount - b.tableCount;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const thStyle: React.CSSProperties = {
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const pg = usePagination(filtered);

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <Breadcrumb items={[{ label: '数据管理' }, { label: '数据库浏览' }]} />
        <div className="page-header-row">
          <div>
            <h1 className="page-title">数据库浏览</h1>
            <p className="page-description">
              查看和管理数据库 · {databases.length} 个数据库
              {lastRefreshed && (
                <span className="timestamp-hint">
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span className="badge-cache">CACHE</span>}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div className="error-banner">{error}</div>
        )}

        {/* Table Toolbar */}
        <div className="table-toolbar">
          <div className="table-search">
            <Search size={15} className="table-search-icon" />
            <input
              placeholder="搜索数据库名..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> 新建数据库
            </button>
            <CommandLogButton source="databases" title="数据库浏览" />
            <button className="btn btn-secondary" onClick={() => fetchDatabases(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} />
              {refreshing ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Database size={48} />
            <div className="empty-state-text">{search ? '没有匹配的数据库' : '暂无数据库'}</div>
          </div>
        ) : (
          <div className="table-container fade-in">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '48px', textAlign: 'center' }}>#</th>
                  <th style={thStyle} onClick={() => toggleSort('name')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      数据库名 <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th style={{ ...thStyle, textAlign: 'center' }} onClick={() => toggleSort('tableCount')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', justifyContent: 'center' }}>
                      <Table2 size={13} /> 表 <SortIcon col="tableCount" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', justifyContent: 'center' }}>
                      <Eye size={13} /> 视图
                    </span>
                  </th>
                  <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', justifyContent: 'center' }}>
                      <Layers size={13} /> 物化视图
                    </span>
                  </th>
                  <th style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <Clock size={13} /> 缓存时间
                    </span>
                  </th>
                  <th style={{ textAlign: 'center', width: '100px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pg.paginatedData.map((db, idx) => {
                  const globalIdx = (pg.page - 1) * pg.pageSize + idx;
                  const isSystemDb = SYSTEM_DBS.includes(db.name.toLowerCase());
                  return (
                  <tr key={db.name}>
                    {/* Index */}
                    <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                      {globalIdx + 1}
                    </td>

                    {/* Name */}
                    <td>
                      <Link
                        href={`/databases/${encodeURIComponent(db.name)}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '8px',
                          fontWeight: 600, color: 'var(--primary-600)', textDecoration: 'none',
                        }}
                      >
                        <div className="icon-box icon-box-sm icon-box-primary">
                          <Database size={14} />
                        </div>
                        {db.name}
                      </Link>
                    </td>

                    {/* Table count */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '2px 8px', borderRadius: '999px',
                        backgroundColor: db.tableCount > 0 ? 'var(--primary-50)' : 'var(--bg-secondary)',
                        color: db.tableCount > 0 ? 'var(--primary-600)' : 'var(--text-tertiary)',
                        border: `1px solid ${db.tableCount > 0 ? 'var(--primary-100)' : 'var(--border-secondary)'}`,
                        fontSize: '0.78rem', fontWeight: 600,
                      }}>
                        {db.tableCount.toLocaleString()}
                      </span>
                    </td>

                    {/* View count */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '2px 8px', borderRadius: '999px',
                        backgroundColor: db.viewCount > 0 ? 'rgba(139,92,246,0.08)' : 'var(--bg-secondary)',
                        color: db.viewCount > 0 ? '#8b5cf6' : 'var(--text-tertiary)',
                        border: `1px solid ${db.viewCount > 0 ? 'rgba(139,92,246,0.2)' : 'var(--border-secondary)'}`,
                        fontSize: '0.78rem', fontWeight: 600,
                      }}>
                        {db.viewCount.toLocaleString()}
                      </span>
                    </td>

                    {/* MV count */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '2px 8px', borderRadius: '999px',
                        backgroundColor: db.mvCount > 0 ? 'rgba(234,179,8,0.08)' : 'var(--bg-secondary)',
                        color: db.mvCount > 0 ? '#ca8a04' : 'var(--text-tertiary)',
                        border: `1px solid ${db.mvCount > 0 ? 'rgba(234,179,8,0.2)' : 'var(--border-secondary)'}`,
                        fontSize: '0.78rem', fontWeight: 600,
                      }}>
                        {db.mvCount.toLocaleString()}
                      </span>
                    </td>

                    {/* Cached at */}
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {db.cachedAt ?? '-'}
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Link
                          href={`/databases/${encodeURIComponent(db.name)}`}
                          className="btn-action btn-action-view"
                          title={`进入 ${db.name}`}
                          style={{ display: 'inline-flex' }}
                        >
                          <ArrowRight size={14} />
                        </Link>
                        <button
                          className="btn-action btn-action-danger"
                          title={isSystemDb ? `系统数据库不可删除` : `删除 ${db.name}`}
                          onClick={() => setDeleteTarget(db.name)}
                          disabled={isSystemDb}
                          style={isSystemDb ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer summary */}
            <div className="table-footer">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span>
                  共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个数据库
                  {search && ` (过滤自 ${databases.length} 个)`}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> SHOW DATABASES</span>
              </div>
              <Pagination page={pg.page} pageSize={pg.pageSize} totalPages={pg.totalPages} totalItems={pg.totalItems} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
            </div>
          </div>
        )}
      </div>

      {/* ── Create Database Dialog ── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => { if (!creating) { setShowCreate(false); setNewDbName(''); } }}>
          <div className="modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title"><Plus size={18} /> 新建数据库</h3>
              <button className="btn-ghost btn-icon" onClick={() => { setShowCreate(false); setNewDbName(''); }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">数据库名称</label>
                <input
                  className="input"
                  placeholder="例如: my_database"
                  value={newDbName}
                  onChange={e => setNewDbName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newDbName.trim()) handleCreate(); }}
                  autoFocus
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  只能包含字母、数字和下划线，不能以数字开头
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowCreate(false); setNewDbName(''); }} disabled={creating}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newDbName.trim()}>
                {creating ? <><span className="spinner" /> 创建中...</> : <><Database size={16} /> 创建</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialog ── */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => { if (!deleting) { setDeleteTarget(null); setDeleteForce(false); setDeleteConfirmName(''); } }}>
          <div className="modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--danger-500)' }}>
                <AlertTriangle size={18} /> 删除数据库
              </h3>
              <button className="btn-ghost btn-icon" onClick={() => { setDeleteTarget(null); setDeleteForce(false); setDeleteConfirmName(''); }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                marginBottom: '16px',
              }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  确定要删除数据库 <code style={{ color: 'var(--danger-500)' }}>{deleteTarget}</code> 吗？
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                  此操作不可恢复，数据库中的所有表、视图和数据将被永久删除。
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">请输入数据库名称 <code style={{ color: 'var(--danger-500)' }}>{deleteTarget}</code> 以确认删除</label>
                <input
                  className="input"
                  placeholder={deleteTarget}
                  value={deleteConfirmName}
                  onChange={e => setDeleteConfirmName(e.target.value)}
                  autoFocus
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={deleteForce} onChange={e => setDeleteForce(e.target.checked)} />
                强制删除（FORCE，即使有未完成的事务）
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setDeleteTarget(null); setDeleteForce(false); setDeleteConfirmName(''); }} disabled={deleting}>
                取消
              </button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting || deleteConfirmName !== deleteTarget}>
                {deleting ? <><span className="spinner" /> 删除中...</> : <><Trash2 size={16} /> 确认删除</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
