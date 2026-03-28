'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, ErrorBanner, SuccessToast, DataTable } from '@/components/ui';
import {
  ScrollText, RefreshCw, Search, Shield, ShieldAlert, ShieldCheck, ShieldOff,
  LogIn, LogOut, UserPlus, UserMinus, UserCog, Settings2, ChevronDown, X, Info, Download,
  Database, Trash2, Server, ServerCrash, KeyRound, Terminal, Clock, Tag,
} from 'lucide-react';
import { apiFetch } from '@/lib/fetch-patch';

interface AuditLog {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  category: string;
  level: string;
  target: string;
  detail: string;
  ip_address: string;
  created_at: string;
}

interface LevelOption { value: string; label: string; desc: string; }

/* ─── Static Maps ─── */

const TIME_RANGE_OPTIONS = [
  { value: '1h', label: '最近 1 小时' },
  { value: '6h', label: '最近 6 小时' },
  { value: '24h', label: '最近 24 小时' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: 'all', label: '全部时间' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: '全部分类' },
  { value: 'auth', label: '认证' },
  { value: 'user', label: '用户' },
  { value: 'config', label: '配置' },
  { value: 'cluster', label: '集群' },
  { value: 'permission', label: '权限' },
  { value: 'query', label: '查询' },
  { value: 'system', label: '系统' },
];

const LEVEL_COLORS: Record<string, string> = {
  off: '#6b7280', basic: '#ef4444', standard: '#3b82f6', full: '#8b5cf6',
};
const LEVEL_ICONS: Record<string, React.ElementType> = {
  off: ShieldOff, basic: Shield, standard: ShieldCheck, full: ShieldAlert,
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  'auth.login': LogIn, 'auth.logout': LogOut,
  'user.create': UserPlus, 'user.update': UserCog, 'user.delete': UserMinus,
  'config.audit_level_change': Settings2,
  'database.create': Database, 'database.drop': Trash2,
  'cluster.create': Server, 'cluster.update': Server, 'cluster.delete': ServerCrash,
  'permission.grant_privilege': KeyRound, 'permission.revoke_privilege': KeyRound,
  'permission.grant_role': KeyRound, 'permission.revoke_role': KeyRound,
  'query.execute': Terminal,
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: '认证', user: '用户', config: '配置', cluster: '集群',
  permission: '权限', query: '查询', system: '系统',
};
const CATEGORY_COLORS: Record<string, string> = {
  auth: '#f59e0b', user: '#3b82f6', config: '#8b5cf6', cluster: '#10b981',
  permission: '#ef4444', query: '#06b6d4', system: '#6b7280',
};

const ACTION_LABELS: Record<string, string> = {
  'auth.login': '用户登录', 'auth.logout': '用户登出',
  'user.create': '创建用户', 'user.update': '更新用户', 'user.delete': '删除用户',
  'config.audit_level_change': '审计级别变更',
  'database.create': '创建数据库', 'database.drop': '删除数据库',
  'cluster.create': '创建集群', 'cluster.update': '更新集群', 'cluster.delete': '删除集群',
  'permission.grant_privilege': '授予权限', 'permission.revoke_privilege': '撤销权限',
  'permission.grant_role': '授予角色', 'permission.revoke_role': '撤销角色',
  'query.execute': 'SQL 执行',
};

/* ─── Helpers ─── */

function getTimeRangeISO(range: string): { startDate?: string; endDate?: string } {
  if (range === 'all') return {};
  const now = new Date();
  const msMap: Record<string, number> = {
    '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000,
    '7d': 7 * 86400_000, '30d': 30 * 86400_000,
  };
  const ms = msMap[range] || 3600_000;
  const start = new Date(now.getTime() - ms);
  // Format as local time (Shanghai) YYYY-MM-DD HH:MM:SS
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  return { startDate: fmt(start), endDate: fmt(now) };
}

function formatTime(dateStr: string) {
  try {
    let d: Date;
    if (dateStr.includes('T') || dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
      // ISO format or timezone-qualified
      d = new Date(dateStr);
    } else {
      // Plain datetime "YYYY-MM-DD HH:MM:SS" → treat as Shanghai local time (+08:00)
      d = new Date(dateStr.replace(' ', 'T') + '+08:00');
    }
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return dateStr; }
}

