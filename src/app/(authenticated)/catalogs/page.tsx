'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePagination } from '@/hooks/usePagination';
import { Pagination } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import SqlHighlighter from '@/components/SqlHighlighter';
import {
  FolderTree, RefreshCw, Search, Clock, Plus,
  Eye, Trash2, Copy, Check, AlertTriangle,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';

type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />;
  return dir === 'asc'
    ? <ChevronUp size={12} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={12} style={{ color: 'var(--primary-500)' }} />;
}

const CATALOG_TYPE_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  internal: { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.2)', color: 'var(--success-600)' },
  hive: { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.2)', color: 'var(--warning-600)' },
  iceberg: { bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.2)', color: 'var(--primary-600)' },
  hudi: { bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)', color: 'var(--accent-600)' },
  jdbc: { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)', color: '#6366f1' },
  paimon: { bg: 'rgba(6,182,212,0.08)', border: 'rgba(6,182,212,0.2)', color: '#0891b2' },
  default_catalog: { bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.2)', color: 'var(--text-secondary)' },
};

function getTypeStyle(type: string) {
  const key = type.toLowerCase();
  return CATALOG_TYPE_COLORS[key] || CATALOG_TYPE_COLORS.default_catalog;
}

export default function CatalogsPage() {
  const { session } = useSession();
  const [catalogs, setCatalogs] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Modal states
  const [viewModal, setViewModal] = useState<{ open: boolean; name: string; ddl: string; loading: boolean }>({ open: false, name: '', ddl: '', loading: false });
  const [createModal, setCreateModal] = useState(false);
  const [createSql, setCreateSql] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; name: string }>({ open: false, name: '' });
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchCatalogs = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/catalogs?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setCatalogs(data.catalogs || []);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchCatalogs(); }, [session, fetchCatalogs]);

  const getName = (r: Record<string, unknown>) => String(r['Catalog'] || r['catalog'] || r['CatalogName'] || Object.values(r)[0] || '');
  const getType = (r: Record<string, unknown>) => String(r['Type'] || r['type'] || r['CatalogType'] || Object.values(r)[1] || 'internal');
  const getComment = (r: Record<string, unknown>) => String(r['Comment'] || r['comment'] || '');

  // Sort: default_catalog first, then alphabetical
  const filtered = catalogs
    .filter(c => getName(c).toLowerCase().includes(search.toLowerCase()) || getType(c).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const nameA = getName(a);
      const nameB = getName(b);
      const isDefaultA = nameA === 'default_catalog';
      const isDefaultB = nameB === 'default_catalog';
      if (isDefaultA && !isDefaultB) return -1;
      if (!isDefaultA && isDefaultB) return 1;
      return sortDir === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });

  const pg = usePagination(filtered);

  // View DDL
  async function openViewModal(name: string) {
    if (!session) return;
    setViewModal({ open: true, name, ddl: '', loading: true });
    setActionError('');
    setCopied(false);
    try {
      const res = await fetch(`/api/catalogs/${encodeURIComponent(name)}?sessionId=${encodeURIComponent(session.sessionId)}`);
      const data = await res.json();
      if (data.error) {
        setViewModal(v => ({ ...v, loading: false }));
        setActionError(data.error);
      } else {
        setViewModal({ open: true, name, ddl: data.ddl || '无法获取 DDL', loading: false });
      }
    } catch (err) {
      setViewModal(v => ({ ...v, loading: false }));
      setActionError(String(err));
    }
  }

  function copyDdl() {
    navigator.clipboard.writeText(viewModal.ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Create
  async function handleCreate() {
    if (!session || !createSql.trim()) return;
    setCreating(true);
    setActionError('');
    try {
      const res = await fetch('/api/catalogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, sql: createSql.trim() }),
      });
      const data = await res.json();
      if (data.error) { setActionError(data.error); }
      else {
        setCreateModal(false);
        setCreateSql('');
        fetchCatalogs(true);
      }
    } catch (err) { setActionError(String(err)); }
    finally { setCreating(false); }
  }

  // Delete
  async function handleDelete() {
    if (!session || !deleteModal.name) return;
    setDeleting(true);
    setActionError('');
    try {
      const res = await fetch('/api/catalogs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, catalogName: deleteModal.name }),
      });
      const data = await res.json();
      if (data.error) { setActionError(data.error); }
      else {
        setDeleteModal({ open: false, name: '' });
        fetchCatalogs(true);
      }
    } catch (err) { setActionError(String(err)); }
    finally { setDeleting(false); }
  }

  const warningStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: '10px',
    padding: '12px 14px', borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
    fontSize: '0.82rem', color: 'var(--danger-500)', marginBottom: '12px',
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Catalog 管理</h1>
            <p className="page-description">
              管理 StarRocks 数据目录 · {catalogs.length} 个 Catalog
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
              <Plus size={16} /> 创建 Catalog
            </button>
            <button className="btn btn-secondary" onClick={() => fetchCatalogs(true)} disabled={loading || refreshing}>
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

        <div className="search-bar mb-4">
          <Search />
          <input className="input" placeholder="搜索 Catalog 名称或类型..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><FolderTree size={48} /><div className="empty-state-text">{search ? '没有匹配的 Catalog' : '暂无 Catalog'}</div></div>
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
                      Catalog 名称 <SortIcon active dir={sortDir} />
                    </span>
                  </th>
                  <th>类型</th>
                  <th>备注</th>
                  <th style={{ textAlign: 'center', width: '200px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pg.paginatedData.map((c, idx) => {
                  const globalIdx = (pg.page - 1) * pg.pageSize + idx;
                  const name = getName(c);
                  const type = getType(c);
                  const comment = getComment(c);
                  const typeStyle = getTypeStyle(type);
                  const isDefault = name === 'default_catalog' || type.toLowerCase() === 'internal';

                  return (
                    <tr key={name}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{globalIdx + 1}</td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '30px', height: '30px', borderRadius: 'var(--radius-md)',
                            backgroundColor: typeStyle.bg, color: typeStyle.color,
                            border: `1px solid ${typeStyle.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <FolderTree size={14} />
                          </div>
                          <div>
                            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{name}</span>
                            {isDefault && (
                              <span style={{ marginLeft: '8px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, backgroundColor: 'rgba(22,163,74,0.08)', color: 'var(--success-600)', border: '1px solid rgba(22,163,74,0.2)' }}>
                                DEFAULT
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
                          backgroundColor: typeStyle.bg, color: typeStyle.color,
                          border: `1px solid ${typeStyle.border}`,
                        }}>
                          ● {type}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {comment || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            className="btn btn-sm"
                            style={{ color: 'var(--primary-600)', borderColor: 'var(--primary-200)', backgroundColor: 'var(--primary-50)' }}
                            onClick={() => openViewModal(name)}
                          >
                            <Eye size={14} /> 查看
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{
                              color: isDefault ? 'var(--text-tertiary)' : 'var(--danger-500)',
                              borderColor: isDefault ? 'var(--border-secondary)' : 'rgba(239,68,68,0.3)',
                              backgroundColor: isDefault ? 'var(--bg-secondary)' : 'rgba(239,68,68,0.05)',
                              cursor: isDefault ? 'not-allowed' : 'pointer',
                              opacity: isDefault ? 0.5 : 1,
                            }}
                            disabled={isDefault}
                            onClick={() => { setDeleteModal({ open: true, name }); setActionError(''); }}
                          >
                            <Trash2 size={14} /> 删除
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
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个 Catalog
                {search && ` (过滤自 ${catalogs.length} 个)`}
              </span>
              <Pagination page={pg.page} pageSize={pg.pageSize} totalPages={pg.totalPages} totalItems={pg.totalItems} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
            </div>
          </div>
        )}
      </div>

      {/* ========== View DDL Modal ========== */}
      <Modal
        open={viewModal.open}
        onClose={() => setViewModal({ open: false, name: '', ddl: '', loading: false })}
        title={`查看 Catalog: ${viewModal.name}`}
        maxWidth="680px"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={copyDdl} disabled={viewModal.loading}>
              {copied ? <><Check size={14} /> 已复制</> : <><Copy size={14} /> 复制 DDL</>}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setViewModal({ open: false, name: '', ddl: '', loading: false })}>
              关闭
            </button>
          </div>
        }
      >
        {viewModal.loading ? (
          <div style={{ textAlign: 'center', padding: '24px' }}><div className="spinner" /> 加载中...</div>
        ) : actionError ? (
          <div style={{ color: 'var(--danger-500)', fontSize: '0.85rem' }}>{actionError}</div>
        ) : (
          <SqlHighlighter sql={viewModal.ddl} />
        )}
      </Modal>

      {/* ========== Create Catalog Modal ========== */}
      <Modal
        open={createModal}
        onClose={() => { setCreateModal(false); setActionError(''); }}
        title="创建外部 Catalog"
        maxWidth="700px"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setCreateModal(false); setActionError(''); }}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating || !createSql.trim()}>
              {creating ? '创建中...' : '执行创建'}
            </button>
          </div>
        }
      >
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          输入 <code style={{ padding: '2px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', fontSize: '0.78rem' }}>CREATE EXTERNAL CATALOG</code> 语句来创建外部 Catalog。
        </p>
        {actionError && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
            {actionError}
          </div>
        )}
        <textarea
          value={createSql}
          onChange={e => setCreateSql(e.target.value)}
          placeholder={`CREATE EXTERNAL CATALOG my_hive_catalog\nPROPERTIES (\n  "type" = "hive",\n  "hive.metastore.type" = "hive",\n  "hive.metastore.uris" = "thrift://host:9083"\n);`}
          style={{
            width: '100%', minHeight: '200px', padding: '12px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)',
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', color: 'var(--text-primary)',
            resize: 'vertical', lineHeight: 1.6,
          }}
        />
      </Modal>

      {/* ========== Delete Confirmation Modal ========== */}
      <Modal
        open={deleteModal.open}
        onClose={() => { setDeleteModal({ open: false, name: '' }); setActionError(''); }}
        title={`删除 Catalog: ${deleteModal.name}`}
        maxWidth="500px"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDeleteModal({ open: false, name: '' }); setActionError(''); }}>
              取消
            </button>
            <button
              className="btn btn-sm"
              style={{ backgroundColor: 'var(--danger-500)', color: '#fff', borderColor: 'var(--danger-500)' }}
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 size={14} /> {deleting ? '删除中...' : '确认删除'}
            </button>
          </div>
        }
      >
        <div style={warningStyle}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>
            <strong>⚠️ 此操作不可撤销，且会导致以下问题：</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px', lineHeight: 1.8 }}>
              <li>该 Catalog 下所有已授权的权限将会丢失</li>
              <li>关联该 Catalog 的角色和用户需要 <strong>重新授权</strong></li>
              <li>依赖该 Catalog 的查询将无法执行</li>
            </ul>
          </div>
        </div>
        {actionError && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
            {actionError}
          </div>
        )}
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          确定要删除 Catalog <strong style={{ color: 'var(--text-primary)' }}>{deleteModal.name}</strong> 吗？
        </p>
      </Modal>
    </>
  );
}
