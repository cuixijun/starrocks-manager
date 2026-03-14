'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useSession } from '@/hooks/useSession';
import {
  LayoutDashboard,
  Database,
  Users,
  Shield,
  Terminal,
  LogOut,
  ShieldCheck,
  Layers,
  FolderTree,
  Code2,
  Settings,
} from 'lucide-react';

const navItems = [
  { label: '监控', section: true },
  { href: '/dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { label: '数据管理', section: true },
  { href: '/databases', icon: Database, label: '数据库浏览' },
  { href: '/catalogs', icon: FolderTree, label: 'Catalog 管理' },
  { href: '/query', icon: Terminal, label: 'SQL 查询' },
  { label: '权限管理', section: true },
  { href: '/users', icon: Users, label: '用户管理' },
  { href: '/roles', icon: ShieldCheck, label: '角色管理' },
  { href: '/privileges', icon: Shield, label: '权限管理' },
  { label: '资源管理', section: true },
  { href: '/resource-groups', icon: Layers, label: '资源组管理' },
  { label: '系统管理', section: true },
  { href: '/functions', icon: Code2, label: '函数管理' },
  { href: '/variables', icon: Settings, label: '变量管理' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { session, disconnect } = useSession();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">SR</div>
        <div>
          <div className="sidebar-title">StarRocks Manager</div>
          <div className="sidebar-subtitle">数据库管理工具</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item, i) => {
          if (item.section) {
            return <div key={i} className="nav-section-label">{item.label}</div>;
          }
          const Icon = item.icon!;
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href!));
          return (
            <Link key={item.href} href={item.href!} className={`nav-item ${isActive ? 'active' : ''}`}>
              <Icon />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
          <ThemeSwitcher />
        </div>

        {session && (
          <div className="connection-badge">
            <span className="connection-dot connected" />
            <div className="connection-info">
              <div className="connection-host">{session.host}:{session.port}</div>
              <div className="connection-user">{session.username} · {session.version || 'StarRocks'}</div>
            </div>
            <button className="btn-ghost btn-icon" onClick={disconnect} title="断开连接">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
