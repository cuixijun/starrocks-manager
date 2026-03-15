'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/hooks/useSession';

interface UseDataFetchOptions<T> {
  /** API URL builder (receives sessionId) */
  url: (sessionId: string) => string;
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
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const refresh = useCallback(async (force = false) => {
    if (!session) return;
    if (force) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await fetch(optsRef.current.url(session.sessionId));
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(optsRef.current.extract(json));
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => {
    if (session && (optsRef.current.autoFetch !== false)) refresh();
  }, [session, refresh]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  return { data, loading, refreshing, error, success, setError, setSuccess, refresh };
}