function formatDetailRich(log: AuditLog): React.ReactNode {
  const rows: { label: string; value: string }[] = [
    { label: '审计 ID', value: String(log.id) },
    { label: '时间', value: formatTime(log.created_at) },
    { label: '用户', value: log.username || '—' },
    { label: '操作', value: ACTION_LABELS[log.action] || log.action },
    { label: '分类', value: CATEGORY_LABELS[log.category] || log.category },
    { label: '操作对象', value: log.target || '—' },
    { label: 'IP 地址', value: log.ip_address || '—' },
    { label: '审计级别', value: log.level || '—' },
  ];

  let detailObj: Record<string, unknown> | null = null;
  if (log.detail) {
    try { detailObj = JSON.parse(log.detail); } catch { /* raw string */ }
  }

  const kvStyle: React.CSSProperties = {
    display: 'flex', gap: '8px', padding: '5px 0',
    borderBottom: '1px solid var(--border-secondary)', fontSize: '0.78rem',
  };
  const labelStyle: React.CSSProperties = {
    width: '70px', flexShrink: 0, color: 'var(--text-tertiary)', fontWeight: 500,
  };
  const valStyle: React.CSSProperties = {
    color: 'var(--text-primary)', flex: 1, wordBreak: 'break-all',
  };

  return (
    <div>
      {rows.map(r => (
        <div key={r.label} style={kvStyle}>
          <span style={labelStyle}>{r.label}</span>
          <span style={valStyle}>{r.value}</span>
        </div>
      ))}
      {detailObj && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>扩展详情</div>
          <pre style={{
            fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
            padding: '8px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)',
          }}>
            {JSON.stringify(detailObj, null, 2)}
          </pre>
        </div>
      )}
      {log.detail && !detailObj && (
        <div style={kvStyle}>
          <span style={labelStyle}>详情</span>
          <span style={valStyle}>{log.detail}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Custom Dropdown ─── */

interface DropdownOption { value: string; label: string; }

function FilterDropdown({
  icon, label, value, options, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-sm btn-secondary"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          fontSize: '0.8rem', padding: '5px 10px',
          borderColor: value ? 'var(--primary-400)' : undefined,
          backgroundColor: value ? 'rgba(99,102,241,0.06)' : undefined,
        }}
      >
        {icon}
        <span style={{ color: 'var(--text-tertiary)' }}>{label}:</span>
        <span style={{ fontWeight: 600, color: value ? 'var(--primary-500)' : 'var(--text-primary)' }}>{selected?.label || value}</span>
        <ChevronDown size={12} style={{ color: 'var(--text-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
          background: 'var(--bg-primary)', border: '1px solid var(--border-secondary)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
          minWidth: '160px', padding: '4px', animation: 'fadeIn 0.12s ease',
          maxHeight: '280px', overflowY: 'auto',
        }}>
          {options.map(opt => {
            const isActive = opt.value === value;
            return (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                  padding: '7px 12px', borderRadius: 'var(--radius-sm)',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontSize: '0.8rem',
                  backgroundColor: isActive ? 'var(--primary-50, rgba(99,102,241,0.08))' : 'transparent',
                  color: isActive ? 'var(--primary-500)' : 'var(--text-primary)',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span style={{ flex: 1 }}>{opt.label}</span>
                {isActive && <span style={{ color: 'var(--primary-500)', fontSize: '0.75rem' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Component ─── */

export default function AuditPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Audit config
  const [currentLevel, setCurrentLevel] = useState('standard');
  const [levelOptions, setLevelOptions] = useState<LevelOption[]>([]);
  const [savingLevel, setSavingLevel] = useState(false);
  const [showLevelMenu, setShowLevelMenu] = useState(false);

  // Audit logs
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [exporting, setExporting] = useState(false);

  // Filters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [category, setCategory] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [timeRange, setTimeRange] = useState('1h');

  // Detail panel
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Close detail on click outside or Escape
  useEffect(() => {
    if (detailId === null) return;
    function handleClick(e: MouseEvent) {
      if (detailRef.current && !detailRef.current.contains(e.target as Node)) {
        // Don't close if clicking the info button itself
        const target = e.target as HTMLElement;
        if (target.closest('[data-detail-btn]')) return;
        setDetailId(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDetailId(null);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [detailId]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/audit-config');
      const data = await res.json();
      if (data.level) setCurrentLevel(data.level);
      if (data.levelOptions) setLevelOptions(data.levelOptions);
    } catch { /* ignore */ }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (category) params.set('category', category);
      if (searchUser) params.set('username', searchUser);
      const { startDate, endDate } = getTimeRangeISO(timeRange);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const res = await apiFetch(`/api/audit-logs?${params}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, [page, pageSize, category, searchUser, timeRange]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function handleLevelChange(newLevel: string) {
    if (!isAdmin || savingLevel) return;
    setShowLevelMenu(false);
    setSavingLevel(true);
    try {
      const res = await apiFetch('/api/audit-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: newLevel }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else {
        setCurrentLevel(newLevel);
        setSuccess('审计级别已更新');
        setTimeout(() => setSuccess(''), 3000);
        setTimeout(() => fetchLogs(), 500);
      }
    } catch (err) { setError(String(err)); }
    finally { setSavingLevel(false); }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '10000' });
      if (category) params.set('category', category);
      if (searchUser) params.set('username', searchUser);
      const { startDate, endDate } = getTimeRangeISO(timeRange);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const res = await apiFetch(`/api/audit-logs?${params}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      const allLogs = (data.logs || []) as AuditLog[];
      if (allLogs.length === 0) { setError('没有可导出的数据'); return; }
      const headers = ['序号', '时间', '分类', '操作', '操作对象', '用户', 'IP 地址', '详情'];
      const rows = allLogs.map((l, i) => [
        i + 1, l.created_at,
        CATEGORY_LABELS[l.category] || l.category,
        ACTION_LABELS[l.action] || l.action,
        l.target, l.username, l.ip_address,
        l.detail ? l.detail.replace(/"/g, '""') : '',
      ]);
      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(`已导出 ${allLogs.length} 条记录`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(String(err)); }
    finally { setExporting(false); }
  }

  const hasFilters = category || searchUser || timeRange !== '1h';
  const currentLevelOpt = levelOptions.find(o => o.value === currentLevel);
  const CurrentLevelIcon = LEVEL_ICONS[currentLevel] || Shield;
  const currentLevelColor = LEVEL_COLORS[currentLevel] || '#6b7280';

  return (
    <>
      <PageHeader
        title="审计日志"
        breadcrumb={[{ label: '系统设置' }, { label: '审计日志' }]}
        description={<>系统操作审计记录 · 共 {total.toLocaleString()} 条</>}
      />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />

        {/* Toolbar */}
        <div className="table-toolbar">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
            <div className="table-search">
              <Search size={14} className="table-search-icon" />
              <input placeholder="搜索用户名..." value={searchUser} onChange={e => { setSearchUser(e.target.value); setPage(1); }} />
            </div>
            {/* Time Range Dropdown */}
            <FilterDropdown
              icon={<Clock size={13} />}
              label="时间"
              value={timeRange}
              options={TIME_RANGE_OPTIONS}
              onChange={(v) => { setTimeRange(v); setPage(1); }}
            />
            {/* Category Dropdown */}
            <FilterDropdown
              icon={<Tag size={13} />}
              label="分类"
              value={category}
              options={CATEGORY_OPTIONS}
              onChange={(v) => { setCategory(v); setPage(1); }}
            />
            {hasFilters && (
              <button className="btn btn-sm btn-secondary"
                onClick={() => { setCategory(''); setSearchUser(''); setTimeRange('1h'); setPage(1); }}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger-500)' }}>
                <X size={12} /> 重置
              </button>
            )}
          </div>
          <div className="toolbar-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Audit Level Dropdown */}
            <div style={{ position: 'relative' }}>
              <button className="btn btn-secondary"
                onClick={() => isAdmin && setShowLevelMenu(!showLevelMenu)}
                disabled={savingLevel}
                title={isAdmin ? '点击切换审计级别' : '仅管理员可修改审计级别'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  cursor: isAdmin ? 'pointer' : 'default',
                  borderColor: currentLevelColor + '40',
                }}
              >
                {savingLevel ? <span className="spinner" /> : <CurrentLevelIcon size={15} style={{ color: currentLevelColor }} />}
                <span style={{ fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-tertiary)', marginRight: '2px' }}>级别:</span>
                  <span style={{ fontWeight: 600, color: currentLevelColor }}>{currentLevelOpt?.label || currentLevel}</span>
                </span>
                {isAdmin && <ChevronDown size={12} style={{ color: 'var(--text-tertiary)', transform: showLevelMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
              </button>
              {showLevelMenu && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowLevelMenu(false)} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 1000,
                    background: 'var(--bg-primary)', border: '1px solid var(--border-secondary)',
                    borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                    minWidth: '220px', padding: '4px', animation: 'fadeIn 0.12s ease',
                  }}>
                    {levelOptions.map(opt => {
                      const isSelected = currentLevel === opt.value;
                      const color = LEVEL_COLORS[opt.value] || '#6b7280';
                      const Icon = LEVEL_ICONS[opt.value] || Shield;
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => handleLevelChange(opt.value)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                            padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                            border: 'none', cursor: 'pointer', textAlign: 'left',
                            backgroundColor: isSelected ? `${color}10` : 'transparent',
                            transition: 'background 0.12s',
                          }}
                          onMouseEnter={e => { if (!isSelected) (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'); }}
                          onMouseLeave={e => { if (!isSelected) (e.currentTarget.style.backgroundColor = 'transparent'); }}
                        >
                          <Icon size={15} style={{ color, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? color : 'var(--text-primary)' }}>
                              {opt.label}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '1px' }}>{opt.desc}</div>
                          </div>
                          {isSelected && <span style={{ fontSize: '0.75rem', color }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <button className="btn btn-secondary" onClick={handleExport} disabled={exporting || loading || total === 0} title="导出 CSV">
              {exporting ? <span className="spinner" /> : <Download size={16} />} 导出
            </button>
            <button className="btn btn-secondary" onClick={() => { fetchLogs(); fetchConfig(); }} disabled={loading}>
              <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> 刷新
            </button>
          </div>
        </div>

        {/* Table — # | 分类 | 操作 | 操作对象 | 用户 | 时间 | IP | 详情 */}
        <DataTable
          loading={loading}
          empty={logs.length === 0}
          emptyIcon={<ScrollText size={48} />}
          emptyText={currentLevel === 'off' ? '审计功能已关闭' : '暂无审计日志'}
          footerLeft={total > 0 ? <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>第 {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} 条 / 共 {total} 条</span> : undefined}
          pagination={{
            page, pageSize, totalPages, totalItems: total,
            onPageChange: setPage,
            onPageSizeChange: (s) => { setPageSize(s); setPage(1); },
          }}
        >
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>#</th>
              <th style={{ width: '70px' }}>分类</th>
              <th>操作</th>
              <th>操作对象</th>
              <th style={{ width: '90px' }}>用户</th>
              <th style={{ width: '150px' }}>时间</th>
              <th style={{ width: '110px' }}>IP 地址</th>
              <th style={{ width: '55px', textAlign: 'center' }}>详情</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, idx) => {
              const ActionIcon = ACTION_ICONS[log.action] || ScrollText;
              const catColor = CATEGORY_COLORS[log.category] || '#6b7280';
              const catLabel = CATEGORY_LABELS[log.category] || log.category;
              const rowNum = (page - 1) * pageSize + idx + 1;
              return (
                <tr key={log.id} style={detailId === log.id ? { backgroundColor: 'var(--bg-secondary)' } : undefined}>
                  <td style={{ textAlign: 'center', fontSize: '0.76rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {rowNum}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
                      fontSize: '0.72rem', fontWeight: 600,
                      color: catColor, backgroundColor: `${catColor}15`,
                    }}>
                      {catLabel}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <ActionIcon size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.target || '—'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{log.username}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {formatTime(log.created_at)}
                  </td>
                  <td style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {log.ip_address || '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      data-detail-btn
                      className="btn btn-sm btn-secondary"
                      onClick={() => setDetailId(detailId === log.id ? null : log.id)}
                      title="查看详情"
                      style={{ padding: '3px', backgroundColor: detailId === log.id ? 'var(--primary-500)' : undefined, color: detailId === log.id ? '#fff' : undefined }}
                    >
                      <Info size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>

        {/* Detail Panel — closes on click outside, Escape, or X button */}
        {detailId && (() => {
          const log = logs.find(l => l.id === detailId);
          if (!log) return null;
          return (
            <div ref={detailRef} style={{
              position: 'fixed', bottom: '20px', right: '20px',
              width: '420px', maxHeight: '400px', overflow: 'auto',
              background: 'var(--bg-primary)', border: '1px solid var(--border-secondary)',
              borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
              zIndex: 1000, padding: '16px', animation: 'fadeIn 0.15s ease',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={14} style={{ color: 'var(--primary-500)' }} /> 操作详情
                </span>
                <button className="btn btn-sm btn-secondary" onClick={() => setDetailId(null)} style={{ padding: '3px' }} title="关闭 (Esc)">
                  <X size={14} />
                </button>
              </div>
              {formatDetailRich(log)}
            </div>
          );
        })()}
      </div>
    </>
  );
}
