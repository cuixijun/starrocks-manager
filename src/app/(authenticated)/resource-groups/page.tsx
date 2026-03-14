'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  Layers, Plus, Trash2, RefreshCw, Search, X, Clock,
  Cpu, MemoryStick, ChevronUp, ChevronDown, ChevronsUpDown, Activity, Hash, Zap, Database
} from 'lucide-react';

interface ResourceGroup {
  name: string;
  id: string | number | null;
  cpu_weight: string | number | null;
  exclusive_cpu_cores: string | number | null;
  mem_limit: string | null;
  big_query_cpu_second_limit: string | number | null;
  big_query_scan_rows_limit: string | number | null;
  big_query_mem_limit: string | number | null;
  concurrency_limit: string | number | null;
  spill_mem_limit_threshold: string | null;
  classifiers: string | null;
}

type SortKey = 'name' | 'cpu_weight' | 'concurrency_limit';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={12} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={12} style={{ color: 'var(--primary-500)' }} />;
}

function ValueCell({ value, unit }: { value: string | number | null; unit?: string }) {
  if (value === null || value === undefined || value === '' || value === '0' || value === 0 || value === 'null') {
    return <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>;
  }
  return (
    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
      {String(value)}{unit && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: '2px', fontSize: '0.75rem' }}>{unit}</span>}
    </span>
  );
}

function formatBytes(bytes: string | number | null): string | null {
  if (bytes === null || bytes === undefined || bytes === '' || bytes === 'null') return null;
  const n = Number(bytes);
  if (isNaN(n) || n <= 0) return null;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function parseClassifiers(raw: string | null): { id: string; weight: string; extras: string }[] {
  if (!raw) return [];
  const pattern = /\(([^)]+)\)/g;
  const results: { id: string; weight: string; extras: string }[] = [];
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const inner = match[1];
    const parts: Record<string, string> = {};
    inner.split(',').forEach(part => {
      const [k, v] = part.trim().split('=');
      if (k && v) parts[k.trim()] = v.trim();
    });
    const { id = '?', weight = '?', ...rest } = parts;
    const extras = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(', ');
    results.push({ id, weight, extras });
  }
  return results;
}

const DEFAULT_FORM = {
  name: '', cpuWeight: '', exclusiveCpuCores: '', memLimit: '', concurrencyLimit: '',
  bigQueryCpuSecondLimit: '', bigQueryScanRowsLimit: '', bigQueryMemLimit: '',
};

// Sticky column shared styles
const stickyLeft0Head: React.CSSProperties = {
  position: 'sticky', left: 0, zIndex: 3,
  background: 'var(--bg-tertiary)',
  width: '44px', textAlign: 'center', fontSize: '0.78rem',
};
const stickyLeft44Head: React.CSSProperties = {
  position: 'sticky', left: '44px', zIndex: 3,
  background: 'var(--bg-tertiary)',
  boxShadow: '3px 0 6px -2px rgba(0,0,0,0.08)',
  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', fontSize: '0.78rem',
  minWidth: '120px',
};
const stickyRightHead: React.CSSProperties = {
  position: 'sticky', right: 0, zIndex: 3,
  background: 'var(--bg-tertiary)',
  boxShadow: '-3px 0 6px -2px rgba(0,0,0,0.08)',
  textAlign: 'center', width: '64px', fontSize: '0.78rem',
};
const stickyLeft0Body: React.CSSProperties = {
  position: 'sticky', left: 0, zIndex: 1,
  background: 'var(--bg-primary)',
  textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem', width: '44px',
};
const stickyLeft44Body: React.CSSProperties = {
  position: 'sticky', left: '44px', zIndex: 1,
  background: 'var(--bg-primary)',
  boxShadow: '3px 0 6px -2px rgba(0,0,0,0.06)',
};
const stickyRightBody: React.CSSProperties = {
  position: 'sticky', right: 0, zIndex: 1,
  background: 'var(--bg-primary)',
  boxShadow: '-3px 0 6px -2px rgba(0,0,0,0.06)',
  textAlign: 'center',
};
const thStaticStyle: React.CSSProperties = { whiteSpace: 'nowrap', fontSize: '0.78rem' };

