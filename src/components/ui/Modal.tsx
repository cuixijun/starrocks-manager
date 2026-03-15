'use client';

import React, { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  maxWidth?: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ open, onClose, title, maxWidth = '480px', footer, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth }}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** SQL Preview block inside modals */
export function SqlPreview({ sql }: { sql: string }) {
  return (
    <div style={{ marginTop: '8px', padding: '10px 14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: '4px' }}>SQL 预览</div>
      <code style={{ fontSize: '0.78rem', color: 'var(--primary-600)', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
        {sql}
      </code>
    </div>
  );
}
