import { NextRequest, NextResponse } from 'next/server';
import { getLocalDb, recordAuditLog } from '@/lib/local-db';
import { requireAuth, requireRole, AuthError, getUserClusters } from '@/lib/auth';
import { testConnection } from '@/lib/db';
import type { ClusterInfo } from '@/lib/auth';

// GET /api/clusters — list clusters (filtered by user access)
export async function GET(request: NextRequest) {
  try {
    const { user } = requireAuth(request);
    const clusters = getUserClusters(user.id, user.role);

    // For admin, also include user access counts
    if (user.role === 'admin') {
      const db = getLocalDb();
      const enriched = clusters.map(c => {
        const accessCount = db.prepare(
          'SELECT COUNT(*) as cnt FROM user_cluster_access WHERE cluster_id = ?'
        ).get(c.id) as { cnt: number };
        return { ...c, password: '******', userCount: accessCount.cnt };
      });
      return NextResponse.json({ clusters: enriched });
    }

    return NextResponse.json({
      clusters: clusters.map(c => ({
        id: c.id, name: c.name, host: c.host, port: c.port,
        description: c.description, default_db: c.default_db,
      })),
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

// POST /api/clusters — create cluster (admin only)
export async function POST(request: NextRequest) {
  try {
    const { user: operator } = requireRole(request, 'admin');
    const body = await request.json();
    const { action, name, host, port, username, password, default_db, description } = body;

    // Test connection action
    if (action === 'test') {
      const result = await testConnection({
        host: body.host, port: body.port || 9030,
        user: body.username, password: body.password || '',
      });
      return NextResponse.json(result);
    }

    if (!name || !host || !username) {
      return NextResponse.json({ error: '请填写集群名称、主机地址和用户名' }, { status: 400 });
    }

    const db = getLocalDb();

    // Check duplicate name
    const existing = db.prepare('SELECT id FROM clusters WHERE name = ?').get(name);
    if (existing) {
      return NextResponse.json({ error: `集群 "${name}" 已存在` }, { status: 409 });
    }

    const result = db.prepare(
      'INSERT INTO clusters (name, host, port, username, password, default_db, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name, host, port || 9030, username, password || '', default_db || '', description || '');

    // Audit: cluster.create
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    recordAuditLog({
      userId: operator.id, username: operator.username,
      action: 'cluster.create', category: 'cluster', level: 'basic',
      target: `集群 ${name}`,
      detail: { clusterId: result.lastInsertRowid, host, port: port || 9030 },
      ipAddress: ip,
    });

    return NextResponse.json({
      success: true,
      cluster: { id: result.lastInsertRowid, name, host, port: port || 9030 },
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

// PUT /api/clusters — update cluster (admin only)
export async function PUT(request: NextRequest) {
  try {
    const { user: operator } = requireRole(request, 'admin');
    const { id, name, host, port, username, password, default_db, description, is_active } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Cluster ID required' }, { status: 400 });
    }

    const db = getLocalDb();
    const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id) as ClusterInfo | undefined;
    if (!cluster) {
      return NextResponse.json({ error: '集群不存在' }, { status: 404 });
    }

    db.prepare(`
      UPDATE clusters SET
        name = ?, host = ?, port = ?, username = ?,
        password = ?, default_db = ?, description = ?,
        is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ?? cluster.name,
      host ?? cluster.host,
      port ?? cluster.port,
      username ?? cluster.username,
      password !== undefined ? password : cluster.password,
      default_db ?? cluster.default_db,
      description ?? cluster.description,
      is_active !== undefined ? is_active : cluster.is_active,
      id,
    );

    // Audit: cluster.update
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    recordAuditLog({
      userId: operator.id, username: operator.username,
      action: 'cluster.update', category: 'cluster', level: 'basic',
      target: `集群 ${cluster.name}`,
      detail: { clusterId: id, changes: { name, host, port, is_active } },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

// DELETE /api/clusters — delete cluster (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const { user: operator } = requireRole(request, 'admin');
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Cluster ID required' }, { status: 400 });
    }

    const db = getLocalDb();
    const cluster = db.prepare('SELECT name FROM clusters WHERE id = ?').get(id) as { name: string } | undefined;
    db.prepare('DELETE FROM clusters WHERE id = ?').run(id);

    // Audit: cluster.delete
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    recordAuditLog({
      userId: operator.id, username: operator.username,
      action: 'cluster.delete', category: 'cluster', level: 'basic',
      target: `集群 ${cluster?.name || id}`,
      ipAddress: ip,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
