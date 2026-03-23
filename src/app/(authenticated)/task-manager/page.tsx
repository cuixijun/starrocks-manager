'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import { useDataFetch } from '@/hooks/useDataFetch';
import { usePagination } from '@/hooks/usePagination';
import { str } from '@/lib/utils';
import { PageHeader, StatusBadge, DatabaseBadge, SearchToolbar, DataTable, ErrorBanner, SuccessToast, CacheTimeBadge, CommandLogButton } from '@/components/ui';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import SqlHighlighter from '@/components/SqlHighlighter';
import { Trash2, CalendarClock, ChevronDown, ChevronRight, Loader2, Eye, Copy, Check, AlignLeft, RefreshCw } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';

const noWrap: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/**
 * Parse SCHEDULE string like "PERIODICAL START(2024-10-15T00:00:01) EVERY(1 DAYS)"
 * and compute the next execution time from now.
 */
function calcNextSchedule(schedule: string): string {
  if (!schedule) return 'MANUAL';
  const startMatch = schedule.match(/START\(([^)]+)\)/);
  const everyMatch = schedule.match(/EVERY\((\d+)\s+(MINUTES?|HOURS?|DAYS?)\)/i);
  if (!startMatch || !everyMatch) return schedule;

  const start = new Date(startMatch[1]);
  const interval = parseInt(everyMatch[1], 10);
  const unit = everyMatch[2].toUpperCase().replace(/S$/, '');

  let intervalMs = 0;
  if (unit === 'MINUTE') intervalMs = interval * 60 * 1000;
  else if (unit === 'HOUR') intervalMs = interval * 3600 * 1000;
  else if (unit === 'DAY') intervalMs = interval * 86400 * 1000;
  else return schedule;

  if (intervalMs <= 0) return schedule;

  const now = Date.now();
  const startMs = start.getTime();

  if (startMs > now) {
    return formatDateTime(start);
  }

  // Calculate next occurrence after now
  const elapsed = now - startMs;
  const periods = Math.ceil(elapsed / intervalMs);
  const nextMs = startMs + periods * intervalMs;
  return formatDateTime(new Date(nextMs));
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a time string (ISO or other) to yyyy-MM-dd HH:mm:ss */
function formatTimeStr(s: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return formatDateTime(d);
}

/** Extract human-readable interval from SCHEDULE expression */
function extractInterval(schedule: string): string {
  if (!schedule) return '—';
  const m = schedule.match(/EVERY\((\d+)\s+(MINUTES?|HOURS?|DAYS?)\)/i);
  if (!m) return '—';
  const n = parseInt(m[1], 10);
  const unit = m[2].toUpperCase().replace(/S$/, '');
  if (unit === 'MINUTE') return n === 1 ? '每分钟' : `每 ${n} 分钟`;
  if (unit === 'HOUR') return n === 1 ? '每小时' : `每 ${n} 小时`;
  if (unit === 'DAY') return n === 1 ? '每天' : `每 ${n} 天`;
  return m[0];
}

