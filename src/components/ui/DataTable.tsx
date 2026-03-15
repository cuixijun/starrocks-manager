'use client';

import React, { ReactNode } from 'react';
import { Clock } from 'lucide-react';

interface DataTableProps {
  loading: boolean;
  empty: boolean;
  emptyIcon: ReactNode;
  emptyText: string;
  footerLeft?: ReactNode;
  footerRight?: string;
  children: ReactNode;
}

export function DataTable({ loading, empty, emptyIcon, emptyText, footerLeft, footerRight, children }: DataTableProps) {
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
      {(footerLeft || footerRight) && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-secondary)', fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{footerLeft}</span>
          {footerRight && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {footerRight}</span>}
        </div>
      )}
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
