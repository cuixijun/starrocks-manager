'use client';

import React, { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useDataFetch } from '@/hooks/useDataFetch';
import { str } from '@/lib/utils';
import { PageHeader, StatusBadge, DatabaseBadge, SearchToolbar, DataTable, ErrorBanner, SuccessToast } from '@/components/ui';
import { Trash2, ListChecks, ChevronDown, ChevronRight } from 'lucide-react';

export default function TasksPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'tasks' | 'runs'>('tasks');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const { data, loading, refreshing, error, success, setError, setSuccess, refresh } = useDataFetch(
    {
      url: sid => `/api/tasks?sessionId=${encodeURIComponent(sid)}&type=all`,
      extract: json => ({
        tasks: (json.tasks || []) as Record<string, unknown>[],
        runs: (json.runs || []) as Record<string, unknown>[],
      }),
    },
    { tasks: [] as Record<string, unknown>[], runs: [] as Record<string, unknown>[] }
  );
  const { tasks, runs } = data;

  async function handleDrop(name: string) {
    if (!session || !confirm(`确定要删除任务 ${name} 吗？`)) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'drop', taskName: name }),
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      else { setSuccess(`任务 ${name} 已删除`); refresh(true); }
    } catch (err) { setError(String(err)); }
  }

  function getRunsForTask(taskName: string) {
    return runs.filter(r => str(r['TASK_NAME']).includes(taskName) || str(r['TaskName']).includes(taskName));
  }

  const filteredTasks = tasks.filter(t => {
    const name = str(t['TASK_NAME'] || t['TaskName'] || '').toLowerCase();
    const db = str(t['DATABASE'] || t['DbName'] || '').toLowerCase();
    return name.includes(search.toLowerCase()) || db.includes(search.toLowerCase());
  });

  const filteredRuns = runs.filter(r => {
    const name = str(r['TASK_NAME'] || r['TaskName'] || '').toLowerCase();
    const state = str(r['STATE'] || r['State'] || '').toLowerCase();
    return name.includes(search.toLowerCase()) || state.includes(search.toLowerCase());
  });

  return (
    <>
      <PageHeader title="任务管理" description={`管理定时任务 · ${tasks.length} 个任务 · ${runs.length} 条运行记录`}
        onRefresh={() => refresh(true)} refreshing={refreshing} loading={loading} />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '16px', borderBottom: '2px solid var(--border-primary)' }}>
          {(['tasks', 'runs'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600,
              border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--primary-500)' : 'transparent'}`,
              background: 'none', cursor: 'pointer', marginBottom: '-2px',
              color: tab === t ? 'var(--primary-600)' : 'var(--text-tertiary)',
            }}>
              {t === 'tasks' ? `任务列表 (${tasks.length})` : `运行记录 (${runs.length})`}
            </button>
          ))}
        </div>

        <SearchToolbar search={search} onSearch={setSearch} placeholder="搜索任务..." />

        {tab === 'tasks' ? (
          <DataTable loading={loading} empty={filteredTasks.length === 0} emptyIcon={<ListChecks size={48} />}
            emptyText={search ? '没有匹配的任务' : '暂无定时任务'}
            footerLeft={<>共 <strong style={{ color: 'var(--text-secondary)' }}>{filteredTasks.length}</strong> 个任务</>}
            footerRight="information_schema.tasks">
            <thead>
              <tr>
                <th style={{ width: '44px', textAlign: 'center' }}>#</th>
                <th style={{ width: '30px' }}></th>
                <th style={{ minWidth: '150px' }}>任务名</th>
                <th style={{ minWidth: '90px' }}>数据库</th>
                <th style={{ minWidth: '80px' }}>调度</th>
                <th style={{ minWidth: '80px' }}>状态</th>
                <th style={{ minWidth: '130px' }}>创建时间</th>
                <th style={{ minWidth: '200px' }}>定义</th>
                <th style={{ textAlign: 'center', width: '64px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t, idx) => {
                const name = str(t['TASK_NAME'] || t['TaskName'] || '');
                const db = str(t['DATABASE'] || t['DbName'] || '');
                const schedule = str(t['SCHEDULE'] || t['Schedule'] || '');
                const state = str(t['STATE'] || t['State'] || '');
                const created = str(t['CREATE_TIME'] || t['CreateTime'] || '');
                const definition = str(t['DEFINITION'] || t['Definition'] || '');
                const isExpanded = expandedTask === name;
                const taskRuns = getRunsForTask(name);

                return (
                  <React.Fragment key={`${name}.${idx}`}>
                    <tr>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{idx + 1}</td>
                      <td>
                        {taskRuns.length > 0 && (
                          <button onClick={() => setExpandedTask(isExpanded ? null : name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px' }}>
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(234,179,8,0.08)', color: 'var(--warning-600)', border: '1px solid rgba(234,179,8,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <ListChecks size={13} />
                          </div>
                          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)' }}>{name}</span>
                        </div>
                      </td>
                      <td><DatabaseBadge name={db} /></td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{schedule || 'MANUAL'}</td>
                      <td><StatusBadge status={state || '—'} /></td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{created || '—'}</td>
                      <td>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace", maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={definition}>
                          {definition || '—'}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger-500)' }} onClick={() => handleDrop(name)} title="删除"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                    {isExpanded && taskRuns.map((r, ri) => {
                      const runState = str(r['STATE'] || r['State'] || '');
                      return (
                        <tr key={ri} style={{ backgroundColor: 'var(--bg-secondary)' }}>
                          <td></td><td></td>
                          <td colSpan={2} style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', paddingLeft: '36px' }}>运行 #{ri + 1}</td>
                          <td></td>
                          <td><StatusBadge status={runState} /></td>
                          <td style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{str(r['CREATE_TIME'] || r['CreateTime'] || '')}</td>
                          <td style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>耗时: {str(r['DURATION'] || r['Duration'] || '—')}</td>
                          <td></td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </DataTable>
        ) : (
          <DataTable loading={loading} empty={filteredRuns.length === 0} emptyIcon={<ListChecks size={48} />}
            emptyText={search ? '没有匹配的记录' : '暂无运行记录'}
            footerLeft={<>共 <strong style={{ color: 'var(--text-secondary)' }}>{filteredRuns.length}</strong> 条记录</>}
            footerRight="information_schema.task_runs">
            <thead>
              <tr>
                <th style={{ width: '44px', textAlign: 'center' }}>#</th>
                <th style={{ minWidth: '130px' }}>任务名</th>
                <th style={{ minWidth: '80px' }}>状态</th>
                <th style={{ minWidth: '120px' }}>开始时间</th>
                <th style={{ minWidth: '120px' }}>完成时间</th>
                <th style={{ minWidth: '80px' }}>耗时</th>
                <th style={{ minWidth: '100px' }}>数据库</th>
                <th style={{ minWidth: '150px' }}>错误信息</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((r, idx) => {
                const name = str(r['TASK_NAME'] || r['TaskName'] || '');
                const state = str(r['STATE'] || r['State'] || '');
                const start = str(r['CREATE_TIME'] || r['CreateTime'] || '');
                const end = str(r['FINISH_TIME'] || r['FinishTime'] || '');
                const duration = str(r['DURATION'] || r['Duration'] || '');
                const db = str(r['DATABASE'] || r['DbName'] || '');
                const errorMsg = str(r['ERROR_MESSAGE'] || r['ErrorMessage'] || '');

                return (
                  <tr key={idx}>
                    <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{idx + 1}</td>
                    <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>{name}</td>
                    <td><StatusBadge status={state} /></td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{start}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{end || '—'}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{duration || '—'}</td>
                    <td><DatabaseBadge name={db} /></td>
                    <td>
                      {errorMsg ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--danger-500)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={errorMsg}>{errorMsg}</div>
                      ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </div>
    </>
  );
}
