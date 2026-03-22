'use client';

import { useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

// Bridge interface — same shape as the old useSession for backward compatibility
export interface SessionInfo {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  version?: string;
}

/**
 * Bridge hook: derives SessionInfo from the new useAuth context.
 * Existing pages use `session.sessionId` to call APIs.
 * The sessionId is now constructed as `host:port` from the active cluster.
 *
 * IMPORTANT: When clusterStatus === 'offline', session is returned as null.
 * This prevents all pages from making API calls when the cluster is unreachable,
 * since every page checks `if (session)` before fetching data.
 */
export function useSession() {
  const { user, activeCluster, loading, logout, clusterStatus, setClusterStatus } = useAuth();
  const [retrying, setRetrying] = useState(false);

  // When cluster is offline or in transition (unknown), return null session to gate all API calls.
  const clusterUnavailable = clusterStatus === 'offline' || clusterStatus === 'unknown';

  const session: SessionInfo | null = useMemo(() => {
    if (!user || !activeCluster) return null;
    // Gate: if cluster is unavailable, suppress session so pages skip API calls
    if (clusterUnavailable) return null;
    return {
      sessionId: `${activeCluster.host}:${activeCluster.port}`,
      host: activeCluster.host,
      port: activeCluster.port,
      username: user.username,
      version: undefined,
    };
  }, [user?.username, activeCluster?.host, activeCluster?.port, clusterUnavailable]);

  // Build a sessionId even when offline (for health-check API calls)
  const sessionIdForHealth = useMemo(() => {
    if (!activeCluster) return null;
    return `${activeCluster.host}:${activeCluster.port}`;
  }, [activeCluster?.host, activeCluster?.port]);

  // Manual retry: ping /api/health and restore session if OK
  const retryConnection = useCallback(async () => {
    if (!sessionIdForHealth) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/health?sessionId=${encodeURIComponent(sessionIdForHealth)}`);
      const data = await res.json();
      if (data.ok) {
        setClusterStatus('online');
      }
    } catch { /* still offline */ }
    finally { setRetrying(false); }
  }, [sessionIdForHealth, setClusterStatus]);

  return {
    session,
    loading,
    disconnect: logout,
    clusterOffline: clusterUnavailable,
    retrying,
    retryConnection,
  };
}
