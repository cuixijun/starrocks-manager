import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { recordAuditLog } from '@/lib/local-db';
import {
  getAllRolePermissions,
  getPermissionsForRole,
  updateRolePermissions,
  resetRolePermissions,
  PERMISSION_META,
  PERMISSION_GROUPS,
  DEFAULT_PERMISSIONS,
} from '@/lib/permissions';

/**
 * GET /api/sys-permissions
 *
 * Query params:
 *   - role: (optional) return permissions for a specific role
 *     If omitted, returns full matrix for all roles + metadata.
 */
export async function GET(request: NextRequest) {
  try {
    const role = request.nextUrl.searchParams.get('role');

    if (role) {
      // Return permissions list for specific role (used by frontend hook)
      const permissions = await getPermissionsForRole(role as 'admin' | 'editor' | 'viewer');
      return NextResponse.json({ permissions });
    }

    // Full matrix + metadata (for management UI)
    const matrix = await getAllRolePermissions();
    return NextResponse.json({
      matrix,
      meta: PERMISSION_META,
      groups: PERMISSION_GROUPS,
      defaults: DEFAULT_PERMISSIONS,
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

/**
 * PUT /api/sys-permissions — update a role's permissions (admin only)
 *
 * Body: { role: string, permissions: Record<string, boolean> }
 */
export async function PUT(request: NextRequest) {
  try {
    const { user: operator } = await requireRole(request, 'admin');
    const { role, permissions, action } = await request.json();

    if (!role) {
      return NextResponse.json({ error: '角色不能为空' }, { status: 400 });
    }

    if (action === 'reset') {
      await resetRolePermissions(role);

      // Audit
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
      await recordAuditLog({
        userId: operator.id, username: operator.username,
        action: 'permission.reset', category: 'permission', level: 'basic',
        target: `角色 ${role}`,
        detail: { role },
        ipAddress: ip,
      });

      return NextResponse.json({ success: true });
    }

    if (!permissions || typeof permissions !== 'object') {
      return NextResponse.json({ error: 'permissions 参数无效' }, { status: 400 });
    }

    await updateRolePermissions(role, permissions);

    // Audit
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    await recordAuditLog({
      userId: operator.id, username: operator.username,
      action: 'permission.update', category: 'permission', level: 'basic',
      target: `角色 ${role}`,
      detail: { role, permissions },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
