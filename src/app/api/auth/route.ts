import { NextRequest, NextResponse } from 'next/server';
import { getLocalDb } from '@/lib/local-db';
import { verifyPassword, hashPassword, createSession, validateSession, destroySession, getAuthFromRequest, getUserClusters } from '@/lib/auth';
import { validateCaptcha } from '@/app/api/captcha/route';
import { recordAuditLog } from '@/lib/local-db';
import type { SysUser } from '@/lib/auth';

interface SysUserRow extends SysUser {
  password_hash: string;
}

// Password complexity check
function validatePasswordComplexity(pwd: string): string | null {
  if (pwd.length < 8) return '密码长度至少 8 位';
  if (!/[A-Z]/.test(pwd)) return '密码必须包含大写字母';
  if (!/[a-z]/.test(pwd)) return '密码必须包含小写字母';
  if (!/[0-9]/.test(pwd)) return '密码必须包含数字';
  if (!/[^A-Za-z0-9]/.test(pwd)) return '密码必须包含特殊字符（如 !@#$%）';
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, username, password, captchaToken, captchaAnswer } = body;

    // --- Login ---
    if (!action || action === 'login') {
      if (!username || !password) {
        return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
      }

      // Validate captcha
      if (!captchaToken || captchaAnswer === undefined || captchaAnswer === '') {
        return NextResponse.json({ error: '请输入验证码' }, { status: 400 });
      }
      if (!validateCaptcha(captchaToken, Number(captchaAnswer))) {
        return NextResponse.json({ error: '验证码错误或已过期，请刷新重试' }, { status: 400 });
      }

      const db = await getLocalDb();
      const user = await db.get<SysUserRow>(
        'SELECT * FROM sys_users WHERE username = ?',
        [username],
      );

      if (!user) {
        return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
      }

      if (!user.is_active) {
        return NextResponse.json({ error: '账号已被禁用，请联系管理员' }, { status: 403 });
      }

      if (!verifyPassword(password, user.password_hash)) {
        return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
      }

      // Get user's accessible clusters
      const clusters = await getUserClusters(user.id, user.role);
      const defaultCluster = clusters.length > 0 ? clusters[0].id : null;

      // Create session
      const token = await createSession(user.id, defaultCluster);

      // Update last login time
      await db.run('UPDATE sys_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

      // Audit: login
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
      await recordAuditLog({
        userId: user.id, username: user.username,
        action: 'auth.login', category: 'auth', level: 'standard',
        target: user.username, ipAddress: ip,
      });

      const response = NextResponse.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          role: user.role,
        },
        clusters: clusters.map(c => ({ id: c.id, name: c.name, host: c.host, port: c.port, description: c.description })),
        activeClusterId: defaultCluster,
        token,
      });

      // Set cookie
      response.cookies.set('sys_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60, // 24 hours
      });

      return response;
    }

    // --- Logout ---
    if (action === 'logout') {
      const token = getAuthFromRequest(request);
      let logoutUser: string | undefined;
      if (token) {
        const sess = await validateSession(token);
        logoutUser = sess?.user?.username;
        await destroySession(token);
      }
      // Audit: logout
      if (logoutUser) {
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
        await recordAuditLog({
          userId: null, username: logoutUser,
          action: 'auth.logout', category: 'auth', level: 'standard',
          target: logoutUser, ipAddress: ip,
        });
      }
      const response = NextResponse.json({ success: true });
      response.cookies.delete('sys_token');
      return response;
    }

    // --- Change Password (self-service) ---
    if (action === 'change-password') {
      const token = getAuthFromRequest(request);
      if (!token) {
        return NextResponse.json({ error: '未登录' }, { status: 401 });
      }
      const result = await validateSession(token);
      if (!result) {
        return NextResponse.json({ error: '会话过期，请重新登录' }, { status: 401 });
      }

      const { oldPassword, newPassword } = body;
      if (!oldPassword || !newPassword) {
        return NextResponse.json({ error: '请填写旧密码和新密码' }, { status: 400 });
      }

      // Validate new password complexity
      const pwdErr = validatePasswordComplexity(newPassword);
      if (pwdErr) {
        return NextResponse.json({ error: pwdErr }, { status: 400 });
      }

      const db = await getLocalDb();
      const user = await db.get<SysUserRow>('SELECT * FROM sys_users WHERE id = ?', [result.user.id]);
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      }

      // Verify old password
      if (!verifyPassword(oldPassword, user.password_hash)) {
        return NextResponse.json({ error: '旧密码错误' }, { status: 400 });
      }

      // Update password
      const newHash = hashPassword(newPassword);
      await db.run('UPDATE sys_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newHash, user.id]);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// --- GET /api/auth  (get current user info, "me") ---
export async function GET(request: NextRequest) {
  try {
    const token = getAuthFromRequest(request);
    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const result = await validateSession(token);
    if (!result) {
      const response = NextResponse.json({ authenticated: false }, { status: 401 });
      response.cookies.delete('sys_token');
      return response;
    }

    const { user, session } = result;
    const clusters = await getUserClusters(user.id, user.role);

    // Get active cluster details
    let activeCluster = null;
    if (session.cluster_id) {
      activeCluster = clusters.find(c => c.id === session.cluster_id) || null;
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
      clusters: clusters.map(c => ({ id: c.id, name: c.name, host: c.host, port: c.port, description: c.description })),
      activeCluster: activeCluster ? {
        id: activeCluster.id,
        name: activeCluster.name,
        host: activeCluster.host,
        port: activeCluster.port,
      } : null,
    });
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
