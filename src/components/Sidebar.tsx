'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import type { SysRole } from '@/hooks/useAuth';
import {
  LayoutDashboard,
  Database,
  Users,
  Shield,
  Terminal,
  ShieldCheck,
  Layers,
  FolderTree,
  Code2,
  Settings,
  Box,
  Radio,
  HardDrive,
  GitBranch,
  ListChecks,
  Server,
  Paintbrush,
  CalendarClock,
  UserCog,
  Network,
} from 'lucide-react';

interface NavItem {
  label: string;
  section?: boolean;
  href?: string;
  icon?: React.ElementType;
  minRole?: SysRole;
}

const navItems: NavItem[] = [
  { label: '监控', section: true },
  { href: '/dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { label: '数据管理', section: true },
  { href: '/databases', icon: Database, label: '数据库浏览' },
  { href: '/catalogs', icon: FolderTree, label: 'Catalog 管理' },
  { href: '/materialized-views', icon: Box, label: '物化视图' },
  { href: '/query', icon: Terminal, label: 'SQL 查询', minRole: 'editor' },
  { label: '任务管理', section: true },
  { href: '/routine-load', icon: Radio, label: 'Routine Load' },
  { href: '/broker-load', icon: HardDrive, label: 'Broker Load' },
  { href: '/pipes', icon: GitBranch, label: 'Pipes' },
  { href: '/task-manager', icon: CalendarClock, label: 'Submit Task' },
  { href: '/tasks', icon: ListChecks, label: 'Task Runs' },
  { label: '权限管理', section: true, minRole: 'admin' },
  { href: '/users', icon: Users, label: '用户管理', minRole: 'admin' },
  { href: '/roles', icon: ShieldCheck, label: '角色管理', minRole: 'admin' },
  { href: '/privileges', icon: Shield, label: '权限管理', minRole: 'admin' },
  { label: '集群运维', section: true },
  { href: '/nodes', icon: Server, label: '节点管理', minRole: 'admin' },
  { href: '/resource-groups', icon: Layers, label: '资源组', minRole: 'editor' },
  { href: '/functions', icon: Code2, label: '函数管理' },
  { href: '/variables', icon: Settings, label: '变量管理' },
  { label: '平台设置', section: true, minRole: 'admin' },
  { href: '/cluster-manager', icon: Network, label: '集群管理', minRole: 'admin' },
  { href: '/sys-users', icon: UserCog, label: '系统用户', minRole: 'admin' },
  { href: '/design-system', icon: Paintbrush, label: 'UI 规范', minRole: 'admin' },
];

const ROLE_LEVEL: Record<SysRole, number> = { viewer: 0, editor: 1, admin: 2 };

function hasAccess(userRole: SysRole, minRole?: SysRole): boolean {
  if (!minRole) return true;
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[minRole];
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (!user) return null;

  // Filter nav items by role
  const visibleItems = navItems.filter(item => {
    if (item.section) {
      const idx = navItems.indexOf(item);
      const nextSectionIdx = navItems.findIndex((n, i) => i > idx && n.section);
      const children = navItems.slice(idx + 1, nextSectionIdx === -1 ? undefined : nextSectionIdx);
      return children.some(c => hasAccess(user.role, c.minRole));
    }
    return hasAccess(user.role, item.minRole);
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">SR</div>
        <div>
          <div className="sidebar-title">StarRocks Manager</div>
          <div className="sidebar-subtitle">数据库管理平台</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {visibleItems.map((item, i) => {
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
    </aside>
  );
}