export default function TaskManagerPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [dbFilter, setDbFilter] = useState('all');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [taskRuns, setTaskRuns] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadingRuns, setLoadingRuns] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sqlModal, setSqlModal] = useState<{ name: string; sql: string } | null>(null);
  const [sqlFormatted, setSqlFormatted] = useState(true);
  const [sqlCopied, setSqlCopied] = useState(false);

  const { data: tasks, loading, refreshing, error, success, cachedAt, fromCache, setError, setSuccess, refresh } = useDataFetch(
    {
      url: (sid, isRefresh) => `/api/tasks?sessionId=${encodeURIComponent(sid)}${isRefresh ? '&refresh=true' : ''}`,
      extract: json => (json.tasks || []) as Record<string, unknown>[],
    },
    [] as Record<string, unknown>[]
  );

  const allDbs = Array.from(new Set(tasks.map(t => str(t['DATABASE'] || '')))).filter(Boolean).sort();

  const filtered = tasks.filter(t => {
    const name = str(t['TASK_NAME'] || '').toLowerCase();
    const db = str(t['DATABASE'] || '');
    const matchSearch = name.includes(search.toLowerCase()) || db.toLowerCase().includes(search.toLowerCase());
    const matchDb = dbFilter === 'all' || db === dbFilter;
    return matchSearch && matchDb;
  });

  const pg = usePagination(filtered);
  useEffect(() => { pg.resetPage(); }, [search, dbFilter]);

  const handleExpand = useCallback(async (taskName: string) => {
    if (expandedTask === taskName) {
      setExpandedTask(null);
      return;
    }
    setExpandedTask(taskName);
    if (taskRuns[taskName]) return;
    if (!session) return;
    setLoadingRuns(taskName);
    try {
      const res = await fetch(`/api/tasks?sessionId=${encodeURIComponent(session.sessionId)}&type=task_runs&taskName=${encodeURIComponent(taskName)}`);
      const data = await res.json();
      setTaskRuns(prev => ({ ...prev, [taskName]: data.runs || [] }));
    } catch {
      setTaskRuns(prev => ({ ...prev, [taskName]: [] }));
    }
    setLoadingRuns(null);
  }, [expandedTask, taskRuns, session]);

  async function handleDrop(name: string) {
    if (!session) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'drop', taskName: name }),
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      else { setSuccess(`Task ${name} 已删除`); refresh(true); }
    } catch (err) { setError(String(err)); }
    setDeleteConfirm(null);
  }

  function handleCopySql() {
    if (sqlModal?.sql) {
      navigator.clipboard.writeText(sqlModal.sql);
      setSqlCopied(true);
      setTimeout(() => setSqlCopied(false), 2000);
    }
  }

  return (
    <>
      <PageHeader title="Submit Task" breadcrumb={[{ label: '任务管理' }, { label: 'Submit Task' }]} description={<>管理 StarRocks Task · {tasks.length} 个 Task<CacheTimeBadge cachedAt={cachedAt} fromCache={fromCache} /></>}
      />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />
        <div className="table-toolbar">
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
            <div className="search-bar" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
              <input className="input" placeholder="搜索 Task..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div style={{ width: '180px' }}>
              <SearchableSelect
                value={dbFilter}
                onChange={setDbFilter}
                placeholder="全部数据库"
                options={[{ label: '全部数据库', value: 'all' }, ...allDbs.map(d => ({ label: d, value: d }))]}
              />
            </div>
          </div>
          <div className="toolbar-actions">
            <CommandLogButton source="tasks" title="Submit Task" />
            <button className="btn btn-secondary" onClick={() => { refresh(true); setTaskRuns({}); }} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} />
              {refreshing ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>
        <DataTable loading={loading} empty={filtered.length === 0} emptyIcon={<CalendarClock size={48} />}
          emptyText={search || dbFilter !== 'all' ? '没有匹配的 Task' : '暂无 Task'}
          footerLeft={<>共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个 Task</>}
          footerRight="SELECT * FROM information_schema.tasks WHERE TASK_NAME NOT LIKE 'optimize-%'"
          pagination={{ page: pg.page, pageSize: pg.pageSize, totalPages: pg.totalPages, totalItems: pg.totalItems, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize }}>
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>#</th>
              <th style={{ width: '30px' }}></th>
              <th style={{ minWidth: '180px' }}>Task 名称</th>
              <th style={{ minWidth: '90px' }}>数据库</th>
              <th style={{ minWidth: '80px' }}>周期</th>
              <th style={{ minWidth: '130px' }}>下次调度</th>
              <th style={{ minWidth: '130px' }}>创建时间</th>
              <th style={{ textAlign: 'center', width: '90px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pg.paginatedData.map((t, idx) => {
              const globalIdx = (pg.page - 1) * pg.pageSize + idx;
              const name = str(t['TASK_NAME'] || '');
              const db = str(t['DATABASE'] || '');
              const schedule = str(t['SCHEDULE'] || '');
              const created = formatTimeStr(str(t['CREATE_TIME'] || ''));
              const definition = str(t['DEFINITION'] || '');
              const isExpanded = expandedTask === name;
              const runs = taskRuns[name];
              const isLoadingThis = loadingRuns === name;
              const nextSchedule = calcNextSchedule(schedule);

              return (
                <React.Fragment key={`${name}.${globalIdx}`}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => handleExpand(name)}>
                    <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem', ...noWrap }}>{globalIdx + 1}</td>
                    <td style={noWrap}>
                      {isLoadingThis
                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary-500)' }} />
                        : isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
                      }
                    </td>
                    <td title={name}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', maxWidth: '100%' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(37,99,235,0.08)', color: 'var(--primary-600)', border: '1px solid rgba(37,99,235,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <CalendarClock size={13} />
                        </div>
                        <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      </div>
                    </td>
                    <td style={noWrap}><DatabaseBadge name={db} /></td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', ...noWrap }}>{extractInterval(schedule)}</td>
                    <td style={{ fontSize: '0.78rem', color: nextSchedule === 'MANUAL' ? 'var(--text-tertiary)' : 'var(--text-secondary)', ...noWrap }} title={schedule}>{nextSchedule}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', ...noWrap }}>{created}</td>
                    <td style={{ textAlign: 'center', ...noWrap }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                        <button className="btn-action btn-action-view" onClick={() => { setSqlModal({ name, sql: definition }); setSqlFormatted(true); setSqlCopied(false); }} title="查看定义"><Eye size={14} /></button>
                        <button className="btn-action btn-action-danger" onClick={() => setDeleteConfirm(name)} title="删除"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={8} style={{ padding: '0', borderLeft: '3px solid var(--primary-400)' }}>
                        <div style={{ padding: '10px 20px', backgroundColor: 'rgba(37,99,235,0.03)' }}>
                          {isLoadingThis ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> 加载中...
                            </div>
                          ) : runs && runs.length > 0 ? (
                            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', width: '30px', ...noWrap }}>#</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>状态</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>QUERY_ID</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>开始时间</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>完成时间</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>耗时</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>数据库</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>进度</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>过期时间</th>
                                  <th style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'left', ...noWrap }}>错误信息</th>
                                </tr>
                              </thead>
                              <tbody>
                                {runs.slice(0, 5).map((r, ri) => {
                                  const runState = str(r['STATE'] || '');
                                  const runError = str(r['ERROR_MESSAGE'] || '');
                                  const queryId = str(r['QUERY_ID'] || '');
                                  const runDb = str(r['DATABASE'] || '');
                                  const progress = str(r['PROGRESS'] || '');
                                  const expireTime = formatTimeStr(str(r['EXPIRE_TIME'] || ''));
                                  const extraMsg = str(r['EXTRA_MESSAGE'] || '');
                                  // Duration: try multiple field names, fallback to compute from timestamps
                                  let durationStr = str(r['DURATION'] || r['Duration'] || '');
                                  if (!durationStr) {
                                    const s = r['CREATE_TIME'] || r['CreateTime'];
                                    const e = r['FINISH_TIME'] || r['FinishTime'];
                                    if (s && e) {
                                      const ms = new Date(String(e)).getTime() - new Date(String(s)).getTime();
                                      if (ms >= 0) durationStr = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
                                    }
                                  }
                                  return (
                                    <tr key={ri} style={{ borderBottom: ri < Math.min(runs.length, 5) - 1 ? '1px solid var(--border-primary)' : 'none' }}>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-tertiary)', ...noWrap }}>{ri + 1}</td>
                                      <td style={{ padding: '5px 8px', ...noWrap }}><StatusBadge status={runState} /></td>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', fontSize: '0.7rem', fontFamily: 'monospace', ...noWrap }} title={queryId}>{queryId ? queryId.substring(0, 16) + '...' : '—'}</td>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', ...noWrap }}>{formatTimeStr(str(r['CREATE_TIME'] || ''))}</td>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', ...noWrap }}>{formatTimeStr(str(r['FINISH_TIME'] || ''))}</td>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', ...noWrap }}>{durationStr || '—'}</td>
                                      <td style={{ padding: '5px 8px', ...noWrap }}>{runDb ? <DatabaseBadge name={runDb} /> : '—'}</td>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', ...noWrap }}>{progress || '—'}</td>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', ...noWrap }}>{expireTime || '—'}</td>
                                      <td style={{ padding: '5px 8px', color: runError ? 'var(--danger-500)' : 'var(--text-tertiary)', maxWidth: '400px', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.4' }} title={runError || extraMsg}>{runError || extraMsg || '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <div style={{ padding: '8px 0', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>暂无运行记录</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </DataTable>
      </div>
      <ConfirmModal
        open={!!deleteConfirm}
        title="删除 Task"
        message={`确定要删除 Task ${deleteConfirm} 吗？此操作不可撤销。`}
        confirmText="删除"
        onConfirm={() => deleteConfirm && handleDrop(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
      <Modal
        open={!!sqlModal}
        onClose={() => setSqlModal(null)}
        title={`Task 定义: ${sqlModal?.name || ''}`}
        maxWidth="800px"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost btn-sm" onClick={handleCopySql} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {sqlCopied ? <Check size={14} /> : <Copy size={14} />}
                {sqlCopied ? '已复制' : '复制'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSqlFormatted(f => !f)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <AlignLeft size={14} />
                {sqlFormatted ? '原始 SQL' : '美化 SQL'}
              </button>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setSqlModal(null)}>关闭</button>
          </div>
        }
      >
        {sqlModal && <SqlHighlighter sql={sqlModal.sql} maxHeight="450px" showToolbar={false} externalFormatted={sqlFormatted} />}
      </Modal>
    </>
  );
}
