'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  FolderTree, RefreshCw, Search, Clock,
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
  jdbc: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', color: 'var(--danger-500)' },
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

  const filtered = catalogs
    .filter(c => getName(c).toLowerCase().includes(search.toLowerCase()) || getType(c).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortDir === 'asc'
      ? getName(a).localeCompare(getName(b))
      : getName(b).localeCompare(getName(a))
    );

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
          <button className="btn btn-secondary" onClick={() => fetchCatalogs(true)} disabled={loading || refreshing}>
            <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
          </button>
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
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => {
                  const name = getName(c);
                  const type = getType(c);
                  const comment = getComment(c);
                  const typeStyle = getTypeStyle(type);
                  const isDefault = name === 'default_catalog' || type.toLowerCase() === 'internal';

                  return (
                    <tr key={name}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{idx + 1}</td>
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
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个 Catalog
                {search && ` (过滤自 ${catalogs.length} 个)`}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <FolderTree size={12} /> SHOW CATALOGS
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
