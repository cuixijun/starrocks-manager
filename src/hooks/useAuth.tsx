'use client';

import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/fetch-patch';

export type SysRole = 'admin' | 'editor' | 'viewer';
export type ClusterStatus = 'online' | 'offline' | 'unknown' | 'switching';

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
  login: (username: string, password: string, captchaToken?: string, captchaAnswer?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchCluster: (clusterId: number) => Promise<void>;
  refreshAuth: () => Promise<void>;
  setClusterStatus: (status: ClusterStatus) => void;
}

const AuthContext = createContext<AuthState | null>(null);

// Module-level cache for latest SSE health data, so cluster-manager can read instantly on mount
let _latestHealthCache: Record<string, { status: string; version?: string; checkedAt: string }> = {};
export function getLatestHealthCache() { return _latestHealthCache; }

// Module-level flag for cluster switching — immediately visible to SSE handler
// without waiting for React render (fixes race where SSE overrides 'switching' with 'offline')
let _isSwitchingCluster = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [clusters, setClusters] = useState<ClusterBrief[]>([]);
  const [activeCluster, setActiveCluster] = useState<ClusterBrief | null>(null);
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus>('unknown');
  const [loading, setLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth');
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
            const hRes = await apiFetch(`/api/health?sessionId=${encodeURIComponent(sid)}`);
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

  const login = useCallback(async (username: string, password: string, captchaToken?: string, captchaAnswer?: string) => {
    try {
      const res = await apiFetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password, captchaToken, captchaAnswer }),
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
      await apiFetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch { /* ignore */ }
    setUser(null);
    setClusters([]);
    setActiveCluster(null);
    window.location.href = '/starrocks-manager/';
  }, []);

  const switchCluster = useCallback(async (clusterId: number) => {
    // 1. Mark as switching — module-level flag is immediately visible to SSE
    _isSwitchingCluster = true;
    setClusterStatus('switching');

    try {
      const res = await apiFetch(`/api/clusters/${clusterId}/activate`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const cluster = clusters.find(c => c.id === clusterId) || null;
        setActiveCluster(cluster);

        // 2. Quick health check to determine online/offline
        if (cluster) {
          try {
            const sid = `${cluster.host}:${cluster.port}`;
            const hRes = await apiFetch(`/api/health?sessionId=${encodeURIComponent(sid)}`);
            const hData = await hRes.json();
            setClusterStatus(hData.ok ? 'online' : 'offline');
          } catch {
            setClusterStatus('offline');
          }
        }

        // 3. Clear flag and dispatch after status is known
        _isSwitchingCluster = false;
        window.dispatchEvent(new CustomEvent('cluster-switched'));
      } else {
        _isSwitchingCluster = false;
        setClusterStatus('offline');
      }
    } catch {
      _isSwitchingCluster = false;
      setClusterStatus('offline');
    }
  }, [clusters]);

  // ========== Periodic health polling ==========
  // Polls /api/cluster-health-stream (now returns cached data from singleton HealthMonitor).
  // Uses refs for clusterStatus/activeCluster to avoid re-registering on status changes.
  const clusterStatusRef = useRef(clusterStatus);
  clusterStatusRef.current = clusterStatus;
  const activeClusterRef = useRef(activeCluster);
  activeClusterRef.current = activeCluster;

  useEffect(() => {
    if (!user) return; // Not logged in — no polling

    const pollHealth = async () => {
      try {
        const res = await apiFetch('/api/cluster-health-stream');
        if (!res.ok) return;
        const data = await res.json();
        const clustersHealth = data.clusters as Record<string, { status: string; version?: string; checkedAt: string }>;

        // Cache globally for instant access by cluster-manager page
        _latestHealthCache = clustersHealth;

        // Dispatch event for cluster-manager page
        window.dispatchEvent(new CustomEvent('cluster-health-update', { detail: clustersHealth }));

        // Update active cluster status
        if (_isSwitchingCluster) return;
        const ac = activeClusterRef.current;
        const cs = clusterStatusRef.current;
        if (ac && clustersHealth[ac.id]) {
          const newStatus = clustersHealth[ac.id].status as ClusterStatus;
          if (newStatus === 'online' && cs !== 'online') {
            setClusterStatus('online');
            window.dispatchEvent(new CustomEvent('cluster-switched'));
          } else if (newStatus === 'offline' && cs !== 'offline') {
            setClusterStatus('offline');
          }
        }
      } catch { /* network error, skip */ }
    };

    // Initial poll immediately
    pollHealth();

    // Then every 5 minutes
    const interval = setInterval(pollHealth, 300_000);

    return () => {
      clearInterval(interval);
    };
  }, [user]); // Only restart when user changes (login/logout)

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
