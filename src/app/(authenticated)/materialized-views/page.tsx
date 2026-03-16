'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePagination } from '@/hooks/usePagination';
import { Pagination } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';

import Link from 'next/link';
import {
  RefreshCw, Search, Clock, Eye, Trash2, Play, Plus,
  AlertTriangle,
} from 'lucide-react';

const STATUS_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  SUCCESS: { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.2)', color: 'var(--success-600)' },
  FAILED: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', color: 'var(--danger-500)' },
  RUNNING: { bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.2)', color: 'var(--primary-600)' },
  PENDING: { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.2)', color: 'var(--warning-600)' },
};



export default function MaterializedViewsPage() {
  const { session } = useSession();
  const [views, setViews] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingActive, setTogglingActive] = useState<string | null>(null);

  const [dbFilter, setDbFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');

  const [createModal, setCreateModal] = useState(false);
  const [createSql, setCreateSql] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; db: string; name: string }>({ open: false, db: '', name: '' });
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchViews = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/materialized-views?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setViews(data.views || []);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchViews(); }, [session, fetchViews]);
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const str = (v: unknown) => {
    const s = String(v ?? '');
    return s === 'null' || s === 'NULL' || s === '\\N' || s === 'undefined' ? '' : s;
  };

  async function postAction(body: Record<string, unknown>) {
    if (!session) return null;
    const res = await fetch('/api/materialized-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, ...body }),
    });
    return res.json();
  }

  async function handleRefreshMV(db: string, name: string) {
    const data = await postAction({ action: 'refresh', dbName: db, mvName: name });
    if (data?.error) setError(data.error);
    else setSuccess(`已触发刷新 ${db}.${name}`);
  }

  async function handleToggleActive(db: string, name: string, currentlyActive: boolean) {
    const key = `${db}.${name}`;
    setTogglingActive(key);
    const data = await postAction({ action: 'alter_active', dbName: db, mvName: name, active: !currentlyActive });
    if (data?.error) setError(data.error);
    else { setSuccess(`${db}.${name} 已${currentlyActive ? '停用' : '激活'}`); fetchViews(true); }
    setTogglingActive(null);
  }





  async function handleCreate() {
    if (!createSql.trim()) return;
    setCreating(true); setActionError('');
    const data = await postAction({ action: 'create', sql: createSql.trim() });
    if (data?.error) setActionError(data.error);
    else { setCreateModal(false); setCreateSql(''); setSuccess('物化视图创建成功'); fetchViews(true); }
    setCreating(false);
  }

  async function handleDelete() {
    setDeleting(true); setActionError('');
    const data = await postAction({ action: 'drop', dbName: deleteModal.db, mvName: deleteModal.name });
    if (data?.error) setActionError(data.error);
    else { setDeleteModal({ open: false, db: '', name: '' }); setSuccess(`物化视图 ${deleteModal.db}.${deleteModal.name} 已删除`); fetchViews(true); }
    setDeleting(false);
  }

  const allDbs = Array.from(new Set(views.map(v => str(v.TABLE_SCHEMA)))).sort();
  const allStatuses = Array.from(new Set(views.map(v => str(v.LAST_REFRESH_STATE)))).filter(Boolean).sort();
  const activeCount = views.filter(v => str(v.IS_ACTIVE) === 'true').length;
  const inactiveCount = views.length - activeCount;

  const filtered = views
    .filter(v => {
      const name = str(v.TABLE_NAME).toLowerCase();
      const db = str(v.TABLE_SCHEMA).toLowerCase();
      const matchSearch = name.includes(search.toLowerCase()) || db.includes(search.toLowerCase());
      const matchDb = dbFilter === 'all' || str(v.TABLE_SCHEMA) === dbFilter;
      const matchStatus = statusFilter === 'all' || str(v.LAST_REFRESH_STATE) === statusFilter;
      const matchActive = activeFilter === 'all' || str(v.IS_ACTIVE) === activeFilter;
      return matchSearch && matchDb && matchStatus && matchActive;
    })
    .sort((a, b) => {
      const dbCmp = str(a.TABLE_SCHEMA).localeCompare(str(b.TABLE_SCHEMA));
      if (dbCmp !== 0) return dbCmp;
      const activeA = str(a.IS_ACTIVE) === 'true' ? 0 : 1;
      const activeB = str(b.IS_ACTIVE) === 'true' ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      return str(a.TABLE_NAME).localeCompare(str(b.TABLE_NAME));
    });

  const pg = usePagination(filtered);

  const selectStyle: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-secondary)', background: 'var(--bg-primary)',
    fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer',
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">物化视图管理</h1>
            <p className="page-description">
              管理 StarRocks 物化视图 · {views.length} 个视图
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={() => { setCreateModal(true); setActionError(''); setCreateSql(''); }}>
              <Plus size={16} /> 创建物化视图
            </button>
            <button className="btn btn-secondary" onClick={() => fetchViews(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
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

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
            <Search />
            <input className="input" placeholder="搜索物化视图名称/数据库..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select style={selectStyle} value={dbFilter} onChange={e => setDbFilter(e.target.value)}>
              <option value="all">全部数据库 ({allDbs.length})</option>
              {allDbs.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div style={{ display: 'flex', gap: '4px' }}>
              {([['all', '全部', views.length], ['true', '活跃', activeCount], ['false', '不活跃', inactiveCount]] as const).map(([val, label, cnt]) => (
                <button
                  key={val}
                  onClick={() => setActiveFilter(val)}
                  style={{
                    padding: '4px 12px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: activeFilter === val ? 600 : 500,
                    border: `1px solid ${activeFilter === val ? 'var(--primary-400)' : 'var(--border-secondary)'}`,
                    backgroundColor: activeFilter === val ? 'var(--primary-50)' : 'transparent',
                    color: activeFilter === val ? 'var(--primary-600)' : 'var(--text-secondary)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  {label}
                  <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>({cnt})</span>
                </button>
              ))}
            </div>
            <select style={selectStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">全部刷新状态</option>
              {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">{search || dbFilter !== 'all' || activeFilter !== 'all' ? '没有匹配的物化视图' : '暂无物化视图'}</div></div>
        ) : (
          <div className="table-container fade-in" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', tableLayout: 'auto' }}>
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                  <th style={{ minWidth: '150px' }}>名称</th>
                  <th style={{ minWidth: '90px' }}>数据库</th>
                  <th style={{ minWidth: '56px' }}>活跃</th>
                  <th style={{ minWidth: '70px' }}>视图类型</th>
                  <th style={{ minWidth: '60px' }}>耗时</th>
                  <th style={{ minWidth: '56px' }}>状态</th>
                  <th style={{ minWidth: '120px' }}>最近刷新</th>
                  <th style={{ minWidth: '60px' }}>行数</th>
                  <th style={{ textAlign: 'center', width: '120px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pg.paginatedData.map((mv, idx) => {
                  const globalIdx = (pg.page - 1) * pg.pageSize + idx;
                  const name = str(mv.TABLE_NAME);
                  const db = str(mv.TABLE_SCHEMA);
                  const refreshType = str(mv.REFRESH_TYPE);
                  const lastDuration = str(mv.LAST_REFRESH_DURATION);
                  const isActive = str(mv.IS_ACTIVE) === 'true';
                  const lastState = str(mv.LAST_REFRESH_STATE);
                  const lastTime = str(mv.LAST_REFRESH_START_TIME);
                  const rows = Number(mv.TABLE_ROWS ?? 0);
                  const statusStyle = STATUS_STYLE[lastState] || STATUS_STYLE.PENDING;

                  return (
                    <tr key={`${db}.${name}`}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{globalIdx + 1}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link
                          href={`/materialized-views/${encodeURIComponent(db)}/${encodeURIComponent(name)}`}
                          style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--primary-600)', textDecoration: 'none' }}
                        >
                          {name}
                        </Link>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: '999px', fontSize: '0.73rem', fontWeight: 600,
                          backgroundColor: 'rgba(37,99,235,0.06)', color: 'var(--primary-600)',
                          border: '1px solid rgba(37,99,235,0.15)',
                        }}>{db}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => handleToggleActive(db, name, isActive)}
                          disabled={togglingActive === `${db}.${name}`}
                          title={`点击${isActive ? '停用' : '激活'}`}
                          style={{
                            padding: '3px 10px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                            cursor: togglingActive === `${db}.${name}` ? 'wait' : 'pointer',
                            border: `1px solid ${isActive ? 'rgba(22,163,74,0.3)' : 'rgba(107,114,128,0.3)'}`,
                            backgroundColor: isActive ? 'rgba(22,163,74,0.08)' : 'rgba(107,114,128,0.06)',
                            color: isActive ? 'var(--success-600)' : 'var(--text-tertiary)',
                            transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: '4px',
                            opacity: togglingActive === `${db}.${name}` ? 0.5 : 1,
                          }}
                        >
                          <span style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            backgroundColor: isActive ? 'var(--success-600)' : 'var(--text-tertiary)',
                          }} />
                          {togglingActive === `${db}.${name}` ? '...' : isActive ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {refreshType}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {lastDuration}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {lastState ? (
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: statusStyle.color }}>
                            {lastState}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {lastTime}
                      </td>
                      <td style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>
                        {rows > 0 ? rows.toLocaleString() : ''}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '2px', justifyContent: 'center' }}>
                          <Link href={`/materialized-views/${encodeURIComponent(db)}/${encodeURIComponent(name)}`} className="btn btn-ghost btn-icon" title="查看详情">
                            <Eye size={14} />
                          </Link>
                          <button className="btn btn-ghost btn-icon" style={{ color: 'var(--success-600)' }} onClick={() => handleRefreshMV(db, name)} title="手动刷新">
                            <Play size={14} />
                          </button>
                          <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger-500)' }} onClick={() => { setDeleteModal({ open: true, db, name }); setActionError(''); }} title="删除">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{
              padding: '8px 16px', borderTop: '1px solid var(--border-secondary)',
              fontSize: '0.78rem', color: 'var(--text-tertiary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            }}>
              <span>
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个物化视图
                {(search || dbFilter !== 'all' || statusFilter !== 'all' || activeFilter !== 'all') && ` (过滤自 ${views.length} 个)`}
              </span>
              <Pagination page={pg.page} pageSize={pg.pageSize} totalPages={pg.totalPages} totalItems={pg.totalItems} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
            </div>
          </div>
        )}



        {/* ========== Create MV Modal ========== */}
        <Modal
          open={createModal}
          onClose={() => { setCreateModal(false); setActionError(''); }}
          title="创建物化视图"
          maxWidth="750px"
          footer={
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setCreateModal(false); setActionError(''); }}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating || !createSql.trim()}>
                {creating ? '创建中...' : '执行创建'}
              </button>
            </div>
          }
        >
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            输入 <code style={{ padding: '2px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', fontSize: '0.78rem' }}>CREATE MATERIALIZED VIEW</code> 语句。
          </p>
          {actionError && (
            <div style={{ color: 'var(--danger-500)', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
              {actionError}
            </div>
          )}
          <textarea
            value={createSql}
            onChange={e => setCreateSql(e.target.value)}
            placeholder={`CREATE MATERIALIZED VIEW my_db.my_mv\nREFRESH ASYNC EVERY(INTERVAL 1 HOUR)\nAS\nSELECT col1, col2, SUM(col3)\nFROM my_table\nGROUP BY col1, col2;`}
            style={{
              width: '100%', minHeight: '220px', padding: '12px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)',
              fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', color: 'var(--text-primary)',
              resize: 'vertical', lineHeight: 1.6,
            }}
          />
        </Modal>

        {/* ========== Delete Modal ========== */}
        <Modal
          open={deleteModal.open}
          onClose={() => { setDeleteModal({ open: false, db: '', name: '' }); setActionError(''); }}
          title={`删除物化视图: ${deleteModal.db}.${deleteModal.name}`}
          maxWidth="500px"
          footer={
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setDeleteModal({ open: false, db: '', name: '' }); setActionError(''); }}>取消</button>
              <button className="btn btn-sm" style={{ backgroundColor: 'var(--danger-500)', color: '#fff', borderColor: 'var(--danger-500)' }} onClick={handleDelete} disabled={deleting}>
                <Trash2 size={14} /> {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          }
        >
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            padding: '12px 14px', borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
            fontSize: '0.82rem', color: 'var(--danger-500)', marginBottom: '12px',
          }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
            <div>此操作不可撤销！删除后物化视图数据将永久丢失。</div>
          </div>
          {actionError && (
            <div style={{ color: 'var(--danger-500)', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
              {actionError}
            </div>
          )}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            确定要删除 <strong style={{ color: 'var(--text-primary)' }}>{deleteModal.db}.{deleteModal.name}</strong> 吗？
          </p>
        </Modal>
      </div>
    </>
  );
}
