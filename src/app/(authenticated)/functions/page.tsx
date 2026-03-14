'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  Code2, RefreshCw, Search, Clock, Filter, Globe, Database,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';

type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />;
  return dir === 'asc'
    ? <ChevronUp size={12} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={12} style={{ color: 'var(--primary-500)' }} />;
}

const FN_TYPE_STYLE: Record<string, { bg: string; border: string; color: string; label: string }> = {
  scalar: { bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.2)', color: 'var(--primary-600)', label: 'Scalar' },
  aggregate: { bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)', color: 'var(--accent-600)', label: 'Aggregate' },
  table: { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.2)', color: 'var(--success-600)', label: 'Table' },
  window: { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.2)', color: 'var(--warning-600)', label: 'Window' },
  unknown: { bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.2)', color: 'var(--text-secondary)', label: 'Other' },
};

function getTypeStyle(type: string) {
  const key = type.toLowerCase().replace(/\s+function$/i, '');
  return FN_TYPE_STYLE[key] || FN_TYPE_STYLE.unknown;
}

export default function FunctionsPage() {
  const { session } = useSession();
  const [functions, setFunctions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<string>('all');

  const fetchFunctions = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/functions?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setFunctions(data.functions || []);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchFunctions(); }, [session, fetchFunctions]);

  const getName = (r: Record<string, unknown>) => String(r['Signature'] || r['Function Name'] || r['Name'] || r['name'] || Object.values(r)[0] || '');
  const getReturnType = (r: Record<string, unknown>) => String(r['Return Type'] || r['return_type'] || r['ReturnType'] || '');
  const getFnType = (r: Record<string, unknown>) => String(r['Type'] || r['type'] || r['Function Type'] || 'Scalar');
  const getIsPersist = (r: Record<string, unknown>) => String(r['Is_persist'] || r['is_persist'] || '');
  const getScope = (r: Record<string, unknown>) => String(r['_scope'] || 'GLOBAL');

  // Get unique types for filter
  const allTypes = Array.from(new Set(functions.map(f => getFnType(f).toLowerCase().replace(/\s+function$/i, '')))).sort();
  const allScopes = Array.from(new Set(functions.map(f => getScope(f)))).sort();

  const filtered = functions
    .filter(f => {
      const name = getName(f).toLowerCase();
      const matchSearch = name.includes(search.toLowerCase()) || getReturnType(f).toLowerCase().includes(search.toLowerCase()) || getScope(f).toLowerCase().includes(search.toLowerCase());
      const matchType = typeFilter === 'all' || getFnType(f).toLowerCase().replace(/\s+function$/i, '') === typeFilter;
      const matchScope = scopeFilter === 'all' || getScope(f) === scopeFilter;
      return matchSearch && matchType && matchScope;
    })
    .sort((a, b) => sortDir === 'asc'
      ? getName(a).localeCompare(getName(b))
      : getName(b).localeCompare(getName(a))
    );

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">函数管理</h1>
            <p className="page-description">
              查看 StarRocks 函数 · {functions.length} 个函数
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => fetchFunctions(true)} disabled={loading || refreshing}>
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

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
            <Search />
            <input className="input" placeholder="搜索函数名或返回类型..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} style={{ color: 'var(--text-tertiary)' }} />
            <select
              className="input"
              style={{ width: 'auto', minWidth: '120px', fontSize: '0.82rem' }}
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="all">全部类型</option>
              {allTypes.map(t => (
                <option key={t} value={t}>{(FN_TYPE_STYLE[t]?.label || t).toUpperCase()}</option>
              ))}
            </select>
            <select
              className="input"
              style={{ width: 'auto', minWidth: '120px', fontSize: '0.82rem' }}
              value={scopeFilter}
              onChange={e => setScopeFilter(e.target.value)}
            >
              <option value="all">全部作用域</option>
              {allScopes.map(s => (
                <option key={s} value={s}>{s === 'GLOBAL' ? '🌐 GLOBAL' : `📁 ${s}`}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><Code2 size={48} /><div className="empty-state-text">{search || typeFilter !== 'all' ? '没有匹配的函数' : '暂无函数'}</div></div>
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
                      函数签名 <SortIcon active dir={sortDir} />
                    </span>
                  </th>
                  <th>返回类型</th>
                  <th>函数类型</th>
                  <th>作用域</th>
                  <th>持久化</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((fn, idx) => {
                  const name = getName(fn);
                  const retType = getReturnType(fn);
                  const fnType = getFnType(fn);
                  const isPersist = getIsPersist(fn);
                  const fnScope = getScope(fn);
                  const typeStyle = getTypeStyle(fnType);

                  return (
                    <tr key={`${name}-${idx}`}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{idx + 1}</td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: 'var(--radius-md)',
                            backgroundColor: typeStyle.bg, color: typeStyle.color,
                            border: `1px solid ${typeStyle.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <Code2 size={13} />
                          </div>
                          <code style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>
                            {name}
                          </code>
                        </div>
                      </td>
                      <td>
                        {retType ? (
                          <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)', padding: '2px 7px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                            {retType}
                          </code>
                        ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '3px 10px', borderRadius: '999px', fontSize: '0.73rem', fontWeight: 600,
                          backgroundColor: typeStyle.bg, color: typeStyle.color,
                          border: `1px solid ${typeStyle.border}`,
                        }}>
                          ● {typeStyle.label}
                        </span>
                      </td>
                      <td>
                        {fnScope === 'GLOBAL' ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                            backgroundColor: 'rgba(139,92,246,0.08)', color: 'var(--accent-600)',
                            border: '1px solid rgba(139,92,246,0.2)',
                          }}>
                            <Globe size={10} /> GLOBAL
                          </span>
                        ) : (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                            backgroundColor: 'rgba(37,99,235,0.08)', color: 'var(--primary-600)',
                            border: '1px solid rgba(37,99,235,0.2)',
                          }}>
                            <Database size={10} /> {fnScope}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isPersist === 'true' ? (
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success-600)' }}>✓</span>
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
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个函数
                {(search || typeFilter !== 'all' || scopeFilter !== 'all') && ` (过滤自 ${functions.length} 个)`}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Code2 size={12} /> SHOW GLOBAL FULL FUNCTIONS + SHOW FULL FUNCTIONS IN db
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
