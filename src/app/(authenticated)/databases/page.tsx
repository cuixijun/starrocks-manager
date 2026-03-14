'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import Link from 'next/link';
import {
  Database, Search, Table2, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown, ArrowRight, Clock
} from 'lucide-react';

interface DbInfo {
  name: string;
  tableCount: number;
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

  const fetchDatabases = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/databases?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setDatabases(
          (data.databases || []).map((d: { name: string; tableCount: number }) => ({
            ...d,
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

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">数据库浏览</h1>
            <p className="page-description">
              查看和管理数据库 · {databases.length} 个数据库
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => fetchDatabases(true)} disabled={loading || refreshing}>
            <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} />
            {refreshing ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div style={{
            color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px',
            background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem'
          }}>
            {error}
          </div>
        )}

        {/* Search */}
        <div className="search-bar mb-4">
          <Search />
          <input
            className="input"
            placeholder="搜索数据库名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
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
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('tableCount')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', float: 'right' }}>
                      <Table2 size={13} /> 表数量 <SortIcon col="tableCount" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <Clock size={13} /> 缓存时间
                    </span>
                  </th>
                  <th style={{ textAlign: 'center', width: '80px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((db, idx) => (
                  <tr key={db.name}>
                    {/* Index */}
                    <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                      {idx + 1}
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
                        <div style={{
                          width: '28px', height: '28px', borderRadius: 'var(--radius-md)',
                          backgroundColor: 'var(--primary-50)', color: 'var(--primary-600)',
                          border: '1px solid var(--primary-100)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <Database size={14} />
                        </div>
                        {db.name}
                      </Link>
                    </td>

                    {/* Table count */}
                    <td style={{ textAlign: 'right' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        padding: '3px 10px', borderRadius: '999px',
                        backgroundColor: db.tableCount > 0 ? 'var(--primary-50)' : 'var(--bg-secondary)',
                        color: db.tableCount > 0 ? 'var(--primary-600)' : 'var(--text-tertiary)',
                        border: `1px solid ${db.tableCount > 0 ? 'var(--primary-100)' : 'var(--border-secondary)'}`,
                        fontSize: '0.8rem', fontWeight: 600,
                      }}>
                        <Table2 size={12} />
                        {db.tableCount.toLocaleString()}
                      </span>
                    </td>

                    {/* Cached at */}
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {db.cachedAt ?? '-'}
                    </td>

                    {/* Action */}
                    <td style={{ textAlign: 'center' }}>
                      <Link
                        href={`/databases/${encodeURIComponent(db.name)}`}
                        className="btn btn-ghost btn-icon"
                        title={`进入 ${db.name}`}
                        style={{ display: 'inline-flex' }}
                      >
                        <ArrowRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer summary */}
            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--border-secondary)',
              fontSize: '0.78rem', color: 'var(--text-tertiary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个数据库
                {search && ` (过滤自 ${databases.length} 个)`}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Database size={12} /> 数据已缓存至本地 SQLite
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
