'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { useDataFetch } from '@/hooks/useDataFetch';
import { usePagination } from '@/hooks/usePagination';
import { str } from '@/lib/utils';
import { PageHeader, StatusBadge, DatabaseBadge, SearchToolbar, DataTable, ErrorBanner, SuccessToast } from '@/components/ui';
import { HardDrive, XCircle, Database } from 'lucide-react';

export default function BrokerLoadPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');

  const { data: loads, loading, refreshing, error, success, setError, setSuccess, refresh } = useDataFetch(
    { url: (sid, isRefresh) => `/api/broker-load?sessionId=${encodeURIComponent(sid)}${isRefresh ? '&refresh=true' : ''}`, extract: json => (json.loads || []) as Record<string, unknown>[] },
    [] as Record<string, unknown>[]
  );

  const allStates = Array.from(new Set(loads.map(l => str(l['State'])))).filter(Boolean).sort();

  const filtered = loads.filter(l => {
    const label = str(l['Label']).toLowerCase();
    const db = str(l['_db']).toLowerCase();
    const matchSearch = label.includes(search.toLowerCase()) || db.includes(search.toLowerCase());
    const matchState = stateFilter === 'all' || str(l['State']) === stateFilter;
    return matchSearch && matchState;
  });

  const pg = usePagination(filtered);

  // Reset page when filters change
  useEffect(() => { pg.resetPage(); }, [search, stateFilter]);

  async function handleCancel(db: string, label: string) {
    if (!session || !confirm(`确定要取消导入任务 ${label} 吗？`)) return;
    try {
      const res = await fetch('/api/broker-load', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'cancel', dbName: db, label }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess(`任务 ${label} 已取消`); refresh(true); }
    } catch (err) { setError(String(err)); }
  }

  return (
    <>
      <PageHeader title="Broker Load 管理" description={`管理批量导入任务 · ${loads.length} 条记录`} onRefresh={() => refresh(true)} refreshing={refreshing} loading={loading} />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />
        <SearchToolbar
          search={search} onSearch={setSearch} placeholder="搜索 Label 或数据库..."
          filters={{ value: stateFilter, onChange: setStateFilter, options: allStates.map(s => ({ value: s, label: s })) }}
        />
        <DataTable loading={loading} empty={filtered.length === 0} emptyIcon={<HardDrive size={48} />}
          emptyText={search || stateFilter !== 'all' ? '没有匹配的任务' : '暂无 Broker Load 任务'}
          footerLeft={<>共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 条</>}
          footerRight="SHOW LOAD"
          pagination={{ page: pg.page, pageSize: pg.pageSize, totalPages: pg.totalPages, totalItems: pg.totalItems, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize }}>
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>#</th>
              <th style={{ minWidth: '160px' }}>Label</th>
              <th style={{ minWidth: '90px' }}><Database size={12} /> 数据库</th>
              <th style={{ minWidth: '80px' }}>状态</th>
              <th style={{ minWidth: '80px' }}>类型</th>
              <th style={{ minWidth: '80px' }}>进度</th>
              <th style={{ minWidth: '120px' }}>创建时间</th>
              <th style={{ minWidth: '120px' }}>完成时间</th>
              <th style={{ minWidth: '100px' }}>URL / 详情</th>
              <th style={{ textAlign: 'center', width: '64px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pg.paginatedData.map((l, idx) => {
              const globalIdx = (pg.page - 1) * pg.pageSize + idx;
              const label = str(l['Label']);
              const db = str(l['_db']);
              const state = str(l['State']);
              const type = str(l['Type'] || l['EtlInfo'] || '');
              const progress = str(l['Progress'] || '');
              const createTime = str(l['CreateTime'] || '');
              const finishTime = str(l['LoadFinishTime'] || l['FinishTime'] || '');
              const url = str(l['URL'] || l['TrackingUrl'] || '');
              const canCancel = ['PENDING', 'ETL', 'LOADING'].includes(state);

              return (
                <tr key={`${db}.${label}.${globalIdx}`}>
                  <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{globalIdx + 1}</td>
                  <td>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(37,99,235,0.08)', color: 'var(--primary-600)', border: '1px solid rgba(37,99,235,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <HardDrive size={13} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</span>
                    </div>
                  </td>
                  <td><DatabaseBadge name={db} /></td>
                  <td><StatusBadge status={state} /></td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{type || '—'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{progress || '—'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{createTime}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{finishTime || '—'}</td>
                  <td style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={url}>{url || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    {canCancel && (
                      <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger-500)' }} onClick={() => handleCancel(db, label)} title="取消"><XCircle size={14} /></button>
                    )}
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
