// Server-side auth utilities

import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getLocalDb } from './local-db';
import { normalizeTimestamp, shanghaiDatetime } from './db-adapter';

// ---- Types ----

export type SysRole = 'admin' | 'editor' | 'viewer';

export interface SysUser {
  id: number;
  username: string;
  display_name: string;
  role: SysRole;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface SysSession {
  token: string;
  user_id: number;
  cluster_id: number | null;
  created_at: string;
  expires_at: string;
}

export interface ClusterInfo {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  default_db: string;
  description: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// ---- Password ----

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

// ---- Session ----

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function createSession(userId: number, clusterId?: number | null): Promise<string> {
  const db = await getLocalDb();
  const token = randomUUID();
  const expiresAt = shanghaiDatetime(new Date(Date.now() + SESSION_TTL_MS));
  await db.run(
    'INSERT INTO sys_sessions (token, user_id, cluster_id, expires_at) VALUES (?, ?, ?, ?)',
    [token, userId, clusterId ?? null, expiresAt],
  );
  return token;
}

export async function validateSession(token: string): Promise<{ user: SysUser; session: SysSession } | null> {
  const db = await getLocalDb();
  const session = await db.get<SysSession>(
    'SELECT * FROM sys_sessions WHERE token = ?',
    [token],
  );

  if (!session) return null;

  // Check expiry
  const expiresAt = normalizeTimestamp(session.expires_at);
  if (new Date(expiresAt).getTime() < Date.now()) {
    await db.run('DELETE FROM sys_sessions WHERE token = ?', [token]);
    return null;
  }

  const user = await db.get<SysUser>(
    'SELECT id, username, display_name, role, is_active, created_at, updated_at, last_login_at FROM sys_users WHERE id = ? AND is_active = 1',
    [session.user_id],
  );

  if (!user) {
    await db.run('DELETE FROM sys_sessions WHERE token = ?', [token]);
    return null;
  }

  return { user, session };
}

export async function destroySession(token: string): Promise<void> {
  const db = await getLocalDb();
  await db.run('DELETE FROM sys_sessions WHERE token = ?', [token]);
}

export async function switchCluster(token: string, clusterId: number): Promise<void> {
  const db = await getLocalDb();
  await db.run('UPDATE sys_sessions SET cluster_id = ? WHERE token = ?', [clusterId, token]);
}

// ---- Auth helper for API routes ----

export function getAuthFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/sys_token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

export async function requireAuth(request: Request): Promise<{ user: SysUser; session: SysSession }> {
  const token = getAuthFromRequest(request);
  if (!token) {
    throw new AuthError('未登录', 401);
  }
  const result = await validateSession(token);
  if (!result) {
    throw new AuthError('会话已过期，请重新登录', 401);
  }
  return result;
}

export async function requireRole(request: Request, ...roles: SysRole[]): Promise<{ user: SysUser; session: SysSession }> {
  const result = await requireAuth(request);
  if (!roles.includes(result.user.role)) {
    throw new AuthError('权限不足', 403);
  }
  return result;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number = 401) {
    super(message);
    this.status = status;
  }
}

// ---- Cluster access helpers ----

export async function getUserClusters(userId: number, role: SysRole): Promise<ClusterInfo[]> {
  const db = await getLocalDb();
  if (role === 'admin') {
    return db.all<ClusterInfo>('SELECT * FROM clusters WHERE is_active = 1 ORDER BY name');
  }
  return db.all<ClusterInfo>(
    `SELECT c.* FROM clusters c
     INNER JOIN user_cluster_access uca ON c.id = uca.cluster_id
     WHERE uca.user_id = ? AND c.is_active = 1
     ORDER BY c.name`,
    [userId],
  );
}

export async function getCluster(clusterId: number): Promise<ClusterInfo | null> {
  const db = await getLocalDb();
  const row = await db.get<ClusterInfo>('SELECT * FROM clusters WHERE id = ? AND is_active = 1', [clusterId]);
  return row || null;
}
