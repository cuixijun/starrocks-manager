'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export type SysRole = 'admin' | 'editor' | 'viewer';
export type ClusterStatus = 'online' | 'offline' | 'unknown';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: SysRole;
}

export interface ClusterBrief {
  id: number;
  name: string;
  host: string;
  port: number;
  description?: string;
}

interface AuthState {
  user: AuthUser | null;
  clusters: ClusterBrief[];
  activeCluster: ClusterBrief | null;
  clusterStatus: ClusterStatus;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchCluster: (clusterId: number) => Promise<void>;
  refreshAuth: () => Promise<void>;
  setClusterStatus: (status: ClusterStatus) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [clusters, setClusters] = useState<ClusterBrief[]>([]);
  const [activeCluster, setActiveCluster] = useState<ClusterBrief | null>(null);
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus>('unknown');
  const [loading, setLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth');
      const data = await res.json();
      if (data.authenticated) {
        setUser(data.user);
        setClusters(data.clusters || []);
        const cluster = data.activeCluster || null;
        setActiveCluster(cluster);

        // Immediately check cluster health BEFORE allowing pages to render.
        // This prevents the "loading → offline" flash: pages will see the
        // correct status from the very first render.
        if (cluster) {
          try {
            const sid = `${cluster.host}:${cluster.port}`;
            const hRes = await fetch(`/api/health?sessionId=${encodeURIComponent(sid)}`);
            const hData = await hRes.json();
            setClusterStatus(hData.ok ? 'online' : 'offline');
          } catch {
            setClusterStatus('offline');
          }
        }
      } else {
        setUser(null);
        setClusters([]);
        setActiveCluster(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setClusters(data.clusters || []);
        const active = data.activeClusterId
          ? (data.clusters || []).find((c: ClusterBrief) => c.id === data.activeClusterId) || null
          : null;
        setActiveCluster(active);
        return { success: true };
      }
      return { success: false, error: data.error || '登录失败' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch { /* ignore */ }
    setUser(null);
    setClusters([]);
    setActiveCluster(null);
    window.location.href = '/';
  }, []);

  const switchCluster = useCallback(async (clusterId: number) => {
    // 1. Immediately clear status → pages will show loading/transition
    setClusterStatus('unknown');

    try {
      const res = await fetch(`/api/clusters/${clusterId}/activate`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const cluster = clusters.find(c => c.id === clusterId) || null;
        setActiveCluster(cluster);

        // 2. Dispatch cluster-switched so pages clear their stale data
        window.dispatchEvent(new CustomEvent('cluster-switched'));

        // 3. Quick health check to determine online/offline
        if (cluster) {
          try {
            const sid = `${cluster.host}:${cluster.port}`;
            const hRes = await fetch(`/api/health?sessionId=${encodeURIComponent(sid)}`);
            const hData = await hRes.json();
            setClusterStatus(hData.ok ? 'online' : 'offline');
          } catch {
            setClusterStatus('offline');
          }
        }

        // Re-dispatch after status is known so pages can fetch fresh data
        window.dispatchEvent(new CustomEvent('cluster-switched'));
      } else {
        setClusterStatus('offline');
      }
    } catch {
      setClusterStatus('offline');
    }
  }, [clusters]);

  // ========== Real-time health via SSE ==========
  // Connect to /api/cluster-health-stream for live updates.
  // Updates clusterStatus when active cluster state changes.
  // Dispatches 'cluster-health-update' CustomEvent for cluster-manager page.
  useEffect(() => {
    if (!user) return; // Not logged in — no stream
    // Only connect when tab is visible
    if (typeof document !== 'undefined' && document.hidden) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      eventSource = new EventSource('/api/cluster-health-stream');

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const clustersHealth = data.clusters as Record<string, { status: string; version?: string; checkedAt: string }>;

          // Dispatch event for cluster-manager page
          window.dispatchEvent(new CustomEvent('cluster-health-update', { detail: clustersHealth }));

          // Update active cluster status
          if (activeCluster && clustersHealth[activeCluster.id]) {
            const newStatus = clustersHealth[activeCluster.id].status as ClusterStatus;
            // Only react to actual changes
            if (newStatus === 'online' && clusterStatus !== 'online') {
              setClusterStatus('online');
              window.dispatchEvent(new CustomEvent('cluster-switched'));
            } else if (newStatus === 'offline' && clusterStatus !== 'offline') {
              setClusterStatus('offline');
            }
          }
        } catch { /* malformed event, skip */ }
      };

      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        // Reconnect after 10s
        reconnectTimer = setTimeout(connect, 10_000);
      };
    };

    connect();

    // Pause/resume on tab visibility
    const handleVisibility = () => {
      if (document.hidden) {
        eventSource?.close();
        eventSource = null;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      } else {
        if (!eventSource) connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      eventSource?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, activeCluster, clusterStatus]);

  return (
    <AuthContext.Provider value={{ user, clusters, activeCluster, clusterStatus, loading, login, logout, switchCluster, refreshAuth, setClusterStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
