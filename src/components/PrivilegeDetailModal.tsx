'use client';

import React, { useMemo } from 'react';
import {
  X, Shield, Wrench, Database, Code2, FolderOpen, MoreHorizontal, Key,
} from 'lucide-react';
import { classifyGrants, type CatalogGroup, type CategorisedGroup, type ParsedPrivilege } from '@/utils/grantClassifier';

const ICON_MAP: Record<string, React.ReactNode> = {
  Shield:         <Shield size={12} />,
  Wrench:         <Wrench size={12} />,
  Database:       <Database size={12} />,
  Code:           <Code2 size={12} />,
  FolderOpen:     <FolderOpen size={12} />,
  MoreHorizontal: <MoreHorizontal size={12} />,
};

interface PrivilegeDetailModalProps {
  /** Display title prefix – e.g. "角色 r_bigdata" or "'starrocks'@'%'" */
  title: string;
  grants: string[];
  onClose: () => void;
}

function PrivilegeItem({ priv, idx }: { priv: ParsedPrivilege; idx: number }) {
  if (!priv.privilege && !priv.target) {
    // Unparsed raw grant
    return (
      <code style={{
        fontSize: '0.74rem', color: 'var(--text-secondary)',
        fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all',
      }}>
        {priv.raw}
      </code>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <code style={{
        fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {priv.privilege}
      </code>
      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>ON</span>
      <code style={{
        fontSize: '0.72rem', color: 'var(--text-secondary)',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {priv.target}
      </code>
    </div>
  );
}

function CategorySection({ group }: { group: CategorisedGroup }) {
  return (
    <div style={{ marginBottom: '2px' }}>
      {/* Category header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '5px 12px',
        backgroundColor: group.bgColor,
        borderRadius: 'var(--radius-sm)',
        marginBottom: '2px',
      }}>
        <span style={{ color: group.color, display: 'flex', alignItems: 'center' }}>
          {ICON_MAP[group.icon] || <Key size={12} />}
        </span>
        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: group.color }}>
          {group.label}
        </span>
        <span style={{
          fontSize: '0.66rem', fontWeight: 600, color: group.color, opacity: 0.7,
          padding: '0 5px', borderRadius: '999px',
          backgroundColor: group.borderColor,
        }}>
          {group.items.length}
        </span>
      </div>
      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {group.items.map((priv, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            padding: '5px 12px 5px 30px',
            borderBottomWidth: i < group.items.length - 1 ? '1px' : '0',
            borderBottomStyle: 'solid',
            borderBottomColor: 'var(--border-secondary)',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '18px', height: '18px', borderRadius: '999px', flexShrink: 0,
              fontSize: '0.62rem', fontWeight: 700,
              backgroundColor: group.bgColor, color: group.color,
              marginTop: '1px',
            }}>
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PrivilegeItem priv={priv} idx={i} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CatalogSection({ group }: { group: CatalogGroup }) {
  const displayName = group.catalogName === 'default_catalog'
    ? '内部 Catalog (default_catalog)'
    : group.catalogName === '__all__'
      ? '全局 (ALL CATALOGS)'
      : `外部 Catalog: ${group.catalogName}`;

  const scopeStyle = group.isInternal
    ? { color: 'var(--success-600)', bg: 'rgba(22,163,74,0.06)', border: 'rgba(22,163,74,0.15)' }
    : { color: 'var(--warning-600)', bg: 'rgba(234,179,8,0.06)', border: 'rgba(234,179,8,0.15)' };

  return (
    <div style={{
      borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-secondary)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      {/* Catalog header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        backgroundColor: scopeStyle.bg,
        borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: scopeStyle.border,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FolderOpen size={13} style={{ color: scopeStyle.color }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: scopeStyle.color }}>
            {displayName}
          </span>
        </div>
        <span style={{
          fontSize: '0.68rem', fontWeight: 600, color: scopeStyle.color,
          padding: '1px 7px', borderRadius: '999px',
          backgroundColor: scopeStyle.border,
        }}>
          {group.totalCount} 项
        </span>
      </div>
      {/* Categories inside */}
      <div style={{ padding: '4px 0' }}>
        {group.categories.map((cat, i) => (
          <CategorySection key={i} group={cat} />
        ))}
      </div>
    </div>
  );
}

export default function PrivilegeDetailModal({ title, grants, onClose }: PrivilegeDetailModalProps) {
  const catalogGroups = useMemo(() => classifyGrants(grants), [grants]);
  const totalCount = grants.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '720px', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">权限详情</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {title} · {totalCount} 项权限
            </div>
          </div>
          <button className="btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Summary bar */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 20px',
          borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'var(--border-secondary)',
        }}>
          {catalogGroups.map(cg => (
            cg.categories.map((cat, ci) => (
              <span key={`${cg.catalogName}-${ci}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                padding: '1px 7px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 500,
                backgroundColor: cat.bgColor, color: cat.color,
                borderWidth: '1px', borderStyle: 'solid', borderColor: cat.borderColor,
              }}>
                {cat.label}: {cat.items.length}
              </span>
            ))
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {catalogGroups.map((cg, i) => (
            <CatalogSection key={i} group={cg} />
          ))}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
