import { NextRequest, NextResponse } from 'next/server';
import { clearConnectionFailure, getPool, createPool } from '@/lib/db';
import mysql from 'mysql2/promise';

/**
 * Lightweight health-check endpoint.
 * Strategy: try existing pool first (zero-cost), fall back to direct connection.
 * On success, clears the failure cache so other queries can proceed.
 * On failure, returns 503 without polluting logs.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'Session ID required' }, { status: 400 });
  }

  // Parse host:port from sessionId
  const [host, portStr] = sessionId.split(':');
  if (!host || !portStr) {
    return NextResponse.json({ ok: false, error: 'Invalid sessionId' }, { status: 400 });
  }

  // Strategy 1: Try existing pool (zero-cost, no new connection)
  const pool = getPool(sessionId);
  if (pool) {
    try {
      await pool.query('SELECT 1');
      clearConnectionFailure(sessionId);
      return NextResponse.json({ ok: true });
    } catch {
      // Pool query failed — fall through to direct connection
    }
  }

  // Strategy 2: Direct connection (for unconnected clusters or failed pools)
  let username = 'root';
  let password = '';
  let defaultDb: string | undefined;
  try {
    const { getLocalDb } = require('@/lib/local-db');
    const db = await getLocalDb();
    const cluster = db.prepare(
      'SELECT username, password, default_db FROM clusters WHERE host = ? AND port = ? AND is_active = 1'
    ).get(host, parseInt(portStr, 10)) as { username: string; password: string; default_db?: string } | undefined;
    if (cluster) {
      username = cluster.username;
      password = cluster.password;
      defaultDb = cluster.default_db || undefined;
    }
  } catch { /* use defaults */ }

  let connection;
  try {
    connection = await mysql.createConnection({
      host,
      port: parseInt(portStr, 10),
      user: username,
      password,
      connectTimeout: 3000,
    });
    await connection.query('SELECT 1');
    clearConnectionFailure(sessionId);

    // Ensure a pool exists for this cluster so subsequent API calls work.
    // This is critical during cluster switching — the fire-and-forget createPool
    // in the activate API may not have completed yet.
    if (!getPool(sessionId)) {
      createPool({
        host,
        port: parseInt(portStr, 10),
        user: username,
        password,
        database: defaultDb,
      }).catch(() => { /* pool creation failed, will retry on next health check */ });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  } finally {
    if (connection) {
      try { await connection.end(); } catch { /* ignore */ }
    }
  }
}
