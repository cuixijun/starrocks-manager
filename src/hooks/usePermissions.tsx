'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './useAuth';
import { apiFetch } from '@/lib/fetch-patch';

interface PermissionsState {
  permissions: string[];
  loading: boolean;
  hasPermission: (permission: string) => boolean;
  refreshPermissions: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsState | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setPermissions([]);
      setLoading(false);
      return;
    }

    // Admin always has all permissions — no need to fetch
    if (user.role === 'admin') {
      setPermissions(['__all__']);
      setLoading(false);
      return;
    }

    try {
      const res = await apiFetch(`/api/sys-permissions?role=${encodeURIComponent(user.role)}`);
      const data = await res.json();
      if (data.permissions) {
        setPermissions(data.permissions);
      }
    } catch {
      // On error, fallback to empty (most restrictive)
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  // Listen for permission changes (e.g., after admin updates permissions)
  useEffect(() => {
    const handler = () => fetchPermissions();
    window.addEventListener('permissions-changed', handler);
    return () => window.removeEventListener('permissions-changed', handler);
  }, [fetchPermissions]);

  const hasPermission = useCallback((permission: string): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return permissions.includes(permission);
  }, [user, permissions]);

  return (
    <PermissionsContext.Provider value={{ permissions, loading, hasPermission, refreshPermissions: fetchPermissions }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsState {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}
