'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  resolvedTheme: 'dark',
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  const updateResolvedTheme = useCallback((t: Theme) => {
    const resolved = t === 'system' ? getSystemTheme() : t;
    setResolvedTheme(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('sr-theme', newTheme);
    updateResolvedTheme(newTheme);

    // Also persist to server
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'theme', value: newTheme }),
    }).catch(() => {}); // fire-and-forget
  }, [updateResolvedTheme]);

  useEffect(() => {
    // Load theme from localStorage first for fast render, then sync from server
    const stored = localStorage.getItem('sr-theme') as Theme | null;
    if (stored) {
      setThemeState(stored);
      updateResolvedTheme(stored);
    } else {
      updateResolvedTheme('system');
    }

    // listen for system theme changes
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const current = localStorage.getItem('sr-theme') as Theme | null;
      if (!current || current === 'system') {
        updateResolvedTheme('system');
      }
    };
    mql.addEventListener('change', handler);

    return () => mql.removeEventListener('change', handler);
  }, [updateResolvedTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
