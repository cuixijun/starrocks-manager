'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePagination } from '@/hooks/usePagination';
import { Pagination } from '@/components/ui';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Search, Table2, RefreshCw } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';

interface TableInfo {
  TABLE_NAME: string;
  TABLE_TYPE: string;
  ENGINE: string;
  TABLE_ROWS: number | null;
  DATA_LENGTH: number | null;
  INDEX_LENGTH: number | null;
  CREATE_TIME: string;
  UPDATE_TIME: string;
  TABLE_COMMENT: string;
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString();
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s; // fallback to raw string
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function DatabaseDetailPage() {
  const { session } = useSession();
  const params = useParams();
  const db = decodeURIComponent(params.db as string);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    fetchTables();
  }, [session, db]);

  async function fetchTables() {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(db)}?sessionId=${encodeURIComponent(session.sessionId)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setTables(data.tables || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const filtered = tables.filter(t =>
    t.TABLE_NAME.toLowerCase().includes(search.toLowerCase())
  );

  const pg = usePagination(filtered);

  return (
    <>
      <div className="page-header">
        <Breadcrumb items={[
          { label: '数据库浏览', href: '/databases' },
          { label: db },
        ]} />
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{db}</h1>
            <p className="page-description">{tables.length} 张表</p>
          </div>
          <button className="btn btn-secondary" onClick={fetchTables}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <div className="search-bar mb-4">
          <Search />
          <input className="input" placeholder="搜索表名..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Table2 size={48} />
            <div className="empty-state-text">{search ? '没有匹配的表' : '该数据库没有表'}</div>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '48px', textAlign: 'center' }}>#</th>
                  <th>表名</th>
                  <th>类型</th>
                  <th>引擎</th>
                  <th style={{ textAlign: 'right' }}>行数</th>
                  <th style={{ textAlign: 'right' }}>数据大小</th>
                  <th>创建时间</th>
                  <th>更新时间</th>
                  <th>注释</th>
                </tr>
              </thead>
              <tbody>
                {pg.paginatedData.map((t, idx) => {
                  const globalIdx = (pg.page - 1) * pg.pageSize + idx;
                  return (
                    <tr key={t.TABLE_NAME}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                        {globalIdx + 1}
                      </td>
                      <td>
                        <Link
                          href={`/databases/${encodeURIComponent(db)}/${encodeURIComponent(t.TABLE_NAME)}`}
                          style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Table2 size={14} />
                          {t.TABLE_NAME}
                        </Link>
                      </td>
                      <td>
                        <span className={`badge ${t.TABLE_TYPE === 'BASE TABLE' ? 'badge-info' : 'badge-neutral'}`}>
                          {t.TABLE_TYPE === 'BASE TABLE' ? '表' : t.TABLE_TYPE}
                        </span>
                      </td>
                      <td className="text-xs">{t.ENGINE || '-'}</td>
                      <td className="text-right" style={{ textAlign: 'right' }}>
                        {formatNumber(t.TABLE_ROWS)}
                      </td>
                      <td className="text-right" style={{ textAlign: 'right' }}>{formatBytes(t.DATA_LENGTH)}</td>
                      <td className="text-xs" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(t.CREATE_TIME)}</td>
                      <td className="text-xs" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(t.UPDATE_TIME)}</td>
                      <td className="text-xs text-secondary truncate" style={{ maxWidth: '200px' }}>{t.TABLE_COMMENT || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer with count + pagination */}
            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--border-secondary)',
              fontSize: '0.78rem', color: 'var(--text-tertiary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            }}>
              <span>
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 张表
                {search && ` (过滤自 ${tables.length} 张)`}
              </span>
              <Pagination page={pg.page} pageSize={pg.pageSize} totalPages={pg.totalPages} totalItems={pg.totalItems} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
