import { NextRequest } from 'next/server';
import { getLocalDb } from '@/lib/local-db';
import { clearConnectionFailure } from '@/lib/db';
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
 * - Only emits when status changes to avoid noise
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
      // Track last known status per cluster to detect changes
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

              let conn;
              try {
                conn = await mysql.createConnection({
                  host: c.host,
                  port: c.port,
                  user: c.username,
                  password: c.password,
                  connectTimeout: 3000,
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

              results[c.id] = {
                status,
                version,
                checkedAt: new Date().toISOString(),
              };

              // Detect change
              if (lastStatus[c.id] !== status) {
                hasChanges = true;
                lastStatus[c.id] = status;
              }
            })
          );

          // Always send on first check, then only on changes
          const isFirst = Object.keys(lastStatus).length === clusters.length
            && Object.values(lastStatus).some((_, i) => i === 0);

          if (hasChanges || !Object.keys(lastStatus).length) {
            sendEvent({ type: 'health-update', clusters: results });
          } else {
            // Send heartbeat with current status to keep connection alive
            sendEvent({ type: 'heartbeat', clusters: results });
          }
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
