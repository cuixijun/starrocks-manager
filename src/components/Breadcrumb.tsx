'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, Database } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav
      aria-label="breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.82rem',
        padding: '10px 0',
        flexWrap: 'wrap',
      }}
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={idx}>
            {idx > 0 && (
              <ChevronRight
                size={14}
                style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
              />
            )}
            {isLast || !item.href ? (
              <span
                style={{
                  color: isLast ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontWeight: isLast ? 600 : 400,
                  maxWidth: '280px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {idx === 0 && (
                  <Database
                    size={13}
                    style={{
                      display: 'inline-block',
                      verticalAlign: '-2px',
                      marginRight: '5px',
                      opacity: 0.7,
                    }}
                  />
                )}
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                style={{
                  color: 'var(--primary-600)',
                  textDecoration: 'none',
                  fontWeight: 400,
                  maxWidth: '280px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary-700)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--primary-600)')}
              >
                {idx === 0 && (
                  <Database
                    size={13}
                    style={{
                      display: 'inline-block',
                      verticalAlign: '-2px',
                      marginRight: '5px',
                      opacity: 0.7,
                    }}
                  />
                )}
                {item.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
