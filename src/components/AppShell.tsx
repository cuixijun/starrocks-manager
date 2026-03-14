'use client';

import React, { useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { useSession } from '@/hooks/useSession';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && !session) {
      window.location.href = '/';
    }
  }, [loading, session]);

  if (loading) {
    return (
      <div className="loading-overlay" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
