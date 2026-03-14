'use client';

import { useTheme, Theme } from './ThemeProvider';
import { Sun, Moon, Monitor } from 'lucide-react';

const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
  { value: 'light', icon: <Sun />, label: '亮色' },
  { value: 'dark', icon: <Moon />, label: '暗色' },
  { value: 'system', icon: <Monitor />, label: '跟随系统' },
];

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switcher">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`theme-option ${theme === opt.value ? 'active' : ''}`}
          onClick={() => setTheme(opt.value)}
          title={opt.label}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
