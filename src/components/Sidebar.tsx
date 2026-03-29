'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
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
  ScrollText,
  KeyRound,
  Microscope,
  HardDriveDownload,
  FileText,
} from 'lucide-react';

interface NavItem {
  label: string;
  section?: boolean;
  href?: string;
  icon?: React.ElementType;
  permission?: string;        // permission key from permissions.ts
  adminOnly?: boolean;        // items with no permission key, admin-only (e.g. design-system)
}

const navItems: NavItem[] = [
  { label: '监控', section: true },
  { href: '/dashboard', icon: LayoutDashboard, label: '仪表盘', permission: 'dashboard' },
  { label: '数据管理', section: true },
  { href: '/databases', icon: Database, label: '数据库浏览', permission: 'databases' },
  { href: '/catalogs', icon: FolderTree, label: 'Catalog 管理', permission: 'catalogs' },
  { href: '/materialized-views', icon: Box, label: '物化视图', permission: 'materialized_views' },
  { href: '/query', icon: Terminal, label: 'SQL 查询', permission: 'query' },
  { label: '任务管理', section: true },
  { href: '/routine-load', icon: Radio, label: 'Routine Load', permission: 'routine_load' },
  { href: '/broker-load', icon: HardDrive, label: 'Broker Load', permission: 'broker_load' },
  { href: '/pipes', icon: GitBranch, label: 'Pipes', permission: 'pipes' },
  { href: '/task-manager', icon: CalendarClock, label: 'Submit Task', permission: 'task_manager' },
  { href: '/tasks', icon: ListChecks, label: 'Task Runs', permission: 'tasks' },
  { label: '权限管理', section: true },
  { href: '/users', icon: Users, label: '用户管理', permission: 'users' },
  { href: '/roles', icon: ShieldCheck, label: '角色管理', permission: 'roles' },
  { href: '/privileges', icon: Shield, label: '权限管理', permission: 'privileges' },
  { label: '集群运维', section: true },
  { href: '/nodes', icon: Server, label: '节点管理', permission: 'nodes' },
  { href: '/resource-groups', icon: Layers, label: '资源组', permission: 'resource_groups' },
  { href: '/functions', icon: Code2, label: '函数管理', permission: 'functions' },
  { href: '/variables', icon: Settings, label: '变量管理', permission: 'variables' },
  { href: '/show-proc', icon: Microscope, label: '高级诊断', permission: 'show_proc' },
  { href: '/compaction-score', icon: HardDriveDownload, label: '合并诊断', permission: 'show_proc' },
  { label: '系统设置', section: true },
  { href: '/cluster-manager', icon: Network, label: '集群管理', permission: 'cluster_manager' },
  { href: '/sys-users', icon: UserCog, label: '系统用户', permission: 'sys_users' },
  { href: '/audit', icon: ScrollText, label: '审计日志', permission: 'audit' },
  { href: '/sys-permissions', icon: KeyRound, label: '权限配置', permission: 'sys_permissions' },
  { href: '/changelog', icon: FileText, label: '变更日志' },
  { href: '/design-system', icon: Paintbrush, label: 'UI 规范', adminOnly: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();

  if (!user) return null;

  function canAccess(item: NavItem): boolean {
    if (item.adminOnly) return user!.role === 'admin';
    if (item.permission) return hasPermission(item.permission);
    return true; // no restriction
  }

  // Filter nav items by permission
  const visibleItems = navItems.filter(item => {
    if (item.section) {
      const idx = navItems.indexOf(item);
      const nextSectionIdx = navItems.findIndex((n, i) => i > idx && n.section);
      const children = navItems.slice(idx + 1, nextSectionIdx === -1 ? undefined : nextSectionIdx);
      return children.some(c => canAccess(c));
    }
    return canAccess(item);
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
