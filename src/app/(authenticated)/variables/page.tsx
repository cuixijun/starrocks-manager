'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  Settings, RefreshCw, Search, Clock, Filter, Edit3, Check, X, ChevronDown, ChevronRight,
} from 'lucide-react';

/* ── Variable Category Mapping ── */
const CATEGORY_MAP: Record<string, string[]> = {
  '查询执行': [
    'query_timeout', 'parallel_fragment_exec_instance_num', 'pipeline_dop', 'enable_pipeline',
    'enable_profile', 'max_execution_time', 'query_delivery_timeout', 'query_queue_',
    'enable_materialized_view_rewrite', 'enable_async_profile', 'runtime_filter',
    'global_runtime_filter', 'runtime_join_filter', 'hash_join', 'broadcast_row_limit',
    'new_planner_agg_stage', 'enable_spill', 'spill_mode', 'enable_query_cache',
    'query_cache_', 'wait_timeout', 'interactive_timeout', 'net_read_timeout', 'net_write_timeout',
    'enable_adaptive_sink_dop', 'max_scan_key_num', 'max_pushdown_conditions_per_column',
  ],
  '内存管理': [
    'exec_mem_limit', 'load_mem_limit', 'query_mem_limit', 'spill_mem_limit',
    'spill_mem_table_', 'connector_sink_mem_limit',
    'disable_mem_pools', 'memory_limitation_per_scan_instance',
  ],
  '存储与 IO': [
    'storage_', 'io_tasks_per_scan_operator', 'connector_io_tasks_per_scan_operator',
    'scan_or_io', 'enable_connector_adaptive_io_tasks',
    'lake_', 'tablet_',
  ],
  '优化器': [
    'cbo_', 'enable_cbo_table_prune', 'enable_prune_complex_types',
    'materialized_view_', 'enable_rule_based_materialized_view_rewrite',
    'optimizer_', 'enable_count_star_optimization', 'enable_partition_column_value_only_optimization',
  ],
  '导入导出': [
    'load_', 'stream_load_', 'enable_insert_strict', 'insert_timeout',
    'enable_load_profile', 'max_filter_ratio',
  ],
  '系统与安全': [
    'system_time_zone', 'time_zone', 'sql_mode', 'character_set_',
    'collation_', 'lower_case_table_names', 'license', 'language', 'version',
    'auto_increment_increment', 'enable_strict_type', 'sql_safe_updates', 'tx_isolation',
    'autocommit', 'sql_dialect', 'group_concat_max_len',
  ],
  '会话信息': [
    'is_report_success', 'profiling', 'have_query_cache', 'performance_schema',
    'enable_adaptive_sink_dop', 'max_allowed_packet', 'div_precision_increment',
    'event_scheduler', 'block_encryption_mode', 'SQL_AUTO_IS_NULL',
  ],
};

function categorize(name: string): string {
  for (const [category, patterns] of Object.entries(CATEGORY_MAP)) {
    for (const pattern of patterns) {
      if (pattern.endsWith('_')) {
        if (name.startsWith(pattern) || name.startsWith(pattern.slice(0, -1))) return category;
      } else if (name === pattern) {
        return category;
      }
    }
  }
  return '其他';
}

const CATEGORY_ICONS: Record<string, { emoji: string; bg: string; color: string }> = {
  '查询执行': { emoji: '⚡', bg: 'rgba(37,99,235,0.08)', color: 'var(--primary-600)' },
  '内存管理': { emoji: '🧠', bg: 'rgba(139,92,246,0.08)', color: 'var(--accent-600)' },
  '存储与 IO': { emoji: '💾', bg: 'rgba(22,163,74,0.08)', color: 'var(--success-600)' },
  '优化器': { emoji: '🎯', bg: 'rgba(234,179,8,0.08)', color: 'var(--warning-600)' },
  '导入导出': { emoji: '📦', bg: 'rgba(6,182,212,0.08)', color: '#0891b2' },
  '系统与安全': { emoji: '🔒', bg: 'rgba(239,68,68,0.08)', color: 'var(--danger-500)' },
  '会话信息': { emoji: '📋', bg: 'rgba(107,114,128,0.08)', color: 'var(--text-secondary)' },
  '其他': { emoji: '📌', bg: 'rgba(107,114,128,0.05)', color: 'var(--text-tertiary)' },
};

interface VarEntry { name: string; value: string }

