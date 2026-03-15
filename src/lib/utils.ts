/**
 * Safely convert any value to string
 */
export function str(v: unknown): string {
  return String(v ?? '');
}

/**
 * Default status badge color mappings
 */
export const DEFAULT_STATUS_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  SUCCESS:   { bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.2)',  color: 'var(--success-600)' },
  FINISHED:  { bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.2)',  color: 'var(--success-600)' },
  RUNNING:   { bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.2)',  color: 'var(--primary-600)' },
  ETL:       { bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.2)',  color: 'var(--primary-600)' },
  LOADING:   { bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.2)',  color: 'var(--primary-600)' },
  PENDING:   { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.2)',  color: 'var(--warning-600)' },
  PAUSED:    { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.2)',  color: 'var(--warning-600)' },
  SUSPEND:   { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.2)',  color: 'var(--warning-600)' },
  SUSPENDED: { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.2)',  color: 'var(--warning-600)' },
  NEED_SCHEDULE: { bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.2)', color: 'var(--primary-600)' },
  UNSTABLE:  { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.2)',  color: 'var(--warning-600)' },
  FAILED:    { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.2)',  color: 'var(--danger-500)' },
  CANCELLED: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.2)',  color: 'var(--danger-500)' },
  ERROR:     { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.2)',  color: 'var(--danger-500)' },
  STOPPED:   { bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.2)', color: 'var(--text-tertiary)' },
};

/**
 * Get status style, with optional custom overrides
 */
export function getStatusStyle(status: string, custom?: Record<string, { bg: string; border: string; color: string }>) {
  const map = custom ? { ...DEFAULT_STATUS_STYLES, ...custom } : DEFAULT_STATUS_STYLES;
  return map[status] || map['PENDING'];
}
