/**
 * System-level permission management.
 *
 * Each feature module has a permission key. Roles (editor/viewer) have
 * configurable access via the sys_role_permissions table.
 * Admin always has full access (enforced at code level).
 */

import { getLocalDb } from './local-db';
import { requireAuth, AuthError } from './auth';
import type { SysRole, SysUser, SysSession } from './auth';

// ── Permission keys ──────────────────────────────────────────────────

export const PERMISSIONS = {
  DASHBOARD: 'dashboard',
  DATABASES: 'databases',
  CATALOGS: 'catalogs',
  MV: 'materialized_views',
  QUERY: 'query',
  ROUTINE_LOAD: 'routine_load',
  BROKER_LOAD: 'broker_load',
  PIPES: 'pipes',
  TASK_MANAGER: 'task_manager',
  TASKS: 'tasks',
  USERS: 'users',
  ROLES: 'roles',
  PRIVILEGES: 'privileges',
  NODES: 'nodes',
  RESOURCE_GROUPS: 'resource_groups',
  FUNCTIONS: 'functions',
  VARIABLES: 'variables',
  CLUSTER_MANAGER: 'cluster_manager',
  SYS_USERS: 'sys_users',
  AUDIT: 'audit',
  SYS_PERMISSIONS: 'sys_permissions',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── Permission metadata (for management UI) ──────────────────────────

export interface PermissionMeta {
  label: string;
  group: string;
  description: string;
  order: number;
}

export const PERMISSION_GROUPS: { key: string; label: string; order: number }[] = [
  { key: 'monitor', label: '监控', order: 0 },
  { key: 'data', label: '数据管理', order: 1 },
  { key: 'task', label: '任务管理', order: 2 },
  { key: 'permission', label: '权限管理', order: 3 },
  { key: 'ops', label: '集群运维', order: 4 },
  { key: 'system', label: '系统设置', order: 5 },
];

export const PERMISSION_META: Record<string, PermissionMeta> = {
  dashboard:          { label: '仪表盘',       group: 'monitor',    description: '查看集群监控仪表盘', order: 0 },
  databases:          { label: '数据库浏览',   group: 'data',       description: '浏览数据库和表结构', order: 0 },
  catalogs:           { label: 'Catalog 管理', group: 'data',       description: '管理外部数据源 Catalog', order: 1 },
  materialized_views: { label: '物化视图',     group: 'data',       description: '查看和管理物化视图', order: 2 },
  query:              { label: 'SQL 查询',     group: 'data',       description: '执行 SQL 查询', order: 3 },
  routine_load:       { label: 'Routine Load', group: 'task',       description: '管理 Routine Load 任务', order: 0 },
  broker_load:        { label: 'Broker Load',  group: 'task',       description: '管理 Broker Load 任务', order: 1 },
  pipes:              { label: 'Pipes',        group: 'task',       description: '管理 Pipe 数据流', order: 2 },
  task_manager:       { label: 'Submit Task',  group: 'task',       description: '提交和管理定时任务', order: 3 },
  tasks:              { label: 'Task Runs',    group: 'task',       description: '查看任务运行历史', order: 4 },
  users:              { label: '用户管理',     group: 'permission', description: '管理 StarRocks 数据库用户', order: 0 },
  roles:              { label: '角色管理',     group: 'permission', description: '管理 StarRocks 数据库角色', order: 1 },
  privileges:         { label: '权限管理',     group: 'permission', description: '查看数据库权限概览', order: 2 },
  nodes:              { label: '节点管理',     group: 'ops',        description: '查看和管理集群节点', order: 0 },
  resource_groups:    { label: '资源组',       group: 'ops',        description: '管理资源组配置', order: 1 },
  functions:          { label: '函数管理',     group: 'ops',        description: '查看和管理 UDF 函数', order: 2 },
  variables:          { label: '变量管理',     group: 'ops',        description: '查看和修改系统变量', order: 3 },
  cluster_manager:    { label: '集群管理',     group: 'system',     description: '管理 StarRocks 集群连接', order: 0 },
  sys_users:          { label: '系统用户',     group: 'system',     description: '管理系统登录账号', order: 1 },
  audit:              { label: '审计日志',     group: 'system',     description: '查看操作审计记录', order: 2 },
  sys_permissions:    { label: '权限配置',     group: 'system',     description: '配置角色功能权限', order: 3 },
};

// ── Default permissions (matches current hardcoded behavior) ─────────

export const DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  editor: {
    dashboard: true, databases: true, catalogs: true, materialized_views: true,
    query: true, routine_load: true, broker_load: true, pipes: true,
    task_manager: true, tasks: true, users: false, roles: false, privileges: false,
    nodes: false, resource_groups: true, functions: true, variables: true,
    cluster_manager: false, sys_users: false, audit: false, sys_permissions: false,
  },
  viewer: {
    dashboard: true, databases: true, catalogs: true, materialized_views: true,
    query: false, routine_load: true, broker_load: true, pipes: true,
    task_manager: true, tasks: true, users: false, roles: false, privileges: false,
    nodes: false, resource_groups: false, functions: true, variables: true,
    cluster_manager: false, sys_users: false, audit: false, sys_permissions: false,
  },
};

