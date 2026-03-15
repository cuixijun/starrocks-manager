'use client';

import React, { ReactNode } from 'react';
import { Clock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface DataTableProps {
  loading: boolean;
  empty: boolean;
  emptyIcon: ReactNode;
  emptyText: string;
  footerLeft?: ReactNode;
  footerRight?: string;
  /** Pagination props — if provided, pagination controls are shown */
  pagination?: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
    onPageChange: (p: number) => void;
    onPageSizeChange: (s: number) => void;
  };
  children: ReactNode;
}

export function DataTable({ loading, empty, emptyIcon, emptyText, footerLeft, footerRight, pagination, children }: DataTableProps) {
  if (loading) {
    return <div className="loading-overlay"><div className="spinner" /> 加载中...</div>;
  }
  if (empty) {
    return <div className="empty-state">{emptyIcon}<div className="empty-state-text">{emptyText}</div></div>;
  }
  return (
    <div className="table-container fade-in" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', tableLayout: 'auto' }}>
        {children}
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-secondary)', fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {footerLeft && <span>{footerLeft}</span>}
          {footerRight && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {footerRight}</span>}
        </div>
        {pagination && <Pagination {...pagination} />}
      </div>
    </div>
  );
}

/* ─── Pagination Controls ─── */

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}

export function Pagination({ page, pageSize, totalPages, totalItems, onPageChange, onPageSizeChange }: PaginationProps) {
  // Generate page numbers to show
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  const btnBase: React.CSSProperties = {
    padding: '4px 8px', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)', borderRadius: 'var(--radius-sm)',
    fontSize: '0.76rem', cursor: 'pointer', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '28px', height: '28px',
    transition: 'all 0.15s ease',
  };
  const activeBtnStyle: React.CSSProperties = {
    ...btnBase, backgroundColor: 'var(--primary-500)', color: '#fff', borderColor: 'var(--primary-500)', fontWeight: 700,
  };
  const disabledStyle: React.CSSProperties = { ...btnBase, opacity: 0.4, cursor: 'not-allowed' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      {/* Page size selector */}
      <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>每页</span>
      <select
        value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
        style={{ padding: '3px 6px', fontSize: '0.76rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', cursor: 'pointer' }}
      >
        {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s} 条</option>)}
      </select>

      <span style={{ margin: '0 4px', color: 'var(--border-secondary)' }}>|</span>

      {/* Navigation */}
      <button style={page <= 1 ? disabledStyle : btnBase} disabled={page <= 1} onClick={() => onPageChange(1)} title="首页"><ChevronsLeft size={14} /></button>
      <button style={page <= 1 ? disabledStyle : btnBase} disabled={page <= 1} onClick={() => onPageChange(page - 1)} title="上一页"><ChevronLeft size={14} /></button>

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`e${i}`} style={{ padding: '0 4px', color: 'var(--text-tertiary)' }}>…</span>
        ) : (
          <button key={p} style={p === page ? activeBtnStyle : btnBase} onClick={() => onPageChange(p as number)}>
            {p}
          </button>
        )
      )}

      <button style={page >= totalPages ? disabledStyle : btnBase} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} title="下一页"><ChevronRight size={14} /></button>
      <button style={page >= totalPages ? disabledStyle : btnBase} disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} title="末页"><ChevronsRight size={14} /></button>

      <span style={{ marginLeft: '4px', fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
        共 <strong style={{ color: 'var(--text-secondary)' }}>{totalItems.toLocaleString()}</strong> 条
      </span>
    </div>
  );
}

/** Error alert banner */
export function ErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
      {error}
    </div>
  );
}

/** Success toast */
export function SuccessToast({ message }: { message: string }) {
  if (!message) return null;
  return <div className="toast toast-success">{message}</div>;
}
