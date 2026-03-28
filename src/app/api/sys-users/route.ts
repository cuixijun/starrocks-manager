import { NextRequest, NextResponse } from 'next/server';
import { getLocalDb, recordAuditLog } from '@/lib/local-db';
import { requireRole, AuthError, hashPassword } from '@/lib/auth';
import type { SysUser } from '@/lib/auth';

// Password complexity: min 8 chars, must contain upper + lower + digit + special
function validatePassword(pwd: string): string | null {
  if (pwd.length < 8) return '密码长度至少 8 位';
  if (!/[A-Z]/.test(pwd)) return '密码必须包含大写字母';
  if (!/[a-z]/.test(pwd)) return '密码必须包含小写字母';
  if (!/[0-9]/.test(pwd)) return '密码必须包含数字';
  if (!/[^A-Za-z0-9]/.test(pwd)) return '密码必须包含特殊字符（如 !@#$%）';
  return null;
}

// GET /api/sys-users — list system users (admin only)
export async function GET(request: NextRequest) {
  try {
    const { user: operator } = await requireRole(request, 'admin');
    const db = await getLocalDb();
    const users = await db.all<SysUser>(
      `SELECT id, username, display_name, role, is_active, created_at, updated_at, last_login_at
       FROM sys_users ORDER BY id`,
    );

    // Get cluster access for each user
    const enriched = [];
    for (const u of users) {
      const clusters = await db.all<{ id: number; name: string }>(
        `SELECT c.id, c.name FROM clusters c
         INNER JOIN user_cluster_access uca ON c.id = uca.cluster_id
         WHERE uca.user_id = ?`,
        [u.id],
      );
      enriched.push({ ...u, clusters });
    }

    return NextResponse.json({ users: enriched });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

// POST /api/sys-users — create user (admin only)
export async function POST(request: NextRequest) {
  try {
    const { user: operator } = await requireRole(request, 'admin');
    const { username, password, display_name, role, cluster_ids } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请填写用户名和密码' }, { status: 400 });
    }
    if (!['admin', 'editor', 'viewer'].includes(role || '')) {
      return NextResponse.json({ error: '无效角色' }, { status: 400 });
    }

    // Password complexity check
    const pwdErr = validatePassword(password);
    if (pwdErr) {
      return NextResponse.json({ error: pwdErr }, { status: 400 });
    }

    const db = await getLocalDb();

    // Check duplicate
    const existing = await db.get<{ id: number }>('SELECT id FROM sys_users WHERE username = ?', [username]);
    if (existing) {
      return NextResponse.json({ error: `用户 "${username}" 已存在` }, { status: 409 });
    }

    const hash = hashPassword(password);
    const result = await db.run(
      'INSERT INTO sys_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      [username, hash, display_name || '', role || 'viewer'],
    );

    const userId = result.insertId;

    // Assign cluster access
    if (Array.isArray(cluster_ids) && cluster_ids.length > 0) {
      for (const cid of cluster_ids) {
        await db.run(
          db.isMysql
            ? 'INSERT IGNORE INTO user_cluster_access (user_id, cluster_id) VALUES (?, ?)'
            : 'INSERT OR IGNORE INTO user_cluster_access (user_id, cluster_id) VALUES (?, ?)',
          [userId, cid],
        );
      }
    }

    // Audit: user.create
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: operator.id, username: operator.username,
      action: 'user.create', category: 'user', level: 'basic',
      target: `用户 ${username}`,
      detail: { newUserId: userId, role: role || 'viewer' },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, id: userId });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

// PUT /api/sys-users — update user (admin only)
export async function PUT(request: NextRequest) {
  try {
    const { user: operator } = await requireRole(request, 'admin');
    const { id, username, password, display_name, role, is_active, cluster_ids } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = await getLocalDb();
    const user = await db.get<SysUser & { password_hash: string }>('SELECT * FROM sys_users WHERE id = ?', [id]);
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // Prevent disabling the last admin
    if (is_active === 0 && user.role === 'admin') {
      const adminCount = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM sys_users WHERE role = 'admin' AND is_active = 1");
      if ((adminCount?.cnt || 0) <= 1) {
        return NextResponse.json({ error: '不能禁用最后一个管理员账号' }, { status: 400 });
      }
    }

    // Prevent changing the built-in admin user's role
    if (role !== undefined && role !== user.role && user.username === 'admin') {
      return NextResponse.json({ error: '内置管理员账号的角色不可修改' }, { status: 400 });
    }

    // Prevent role downgrade that would leave zero admins
    if (role !== undefined && role !== 'admin' && user.role === 'admin') {
      const adminCount = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM sys_users WHERE role = 'admin' AND is_active = 1");
      if ((adminCount?.cnt || 0) <= 1) {
        return NextResponse.json({ error: '不能修改最后一个管理员的角色' }, { status: 400 });
      }
    }

    // Password complexity check
    if (password) {
      const pwdErr = validatePassword(password);
      if (pwdErr) {
        return NextResponse.json({ error: pwdErr }, { status: 400 });
      }
    }

    // Build update
    const updates: string[] = [];
    const values: unknown[] = [];

    if (username !== undefined) { updates.push('username = ?'); values.push(username); }
    if (display_name !== undefined) { updates.push('display_name = ?'); values.push(display_name); }
    if (role !== undefined) { updates.push('role = ?'); values.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }
    if (password) {
      updates.push('password_hash = ?');
      values.push(hashPassword(password));
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    await db.run(`UPDATE sys_users SET ${updates.join(', ')} WHERE id = ?`, values);

    // Update cluster access
    if (Array.isArray(cluster_ids)) {
      await db.run('DELETE FROM user_cluster_access WHERE user_id = ?', [id]);
      for (const cid of cluster_ids) {
        await db.run(
          db.isMysql
            ? 'INSERT IGNORE INTO user_cluster_access (user_id, cluster_id) VALUES (?, ?)'
            : 'INSERT OR IGNORE INTO user_cluster_access (user_id, cluster_id) VALUES (?, ?)',
          [id, cid],
        );
      }
    }

    // Audit: user.update
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: operator.id, username: operator.username,
      action: 'user.update', category: 'user', level: 'basic',
      target: `用户 ${user.username}`,
      detail: { targetUserId: id, changes: { username, display_name, role, is_active } },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

// DELETE /api/sys-users — delete user (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const { user: operator } = await requireRole(request, 'admin');
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = await getLocalDb();
    const user = await db.get<{ role: string; username: string }>('SELECT role, username FROM sys_users WHERE id = ?', [id]);
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // Prevent deleting the last admin
    if (user.role === 'admin') {
      const adminCount = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM sys_users WHERE role = 'admin'");
      if ((adminCount?.cnt || 0) <= 1) {
        return NextResponse.json({ error: '不能删除最后一个管理员账号' }, { status: 400 });
      }
    }

    // Capture username before deletion for audit
    const deletedUsername = user.username;

    await db.run('DELETE FROM sys_users WHERE id = ?', [id]);

    // Audit: user.delete
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: operator.id, username: operator.username,
      action: 'user.delete', category: 'user', level: 'basic',
      target: `用户 ${deletedUsername}`,
      ipAddress: ip,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