export default function VariablesPage() {
  const { session } = useSession();
  const [variables, setVariables] = useState<VarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState<'session' | 'global'>('session');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchVariables = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/variables?sessionId=${encodeURIComponent(session.sessionId)}&scope=${scope}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        const vars: VarEntry[] = (data.variables || []).map((r: Record<string, unknown>) => ({
          name: String(r['Variable_name'] || r['variable_name'] || Object.keys(r)[0] || ''),
          value: String(r['Value'] || r['value'] || Object.values(r)[1] || ''),
        }));
        setVariables(vars);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session, scope]);

  useEffect(() => { if (session) fetchVariables(); }, [session, scope, fetchVariables]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  async function handleSave(name: string) {
    if (!session) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/variables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          name,
          value: editValue,
          global: scope === 'global',
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setEditingVar(null);
        setSuccess(`变量 ${name} 修改成功`);
        fetchVariables(true);
      }
    } catch (err) { setError(String(err)); }
    finally { setSaving(false); }
  }

  function toggleCategory(cat: string) {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  // Filtered vars
  const filtered = variables.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) || v.value.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || categorize(v.name) === categoryFilter;
    return matchSearch && matchCategory;
  });

  // Group by category
  const grouped: Record<string, VarEntry[]> = {};
  for (const v of filtered) {
    const cat = categorize(v.name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(v);
  }
  // Sort categories: defined order first, then '其他'
  const categoryOrder = [...Object.keys(CATEGORY_MAP), '其他'];
  const sortedCategories = Object.keys(grouped).sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b));

  // All unique categories for filter
  const allCategories = Array.from(new Set(variables.map(v => categorize(v.name)))).sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b));

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">变量管理</h1>
            <p className="page-description">
              管理 StarRocks 系统变量 · {variables.length} 个变量
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => fetchVariables(true)} disabled={loading || refreshing}>
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
        {success && <div className="toast toast-success">{success}</div>}

        {/* Scope tabs */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '3px', border: '1px solid var(--border-secondary)', width: 'fit-content' }}>
          {(['session', 'global'] as const).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding: '6px 18px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                backgroundColor: scope === s ? 'var(--bg-primary)' : 'transparent',
                color: scope === s ? 'var(--primary-600)' : 'var(--text-secondary)',
                boxShadow: scope === s ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {s === 'session' ? '📋 Session 变量' : '🌐 Global 变量'}
            </button>
          ))}
        </div>

        {/* Search + Category filter */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
            <Search />
            <input className="input" placeholder="搜索变量名或值..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} style={{ color: 'var(--text-tertiary)' }} />
            <select
              className="input"
              style={{ width: 'auto', minWidth: '140px', fontSize: '0.82rem' }}
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
            >
              <option value="all">全部分类</option>
              {allCategories.map(c => (
                <option key={c} value={c}>{(CATEGORY_ICONS[c]?.emoji || '📌')} {c}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><Settings size={48} /><div className="empty-state-text">{search || categoryFilter !== 'all' ? '没有匹配的变量' : '暂无变量'}</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sortedCategories.map(cat => {
              const items = grouped[cat];
              const catStyle = CATEGORY_ICONS[cat] || CATEGORY_ICONS['其他'];
              const isCollapsed = collapsedCategories.has(cat);

              return (
                <div key={cat} className="fade-in" style={{
                  border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden', backgroundColor: 'var(--bg-primary)',
                }}>
                  {/* Category header */}
                  <div
                    onClick={() => toggleCategory(cat)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 16px', cursor: 'pointer', userSelect: 'none',
                      backgroundColor: catStyle.bg, borderBottom: isCollapsed ? 'none' : '1px solid var(--border-secondary)',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.88rem', color: catStyle.color }}>
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      {catStyle.emoji} {cat}
                      <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        ({items.length})
                      </span>
                    </span>
                  </div>

                  {/* Variable rows */}
                  {!isCollapsed && (
                    <div>
                      {items.map(v => {
                        const isEditing = editingVar === v.name;
                        return (
                          <div key={v.name} style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '8px 16px', borderBottom: '1px solid var(--border-secondary)',
                            fontSize: '0.84rem', transition: 'background 0.1s',
                          }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <code style={{
                              flex: '0 0 320px', fontWeight: 600, color: 'var(--text-primary)',
                              fontFamily: 'var(--font-mono, monospace)', fontSize: '0.82rem',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {v.name}
                            </code>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {isEditing ? (
                                <>
                                  <input
                                    className="input"
                                    style={{ flex: 1, fontSize: '0.82rem', padding: '4px 8px' }}
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') handleSave(v.name); if (e.key === 'Escape') setEditingVar(null); }}
                                  />
                                  <button className="btn btn-ghost btn-icon" onClick={() => handleSave(v.name)} disabled={saving} style={{ color: 'var(--success-600)' }}>
                                    <Check size={14} />
                                  </button>
                                  <button className="btn btn-ghost btn-icon" onClick={() => setEditingVar(null)} style={{ color: 'var(--text-tertiary)' }}>
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <code style={{
                                    flex: 1, fontSize: '0.8rem', color: 'var(--text-secondary)',
                                    fontFamily: 'var(--font-mono, monospace)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {v.value || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>empty</span>}
                                  </code>
                                  <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => { setEditingVar(v.name); setEditValue(v.value); }}
                                    style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}
                                    title="修改变量值"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Footer */}
            <div style={{
              padding: '10px 16px',
              fontSize: '0.78rem', color: 'var(--text-tertiary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个变量，
                分布在 {sortedCategories.length} 个分类
                {(search || categoryFilter !== 'all') && ` (过滤自 ${variables.length} 个)`}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Settings size={12} /> SHOW {scope === 'global' ? 'GLOBAL ' : ''}VARIABLES
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
