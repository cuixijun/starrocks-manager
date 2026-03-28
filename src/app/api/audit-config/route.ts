import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';
import { getAuditLevel, setAuditLevel, recordAuditLog } from '@/lib/local-db';
import type { AuditLevel } from '@/lib/local-db';

const LEVEL_OPTIONS: { value: AuditLevel; label: string; desc: string }[] = [
  { value: 'off', label: '关闭', desc: '不记录任何审计日志' },
  { value: 'basic', label: '基础', desc: '仅记录关键变更操作' },
  { value: 'standard', label: '标准', desc: '变更 + 登录/登出 + 配置' },
  { value: 'full', label: '完整', desc: '记录所有操作（含读取）' },
];

const VALID_LEVELS = new Set<string>(['off', 'basic', 'standard', 'full']);

// GET /api/audit-config — get current audit config (all authenticated users)
export async function GET(request: NextRequest) {
  try {
    requireAuth(request);

    const level = getAuditLevel();
    return NextResponse.json({ level, levelOptions: LEVEL_OPTIONS });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

// PUT /api/audit-config — update audit level (admin only)
export async function PUT(request: NextRequest) {
  try {
    const { user } = requireRole(request, 'admin');
    const { level } = await request.json();

    if (!level || !VALID_LEVELS.has(level)) {
      return NextResponse.json({ error: '无效的审计级别' }, { status: 400 });
    }

    const oldLevel = getAuditLevel();
    setAuditLevel(level as AuditLevel);

    // Get client IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || '';

    // Record audit log for this config change (always, regardless of level)
    recordAuditLog({
      userId: user.id,
      username: user.username,
      action: 'config.audit_level_change',
      category: 'config',
      level: 'basic',
      target: '审计级别',
      detail: { oldLevel, newLevel: level },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, level });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
