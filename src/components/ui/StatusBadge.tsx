'use client';

import React from 'react';
import { getStatusStyle } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  icon?: string;
  customStyles?: Record<string, { bg: string; border: string; color: string }>;
}

export function StatusBadge({ status, icon, customStyles }: StatusBadgeProps) {
  const ss = getStatusStyle(status, customStyles);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
      backgroundColor: ss.bg, color: ss.color, border: `1px solid ${ss.border}`,
    }}>
      {icon && <span>{icon}</span>}
      {status}
    </span>
  );
}

/** Simple database name badge */
export function DatabaseBadge({ name }: { name: string }) {
  if (!name || name === '—') return <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>—</span>;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '999px', fontSize: '0.73rem', fontWeight: 600,
      backgroundColor: 'rgba(37,99,235,0.06)', color: 'var(--primary-600)',
      border: '1px solid rgba(37,99,235,0.15)',
    }}>
      {name}
    </span>
  );
}

/** Version badge */
export function VersionBadge({ version }: { version: string }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
      backgroundColor: 'rgba(139,92,246,0.08)', color: 'var(--accent-600)',
      border: '1px solid rgba(139,92,246,0.2)',
    }}>
      {version}
    </span>
  );
}
