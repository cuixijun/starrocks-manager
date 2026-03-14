'use client';

import { useState, useEffect, useCallback } from 'react';

export interface SessionInfo {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  version?: string;
}

export function useSession() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem('sr-session');
    if (stored) {
      try {
        setSession(JSON.parse(stored));
      } catch {
        sessionStorage.removeItem('sr-session');
      }
    }
    setLoading(false);
  }, []);

  const disconnect = useCallback(async () => {
    if (session) {
      try {
        await fetch('/api/connect', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId }),
        });
      } catch { /* ignore */ }
    }
    sessionStorage.removeItem('sr-session');
    setSession(null);
    window.location.href = '/';
  }, [session]);

  return { session, loading, disconnect };
}
