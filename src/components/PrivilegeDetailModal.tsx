'use client';

import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  X, Shield, Wrench, Database, Code2, FolderOpen, MoreHorizontal, Key,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { classifyGrants, type CatalogGroup, type CatalogGrant, type CategorisedGroup, type ParsedPrivilege } from '@/utils/grantClassifier';

const ICON_MAP: Record<string, React.FC<{ size?: number }>> = {
  Shield, Wrench, Database, Code: Code2, FolderOpen, MoreHorizontal,
};

interface PrivilegeDetailModalProps {
  title: string;
  grants: string[];
  catalogGrants?: CatalogGrant[];
  onClose: () => void;
}

/* ── Single privilege item ──────────────────────────────────────────── */

function PrivilegeItem({ priv }: { priv: ParsedPrivilege }) {
  if (!priv.privilege && !priv.target) {
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

/* ── Collapsible category section ───────────────────────────────────── */

export function CategorySection({ group, defaultCollapsed = false }: {
  group: CategorisedGroup;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const IconComp = ICON_MAP[group.icon] || Key;
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div id={group.sectionId} style={{ marginBottom: '2px' }}>
      {/* Clickable category header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '5px 12px',
          backgroundColor: group.bgColor,
          borderRadius: 'var(--radius-sm)',
          marginBottom: collapsed ? '0' : '2px',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background-color 0.15s',
        }}
      >
        <Chevron size={13} style={{ color: group.color, flexShrink: 0 }} />
        <span style={{ color: group.color, display: 'flex', alignItems: 'center' }}>
          <IconComp size={12} />
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
      {/* Items — collapsible */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {group.items.map((priv, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '5px 12px 5px 36px',
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
                <PrivilegeItem priv={priv} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Catalog scope section ──────────────────────────────────────────── */

export function CatalogSectionBlock({ group }: { group: CatalogGroup }) {
  const displayName = group.catalogName === 'default_catalog'
    ? '内部权限'
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

/* ── Main Modal ─────────────────────────────────────────────────────── */

export default function PrivilegeDetailModal({ title, grants, catalogGrants, onClose }: PrivilegeDetailModalProps) {
  const catalogGroups = useMemo(() => classifyGrants(grants, catalogGrants), [grants, catalogGrants]);
  const totalCount = grants.length;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Collect all tags for summary bar
  const allTags = useMemo(() => {
    const tags: { label: string; count: number; sectionId: string; color: string; bgColor: string; borderColor: string }[] = [];
    for (const cg of catalogGroups) {
      for (const cat of cg.categories) {
        // Merge same-category tags across catalogs in the summary
        const existing = tags.find(t => t.label === cat.label);
        if (existing) {
          existing.count += cat.items.length;
        } else {
          tags.push({
            label: cat.label,
            count: cat.items.length,
            sectionId: cat.sectionId,
            color: cat.color,
            bgColor: cat.bgColor,
            borderColor: cat.borderColor,
          });
        }
      }
    }
    return tags;
  }, [catalogGroups]);

  const scrollToSection = useCallback((sectionId: string) => {
    if (!bodyRef.current) return;
    const el = bodyRef.current.querySelector(`#${CSS.escape(sectionId)}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-lg"
        onClick={e => e.stopPropagation()}
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

        {/* Summary bar — clickable tags */}
        <div className="modal-lg-summary">
          {allTags.map((tag, i) => (
            <button
              key={i}
              onClick={() => scrollToSection(tag.sectionId)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                padding: '2px 8px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600,
                backgroundColor: tag.bgColor, color: tag.color,
                borderWidth: '1px', borderStyle: 'solid', borderColor: tag.borderColor,
                cursor: 'pointer',
                transition: 'all 0.15s',
                outline: 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'scale(1.03)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {tag.label}: {tag.count}
            </button>
          ))}
        </div>

        {/* Body – scrollable */}
        <div className="modal-lg-body" ref={bodyRef}>
          {catalogGroups.map((cg, i) => (
            <CatalogSectionBlock key={i} group={cg} />
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
