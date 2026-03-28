import { NextRequest, NextResponse } from 'next/server';
import { validateSession, getAuthFromRequest } from '@/lib/auth';
import { getHealthCache, getLastCheckTime } from '@/lib/health-monitor';

export const dynamic = 'force-dynamic';

/**
 * Returns cached cluster health status from the singleton HealthMonitor.
 * No direct DB queries — just reads the shared in-memory cache.
 * Authenticated: requires valid session cookie.
 */
export async function GET(request: NextRequest) {
  // Verify auth
  const token = getAuthFromRequest(request);
  if (!token || !await validateSession(token)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cache = getHealthCache();
  const lastCheck = getLastCheckTime();

  return NextResponse.json({
    clusters: cache,
    lastCheckTime: lastCheck ? new Date(lastCheck).toISOString() : null,
  });
}
