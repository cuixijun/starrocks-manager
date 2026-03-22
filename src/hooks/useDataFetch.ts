'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/hooks/useSession';

interface UseDataFetchOptions<T> {
  /** API URL builder (receives sessionId, isRefresh) */
  url: (sessionId: string, isRefresh?: boolean) => string;
  /** Extract data from JSON response */
  extract: (json: Record<string, unknown>) => T;
  /** Auto-fetch on mount? (default true) */
  autoFetch?: boolean;
}

interface UseDataFetchResult<T> {
  data: T;
  loading: boolean;
  refreshing: boolean;
  error: string;
  success: string;
  cachedAt: string;
  fromCache: boolean;
  setError: (e: string) => void;
  setSuccess: (s: string) => void;
  refresh: (force?: boolean) => Promise<void>;
}

export function useDataFetch<T>(opts: UseDataFetchOptions<T>, initialData: T): UseDataFetchResult<T> {
  const { session } = useSession();
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cachedAt, setCachedAt] = useState('');
  const [fromCache, setFromCache] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const initialDataRef = useRef(initialData);

  const refresh = useCallback(async (force = false) => {
    if (!session) return;
    if (force) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await fetch(optsRef.current.url(session.sessionId, force));
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setData(optsRef.current.extract(json));
        if (json.cachedAt) setCachedAt(json.cachedAt);
        setFromCache(!!json.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => {
    if (session && (optsRef.current.autoFetch !== false)) refresh();
  }, [session, refresh]);

  // Listen for cluster-switched event: immediately clear stale data
  useEffect(() => {
    const handleSwitch = () => {
      setData(initialDataRef.current);
      setError('');
      setCachedAt('');
      setFromCache(false);
      setLoading(true);
    };
    window.addEventListener('cluster-switched', handleSwitch);
    return () => window.removeEventListener('cluster-switched', handleSwitch);
  }, []);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  return { data, loading, refreshing, error, success, cachedAt, fromCache, setError, setSuccess, refresh };
}

