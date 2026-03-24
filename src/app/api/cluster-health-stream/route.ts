import { NextRequest } from 'next/server';
import { getLocalDb } from '@/lib/local-db';
import { clearConnectionFailure, getPool } from '@/lib/db';
import { validateSession, getAuthFromRequest } from '@/lib/auth';
import mysql from 'mysql2/promise';

export const dynamic = 'force-dynamic';

interface ClusterRow {
  id: number;
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * SSE endpoint that streams cluster health status updates.
 * - Checks all clusters every 20 seconds
 * - Reuses existing connection pools where available
 * - Falls back to lightweight direct connection for unconnected clusters
 * - Authenticated: requires valid session cookie
 */
export async function GET(request: NextRequest) {
  // Verify auth
  const token = getAuthFromRequest(request);
  if (!token || !validateSession(token)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const lastStatus: Record<number, string> = {};

      const sendEvent = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      const checkAllClusters = async () => {
        if (closed) return;
        try {
          const db = getLocalDb();
          const clusters = db.prepare(
            'SELECT id, host, port, username, password FROM clusters'
          ).all() as ClusterRow[];

          const results: Record<number, { status: string; version?: string; checkedAt: string }> = {};
          let hasChanges = false;

          await Promise.allSettled(
            clusters.map(async (c) => {
              const sessionId = `${c.host}:${c.port}`;
              let status = 'offline';
              let version: string | undefined;

              // Strategy: try pool first (zero-cost), fall back to direct connection
              const pool = getPool(sessionId);
              if (pool) {
                // ── Pool available: reuse existing connection with timeout ──
                try {
                  const queryPromise = pool.query('SELECT version() as v');
                  const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 2000)
                  );
                  const [rows] = await Promise.race([queryPromise, timeoutPromise]) as [Array<{ v: string }>];
                  const row = rows[0];
                  version = row?.v;
                  status = 'online';
                  clearConnectionFailure(sessionId);
                } catch { /* pool query failed or timed out — cluster offline */ }
              } else {
                // ── No pool: lightweight direct connection with short timeout ──
                let conn;
                try {
                  conn = await mysql.createConnection({
                    host: c.host,
                    port: c.port,
                    user: c.username,
                    password: c.password,
                    connectTimeout: 1500, // 1.5s for fast failure
                  });
                  const [rows] = await conn.query('SELECT version() as v');
                  const row = (rows as Array<{ v: string }>)[0];
                  version = row?.v;
                  status = 'online';
                  clearConnectionFailure(sessionId);
                } catch { /* offline */ }
                finally {
                  if (conn) try { await conn.end(); } catch { /* ignore */ }
                }
              }

              results[c.id] = {
                status,
                version,
                checkedAt: new Date().toISOString(),
              };

              if (lastStatus[c.id] !== status) {
                hasChanges = true;
                lastStatus[c.id] = status;
              }
            })
          );

          // Always send results (either health-update on change, or heartbeat)
          sendEvent({
            type: hasChanges ? 'health-update' : 'heartbeat',
            clusters: results,
          });
        } catch {
          // DB error, skip this cycle
        }
      };

      // Initial check immediately
      await checkAllClusters();

      // Then check every 20 seconds
      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return; }
        checkAllClusters();
      }, 20_000);

      // Cleanup when client disconnects
      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
