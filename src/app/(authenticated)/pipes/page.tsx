'use client';

import React, { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useDataFetch } from '@/hooks/useDataFetch';
import { str } from '@/lib/utils';
import { PageHeader, StatusBadge, DatabaseBadge, SearchToolbar, DataTable, ErrorBanner, SuccessToast } from '@/components/ui';
import { Pause, Play, Trash2, Database, GitBranch } from 'lucide-react';

export default function PipesPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');

  const { data: pipes, loading, refreshing, error, success, setError, setSuccess, refresh } = useDataFetch(
    { url: sid => `/api/pipes?sessionId=${encodeURIComponent(sid)}`, extract: json => (json.pipes || []) as Record<string, unknown>[] },
    [] as Record<string, unknown>[]
  );

  async function handleAction(action: string, db: string, name: string) {
    if (!session) return;
    if (action === 'drop' && !confirm(`确定要删除 Pipe ${name} 吗？`)) return;
    const labels: Record<string, string> = { suspend: '暂停', resume: '恢复', drop: '删除' };
    try {
      const res = await fetch('/api/pipes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action, dbName: db, pipeName: name }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess(`${labels[action] || action} ${name} 成功`); refresh(true); }
    } catch (err) { setError(String(err)); }
  }

  const filtered = pipes.filter(p => {
    const name = str(p['PIPE_NAME'] || p['Name'] || p['name'] || '').toLowerCase();
    const db = str(p['_db']).toLowerCase();
    return name.includes(search.toLowerCase()) || db.includes(search.toLowerCase());
  });

  return (
    <>
      <PageHeader title="Pipes 管理" description={`管理持续导入 Pipe · ${pipes.length} 个 Pipe`} onRefresh={() => refresh(true)} refreshing={refreshing} loading={loading} />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />
        <SearchToolbar search={search} onSearch={setSearch} placeholder="搜索 Pipe..." />
        <DataTable loading={loading} empty={filtered.length === 0} emptyIcon={<GitBranch size={48} />}
          emptyText={search ? '没有匹配的 Pipe' : '暂无 Pipe'}
          footerLeft={<>共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个 Pipe</>}
          footerRight="SHOW PIPES">
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>#</th>
              <th style={{ minWidth: '120px' }}>名称</th>
              <th style={{ minWidth: '90px' }}><Database size={12} /> 数据库</th>
              <th style={{ minWidth: '80px' }}>状态</th>
              <th style={{ minWidth: '100px' }}>目标表</th>
              <th style={{ minWidth: '80px' }}>已加载文件</th>
              <th style={{ minWidth: '80px' }}>已加载行</th>
              <th style={{ minWidth: '130px' }}>创建时间</th>
              <th style={{ textAlign: 'center', width: '100px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, idx) => {
              const name = str(p['PIPE_NAME'] || p['Name'] || p['name'] || '');
              const db = str(p['_db']);
              const state = str(p['STATE'] || p['State'] || p['state'] || '');
              const table = str(p['TABLE_NAME'] || p['TableName'] || '');
              const files = str(p['LOADED_FILES'] || p['LoadedFiles'] || '');
              const rows = str(p['LOADED_ROWS'] || p['LoadedRows'] || '');
              const created = str(p['CREATED_TIME'] || p['CreatedTime'] || p['CreateTime'] || '');

              return (
                <tr key={`${db}.${name}.${idx}`}>
                  <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{idx + 1}</td>
                  <td>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(139,92,246,0.08)', color: 'var(--accent-600)', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <GitBranch size={13} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{name}</span>
                    </div>
                  </td>
                  <td><DatabaseBadge name={db} /></td>
                  <td><StatusBadge status={state} /></td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{table || '—'}</td>
                  <td style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'right' }}>{files ? Number(files).toLocaleString() : '—'}</td>
                  <td style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'right' }}>{rows ? Number(rows).toLocaleString() : '—'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{created || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '2px', justifyContent: 'center' }}>
                      {state.toUpperCase() === 'RUNNING' && <button className="btn btn-ghost btn-icon" style={{ color: 'var(--warning-600)' }} onClick={() => handleAction('suspend', db, name)} title="暂停"><Pause size={14} /></button>}
                      {(state.toUpperCase() === 'SUSPEND' || state.toUpperCase() === 'SUSPENDED') && <button className="btn btn-ghost btn-icon" style={{ color: 'var(--success-600)' }} onClick={() => handleAction('resume', db, name)} title="恢复"><Play size={14} /></button>}
                      <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger-500)' }} onClick={() => handleAction('drop', db, name)} title="删除"><Trash2 size={14} /></button>
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
