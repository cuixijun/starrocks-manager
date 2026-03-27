'use client';

import React from 'react';
import { Shield, Lightbulb, ExternalLink } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';

export default function PrivilegesPage() {
  return (
    <>
      <div className="page-header">
        <Breadcrumb items={[{ label: '权限管理' }, { label: '权限管理' }]} />
        <div className="page-header-row">
          <div>
            <h1 className="page-title">权限管理</h1>
            <p className="page-description">查看和管理数据库权限</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '400px', gap: '20px',
        }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '20px',
            background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(59,130,246,0.08))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(139,92,246,0.15)',
          }}>
            <Lightbulb size={36} style={{ color: '#8b5cf6' }} />
          </div>

          <div style={{ textAlign: 'center', maxWidth: '480px' }}>
            <h2 style={{
              fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)',
              marginBottom: '8px',
            }}>
              🧠 正在头脑风暴中...
            </h2>
            <p style={{
              fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7,
              marginBottom: '20px',
            }}>
              权限管理页面正在重新设计中，目前功能暂不可用。<br />
              如果你有好的建议或想法，欢迎提 Issue 一起讨论！
            </p>

            <a
              href="https://github.com/cuixijun/starrocks-manager/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '10px 24px', borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                color: '#fff', fontSize: '0.85rem', fontWeight: 600,
                textDecoration: 'none', transition: 'all 0.2s',
                boxShadow: '0 2px 8px rgba(139,92,246,0.25)',
              }}
            >
              <ExternalLink size={15} /> 提交 Issue
            </a>
          </div>

          <div style={{
            marginTop: '16px', padding: '12px 20px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(139,92,246,0.04)',
            border: '1px solid rgba(139,92,246,0.1)',
            fontSize: '0.78rem', color: 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <Shield size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
            <span>
              当前可通过<strong style={{ color: 'var(--text-secondary)' }}>用户管理</strong>和<strong style={{ color: 'var(--text-secondary)' }}>角色管理</strong>页面进行权限授予和撤销操作
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
