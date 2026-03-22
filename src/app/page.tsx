'use client';

import React, { useState, useEffect } from 'react';
import { LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, user } = useAuth();
  const router = useRouter();

  // Already logged in? Redirect via effect (not during render)
  useEffect(() => {
    if (user) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  if (user) return null;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    const result = await login(username, password);
    if (result.success) {
      router.replace('/dashboard');
    } else {
      setError(result.error || '登录失败');
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">SR</div>
          <div className="login-logo-text">StarRocks Manager</div>
          <div className="login-logo-subtext">数据库管理平台</div>
          <ThemeSwitcher />
        </div>

        <form className="login-form" onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">用户名</label>
            <input
              className="input"
              placeholder="请输入用户名"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">密码</label>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: '36px' }}
              />
              <button
                className="btn-ghost btn-icon"
                style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)' }}
                onClick={() => setShowPassword(!showPassword)}
                type="button"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              color: 'var(--danger-500)', fontSize: '0.82rem', padding: '10px 14px',
              background: 'rgba(239, 68, 68, 0.08)', borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
            }}>
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <div className="login-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={loading || !username || !password}
              style={{ width: '100%', justifyContent: 'center', padding: '10px 0' }}
            >
              {loading ? <span className="spinner" /> : <><LogIn size={16} /> 登录</>}
            </button>
          </div>
        </form>

        <div style={{
          marginTop: '16px', textAlign: 'center',
          fontSize: '0.75rem', color: 'var(--text-tertiary)',
          padding: '12px 16px',
          borderTop: '1px solid var(--border-secondary)',
        }}>
          首次使用？默认账号 <strong style={{ color: 'var(--text-secondary)' }}>admin</strong> / <strong style={{ color: 'var(--text-secondary)' }}>admin123</strong>
        </div>

        <div className="login-footer">
          StarRocks Manager — 数据库管理平台
        </div>
      </div>
    </div>
  );
}