export default function ResourceGroupsPage() {
  const { session } = useSession();
  const [groups, setGroups] = useState<ResourceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [expandedClassifiers, setExpandedClassifiers] = useState<Set<string>>(new Set());
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGroups = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/resource-groups?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setGroups(data.resourceGroups || []);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchGroups(); }, [session, fetchGroups]);
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  async function handleCreate() {
    if (!session || !form.name) return;
    setCreating(true); setError('');
    try {
      const res = await fetch('/api/resource-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'create', ...form }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setShowCreate(false); setForm(DEFAULT_FORM); setSuccess('资源组创建成功'); fetchGroups(); }
    } catch (err) { setError(String(err)); }
    finally { setCreating(false); }
  }

  async function handleDelete(name: string) {
    if (!session || !confirm(`确定要删除资源组 '${name}' 吗？`)) return;
    try {
      const res = await fetch('/api/resource-groups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, name }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess('资源组已删除'); fetchGroups(); }
    } catch (err) { setError(String(err)); }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function toggleClassifiers(name: string) {
    setExpandedClassifiers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const filtered = groups
    .filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'cpu_weight') cmp = Number(a.cpu_weight ?? 0) - Number(b.cpu_weight ?? 0);
      else if (sortKey === 'concurrency_limit') cmp = Number(a.concurrency_limit ?? 0) - Number(b.concurrency_limit ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">资源组管理</h1>
            <p className="page-description">
              管理 StarRocks 资源组 · {groups.length} 个资源组
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => fetchGroups(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> 创建资源组
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
          <input className="input" placeholder="搜索资源组..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Layers size={48} />
            <div className="empty-state-text">{search ? '没有匹配的资源组' : '暂无资源组'}</div>
          </div>
        ) : (
          <>
            <div className="table-container fade-in" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', tableLayout: 'auto' }}>
              <thead>
                <tr>
                  {/* Sticky: # column at left:0 */}
                  <th style={stickyLeft0Head}>#</th>
                  {/* Sticky: 名称 column at left:44px */}
                  <th style={stickyLeft44Head} onClick={() => toggleSort('name')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      名称 <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '64px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Hash size={12} /> ID</span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '72px', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('cpu_weight')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Cpu size={12} /> CPU权重 <SortIcon col="cpu_weight" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '64px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Cpu size={12} /> 独占核数</span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '72px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><MemoryStick size={12} /> 内存限制</span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '72px', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('concurrency_limit')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Activity size={12} /> 并发限制 <SortIcon col="concurrency_limit" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '64px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><MemoryStick size={12} /> 溢出阀値</span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '130px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Zap size={12} /> 大查询限制</span>
                  </th>
                  <th style={{ ...thStaticStyle, minWidth: '200px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Database size={12} /> 分类器</span>
                  </th>
                  {/* Sticky: 操作 column at right:0 */}
                  <th style={stickyRightHead}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g, idx) => {
                  const classifiers = parseClassifiers(g.classifiers);
                  const isExpanded = expandedClassifiers.has(g.name);
                  const hasBigQuery = (g.big_query_cpu_second_limit && Number(g.big_query_cpu_second_limit) > 0)
                    || (g.big_query_scan_rows_limit && Number(g.big_query_scan_rows_limit) > 0)
                    || (g.big_query_mem_limit && Number(g.big_query_mem_limit) > 0);

                  return (
                    <tr key={g.name}>
                      {/* Sticky: # */}
                      <td style={stickyLeft0Body}>{idx + 1}</td>

                      {/* Sticky: 名称 */}
                      <td style={stickyLeft44Body}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: 'var(--radius-md)',
                            backgroundColor: 'rgba(22,163,74,0.08)', color: 'var(--success-600)',
                            border: '1px solid rgba(22,163,74,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <Layers size={13} />
                          </div>
                          <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{g.name}</span>
                        </div>
                      </td>

                      {/* ID */}
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono, monospace)' }}>
                        {g.id ?? '—'}
                      </td>

                      {/* CPU Weight */}
                      <td style={{ textAlign: 'center' }}>
                        <ValueCell value={g.cpu_weight} />
                      </td>

                      {/* Exclusive CPU Cores */}
                      <td style={{ textAlign: 'center' }}>
                        <ValueCell value={g.exclusive_cpu_cores} />
                      </td>

                      {/* Mem Limit */}
                      <td style={{ textAlign: 'center' }}>
                        {g.mem_limit && g.mem_limit !== 'null' ? (
                          <span style={{
                            padding: '2px 9px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 600,
                            backgroundColor: 'rgba(37,99,235,0.08)', color: 'var(--primary-600)',
                            border: '1px solid rgba(37,99,235,0.2)',
                          }}>
                            {g.mem_limit}
                          </span>
                        ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>}
                      </td>

                      {/* Concurrency Limit */}
                      <td style={{ textAlign: 'center' }}>
                        <ValueCell value={g.concurrency_limit} />
                      </td>

                      {/* Spill Threshold */}
                      <td style={{ textAlign: 'center' }}>
                        {g.spill_mem_limit_threshold && g.spill_mem_limit_threshold !== 'null' ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{g.spill_mem_limit_threshold}</span>
                        ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>}
                      </td>

                      {/* Big Query Limits */}
                      <td>
                        {hasBigQuery ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {g.big_query_cpu_second_limit && Number(g.big_query_cpu_second_limit) > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                <Cpu size={10} style={{ flexShrink: 0 }} />
                                <span>CPU: <strong>{g.big_query_cpu_second_limit}</strong>s</span>
                              </div>
                            ) : null}
                            {g.big_query_scan_rows_limit && Number(g.big_query_scan_rows_limit) > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                <Database size={10} style={{ flexShrink: 0 }} />
                                <span>扫描: <strong>{Number(g.big_query_scan_rows_limit).toLocaleString()}</strong> 行</span>
                              </div>
                            ) : null}
                            {g.big_query_mem_limit && Number(g.big_query_mem_limit) > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                <MemoryStick size={10} style={{ flexShrink: 0 }} />
                                <span>内存: <strong>{formatBytes(g.big_query_mem_limit)}</strong></span>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>
                        )}
                      </td>

                      {/* Classifiers */}
                      <td>
                        {classifiers.length === 0 ? (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>无</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {(isExpanded ? classifiers : classifiers.slice(0, 1)).map((c, i) => (
                              <div key={i} style={{
                                fontSize: '0.73rem', padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)',
                                color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)',
                              }}>
                                <span style={{ color: 'var(--text-tertiary)' }}>#{c.id}</span>
                                <span style={{ marginLeft: '4px', color: 'var(--primary-600)', fontWeight: 600 }}>w={c.weight}</span>
                                {c.extras && <span style={{ marginLeft: '4px', color: 'var(--text-secondary)' }}>{c.extras}</span>}
                              </div>
                            ))}
                            {classifiers.length > 1 && (
                              <button
                                onClick={() => toggleClassifiers(g.name)}
                                style={{
                                  fontSize: '0.72rem', color: 'var(--primary-600)', background: 'none',
                                  border: 'none', cursor: 'pointer', textAlign: 'left', padding: '0',
                                }}
                              >
                                {isExpanded ? '▲ 收起' : `▼ 展开全部 ${classifiers.length} 条`}
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Sticky: 操作 */}
                      <td style={stickyRightBody}>
                        <button
                          className="btn btn-ghost btn-icon"
                          style={{ color: 'var(--danger-500)' }}
                          onClick={() => handleDelete(g.name)}
                          title="删除资源组"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{
            padding: '8px 16px',
            fontSize: '0.78rem', color: 'var(--text-tertiary)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--bg-secondary)',
            borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
            border: '1px solid var(--border-primary)',
            borderTop: 'none',
            marginTop: '-4px',
          }}>
            <span>
              共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个资源组
              {search && ` (过滤自 ${groups.length} 个)`}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Layers size={12} /> SHOW RESOURCE GROUPS ALL
            </span>
          </div>
          </>
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">创建资源组</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowCreate(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">资源组名称 <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                  <input className="input" placeholder="my_resource_group" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>

                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px', marginTop: '4px' }}>
                  CPU 配置
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">CPU 权重 (cpu_weight)</label>
                    <input className="input" type="number" placeholder="例如：16" value={form.cpuWeight} onChange={e => setForm({ ...form, cpuWeight: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">独占核数 (exclusive_cpu_cores)</label>
                    <input className="input" type="number" placeholder="例如：4" value={form.exclusiveCpuCores} onChange={e => setForm({ ...form, exclusiveCpuCores: e.target.value })} />
                  </div>
                </div>

                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>
                  内存 &amp; 并发配置
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">内存限制 (mem_limit)</label>
                    <input className="input" placeholder='例如：20%' value={form.memLimit} onChange={e => setForm({ ...form, memLimit: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">并发限制 (concurrency_limit)</label>
                    <input className="input" type="number" placeholder="例如：10" value={form.concurrencyLimit} onChange={e => setForm({ ...form, concurrencyLimit: e.target.value })} />
                  </div>
                </div>

                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>
                  大查询限制 (可选)
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">CPU 时间限制 (秒)</label>
                    <input className="input" type="number" placeholder="例如：100" value={form.bigQueryCpuSecondLimit} onChange={e => setForm({ ...form, bigQueryCpuSecondLimit: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">扫描行数限制</label>
                    <input className="input" type="number" placeholder="例如：1000000" value={form.bigQueryScanRowsLimit} onChange={e => setForm({ ...form, bigQueryScanRowsLimit: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">大查询内存限制</label>
                  <input className="input" placeholder='例如：1073741824 (bytes)' value={form.bigQueryMemLimit} onChange={e => setForm({ ...form, bigQueryMemLimit: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !form.name}>
                  {creating ? <span className="spinner" /> : <Plus size={16} />}
                  创建
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
