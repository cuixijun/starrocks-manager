'use client';

import React, { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  loading?: boolean;
  actions?: ReactNode;
}

export function PageHeader({ title, description, onRefresh, refreshing, loading, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        <div className="flex gap-2">
          {onRefresh && (
            <button className="btn btn-secondary" onClick={onRefresh} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} />
              {refreshing ? '刷新中...' : '刷新'}
            </button>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
