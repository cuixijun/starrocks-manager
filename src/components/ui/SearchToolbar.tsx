'use client';

import React, { ReactNode } from 'react';
import { Search, Filter } from 'lucide-react';

interface FilterOption {
  value: string;
  label: string;
}

interface SearchToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  filters?: {
    value: string;
    onChange: (v: string) => void;
    options: FilterOption[];
    allLabel?: string;
  };
  extra?: ReactNode;
}

export function SearchToolbar({ search, onSearch, placeholder = '搜索...', filters, extra }: SearchToolbarProps) {
  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
      <div className="search-bar" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
        <Search /><input className="input" placeholder={placeholder} value={search} onChange={e => onSearch(e.target.value)} />
      </div>
      {filters && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Filter size={14} style={{ color: 'var(--text-tertiary)' }} />
          <select className="input" style={{ width: 'auto', minWidth: '120px', fontSize: '0.82rem' }} value={filters.value} onChange={e => filters.onChange(e.target.value)}>
            <option value="all">{filters.allLabel || '全部状态'}</option>
            {filters.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {extra}
    </div>
  );
}