// ── Runtime helpers ──────────────────────────────────────────────────

export async function hasPermission(role: SysRole, permission: string): Promise<boolean> {
  if (role === 'admin') return true;

  const db = await getLocalDb();
  const row = await db.get<{ granted: number }>(
    'SELECT granted FROM sys_role_permissions WHERE role = ? AND permission = ?',
    [role, permission],
  );

  if (row !== undefined) return row.granted === 1;
  return DEFAULT_PERMISSIONS[role]?.[permission] ?? false;
}

export async function getPermissionsForRole(role: SysRole): Promise<string[]> {
  if (role === 'admin') return Object.values(PERMISSIONS);

  const db = await getLocalDb();
  const rows = await db.all<{ permission: string; granted: number }>(
    'SELECT permission, granted FROM sys_role_permissions WHERE role = ?',
    [role],
  );

  const perms = { ...(DEFAULT_PERMISSIONS[role] || {}) };
  for (const row of rows) {
    perms[row.permission] = row.granted === 1;
  }

  return Object.entries(perms)
    .filter(([, granted]) => granted)
    .map(([perm]) => perm);
}

export async function getAllRolePermissions(): Promise<Record<string, Record<string, boolean>>> {
  const db = await getLocalDb();

  const result: Record<string, Record<string, boolean>> = {
    admin: {},
    editor: { ...(DEFAULT_PERMISSIONS.editor || {}) },
    viewer: { ...(DEFAULT_PERMISSIONS.viewer || {}) },
  };

  for (const perm of Object.values(PERMISSIONS)) {
    result.admin[perm] = true;
  }

  const rows = await db.all<{ role: string; permission: string; granted: number }>(
    'SELECT role, permission, granted FROM sys_role_permissions',
  );

  for (const row of rows) {
    if (result[row.role]) {
      result[row.role][row.permission] = row.granted === 1;
    }
  }

  return result;
}

export async function updateRolePermissions(role: string, permissions: Record<string, boolean>): Promise<void> {
  if (role === 'admin') throw new Error('admin 权限不可修改');
  if (!['editor', 'viewer'].includes(role)) throw new Error('无效角色');

  const db = await getLocalDb();
  const upsertSql = db.upsertSql(
    'sys_role_permissions',
    ['role', 'permission', 'granted'],
    ['role', 'permission'],
    ['granted'],
  );

  await db.withTransaction(async (tx) => {
    for (const [permission, granted] of Object.entries(permissions)) {
      await tx.run(upsertSql, [role, permission, granted ? 1 : 0]);
    }
  });
}

export async function resetRolePermissions(role: string): Promise<void> {
  if (role === 'admin') throw new Error('admin 权限不可修改');

  const db = await getLocalDb();
  await db.run('DELETE FROM sys_role_permissions WHERE role = ?', [role]);
}

// ── API route middleware ─────────────────────────────────────────────

export async function requirePermission(request: Request, permission: string): Promise<{ user: SysUser; session: SysSession }> {
  const result = await requireAuth(request);
  const allowed = await hasPermission(result.user.role, permission);
  if (!allowed) {
    throw new AuthError('权限不足', 403);
  }
  return result;
}
