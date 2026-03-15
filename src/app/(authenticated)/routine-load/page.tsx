'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { useDataFetch } from '@/hooks/useDataFetch';
import { usePagination } from '@/hooks/usePagination';
import { str } from '@/lib/utils';
import { PageHeader, StatusBadge, DatabaseBadge, SearchToolbar, DataTable, ErrorBanner, SuccessToast } from '@/components/ui';
import { Pause, Play, Square, Database, Radio, AlertTriangle } from 'lucide-react';

const RL_ICONS: Record<string, string> = { RUNNING: '▶', PAUSED: '⏸', STOPPED: '⏹', CANCELLED: '✗', NEED_SCHEDULE: '⏳', UNSTABLE: '⚠' };

export default function RoutineLoadPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');

  const { data: jobs, loading, refreshing, error, success, setError, setSuccess, refresh } = useDataFetch(
    { url: (sid, isRefresh) => `/api/routine-load?sessionId=${encodeURIComponent(sid)}${isRefresh ? '&refresh=true' : ''}`, extract: json => (json.jobs || []) as Record<string, unknown>[] },
    [] as Record<string, unknown>[]
  );

  const allStates = Array.from(new Set(jobs.map(j => str(j['State'])))).filter(Boolean).sort();

  const filtered = jobs.filter(j => {
    const name = str(j['Name']).toLowerCase();
    const db = str(j['_db']).toLowerCase();
    const matchSearch = name.includes(search.toLowerCase()) || db.includes(search.toLowerCase());
    const matchState = stateFilter === 'all' || str(j['State']) === stateFilter;
    return matchSearch && matchState;
  });

  const pg = usePagination(filtered);
  useEffect(() => { pg.resetPage(); }, [search, stateFilter]);

  async function handleAction(action: string, db: string, name: string) {
    if (!session) return;
    const labels: Record<string, string> = { pause: '暂停', resume: '恢复', stop: '停止' };
    if (action === 'stop' && !confirm(`确定要停止 Routine Load 任务 ${name} 吗？停止后不可恢复！`)) return;
    try {
      const res = await fetch('/api/routine-load', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action, dbName: db, jobName: name }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess(`${labels[action] || action} ${name} 成功`); refresh(true); }
    } catch (err) { setError(String(err)); }
  }

  return (
    <>
      <PageHeader title="Routine Load 管理" description={`管理 Kafka 持续导入任务 · ${jobs.length} 个任务`} onRefresh={() => refresh(true)} refreshing={refreshing} loading={loading} />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />
        <SearchToolbar search={search} onSearch={setSearch} placeholder="搜索任务..."
          filters={{ value: stateFilter, onChange: setStateFilter, options: allStates.map(s => ({ value: s, label: s })) }}
        />
        <DataTable loading={loading} empty={filtered.length === 0} emptyIcon={<Radio size={48} />}
          emptyText={search || stateFilter !== 'all' ? '没有匹配的任务' : '暂无 Routine Load 任务'}
          footerLeft={<>共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个任务</>}
          footerRight="SHOW ALL ROUTINE LOAD"
          pagination={{ page: pg.page, pageSize: pg.pageSize, totalPages: pg.totalPages, totalItems: pg.totalItems, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize }}>
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>#</th>
              <th style={{ minWidth: '140px' }}>任务名</th>
              <th style={{ minWidth: '90px' }}><Database size={12} /> 数据库</th>
              <th style={{ minWidth: '100px' }}>目标表</th>
              <th style={{ minWidth: '80px' }}>状态</th>
              <th style={{ minWidth: '80px' }}>数据源</th>
              <th style={{ minWidth: '120px' }}>创建时间</th>
              <th style={{ minWidth: '60px' }}>统计</th>
              <th style={{ minWidth: '100px' }}>错误信息</th>
              <th style={{ textAlign: 'center', width: '100px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pg.paginatedData.map((j, idx) => {
              const globalIdx = (pg.page - 1) * pg.pageSize + idx;
              const name = str(j['Name']);
              const db = str(j['_db']);
              const table = str(j['TableName']);
              const state = str(j['State']);
              const dataSource = str(j['DataSourceType']);
              const createTime = str(j['CreateTime']);
              const errorMsg = str(j['ReasonOfStateChanged'] || j['OtherMsg'] || '');
              const loadedRows = str(j['LoadedRows'] || j['Statistics'] || '');

              return (
                <tr key={`${db}.${name}.${globalIdx}`}>
                  <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{globalIdx + 1}</td>
                  <td>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(22,163,74,0.08)', color: 'var(--success-600)', border: '1px solid rgba(22,163,74,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Radio size={13} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{name}</span>
                    </div>
                  </td>
                  <td><DatabaseBadge name={db} /></td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{table}</td>
                  <td><StatusBadge status={state} icon={RL_ICONS[state]} /></td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{dataSource || '—'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{createTime || '—'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{loadedRows ? loadedRows.substring(0, 40) : '—'}</td>
                  <td>
                    {errorMsg ? (
                      <div style={{ fontSize: '0.72rem', color: 'var(--danger-500)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={errorMsg}>
                        <AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: '3px' }} />{errorMsg}
                      </div>
                    ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '2px', justifyContent: 'center' }}>
                      {state === 'RUNNING' && <button className="btn btn-ghost btn-icon" style={{ color: 'var(--warning-600)' }} onClick={() => handleAction('pause', db, name)} title="暂停"><Pause size={14} /></button>}
                      {state === 'PAUSED' && <button className="btn btn-ghost btn-icon" style={{ color: 'var(--success-600)' }} onClick={() => handleAction('resume', db, name)} title="恢复"><Play size={14} /></button>}
                      {(state === 'RUNNING' || state === 'PAUSED') && <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger-500)' }} onClick={() => handleAction('stop', db, name)} title="停止"><Square size={14} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
