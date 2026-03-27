'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogIn, Eye, EyeOff, AlertCircle, Terminal, Database, Cpu, Activity, RefreshCw, ShieldCheck, Shield } from 'lucide-react';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/fetch-patch';

// Get current theme from html attribute
function getCurrentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// Animated matrix-rain background (theme-aware)
function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const chars = 'SELECTINSERTGRANTCREATEDROPALTERTABLEFROMWHERE01アイウエオカキクケコ⊕⊗⊘∴∵∶';
    const fontSize = 13;
    const columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(columns).fill(0).map(() => Math.random() * -100);
    function draw() {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      ctx!.fillStyle = isLight ? 'rgba(241, 245, 249, 0.07)' : 'rgba(10, 12, 20, 0.06)';
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      ctx!.font = `${fontSize}px 'JetBrains Mono', monospace`;
      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const brightness = Math.random();
        if (isLight) {
          ctx!.fillStyle = brightness > 0.95 ? 'rgba(37, 99, 235, 0.25)' : brightness > 0.8 ? 'rgba(59, 130, 246, 0.12)' : `rgba(37, 99, 235, ${0.02 + Math.random() * 0.04})`;
        } else {
          ctx!.fillStyle = brightness > 0.95 ? 'rgba(96, 165, 250, 0.9)' : brightness > 0.8 ? 'rgba(59, 130, 246, 0.5)' : `rgba(37, 99, 235, ${0.08 + Math.random() * 0.12})`;
        }
        ctx!.fillText(char, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas!.height && Math.random() > 0.985) drops[i] = 0;
        drops[i] += 0.4 + Math.random() * 0.3;
      }
      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={canvasRef} className="login-matrix" />;
}

// Typing effect for terminal status lines
function TerminalLine({ text, delay }: { text: string; delay: number }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    let i = 0;
    const timer = setTimeout(() => {
      const interval = setInterval(() => {
        if (i < text.length) { setDisplayed(text.slice(0, i + 1)); i++; }
        else { clearInterval(interval); setDone(true); }
      }, 20 + Math.random() * 15);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timer);
  }, [text, delay]);
  return (
    <div className="login-terminal-line">
      <span className="login-terminal-prompt">$</span>
      <span className="login-terminal-text">{displayed}</span>
      {!done && <span className="login-terminal-cursor">█</span>}
      {done && <span className="login-terminal-ok">✓</span>}
    </div>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  const { login, user } = useAuth();
  const router = useRouter();

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaAnswer('');
    try {
      const theme = getCurrentTheme();
      const res = await apiFetch(`/api/captcha?theme=${theme}`);
      const data = await res.json();
      setCaptchaToken(data.token);
      setCaptchaImage(data.image);
    } catch { /* ignore */ }
    finally { setCaptchaLoading(false); }
  }, []);

  useEffect(() => {
    if (user) router.replace('/dashboard');
    else loadCaptcha();
  }, [user, router, loadCaptcha]);

  // Reload captcha when theme changes
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          loadCaptcha();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, [loadCaptcha]);

  if (user) return null;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) { setError('请输入用户名和密码'); return; }
    if (!captchaAnswer) { setError('请输入验证码'); return; }
    setLoading(true);
    setError('');
    const result = await login(username, password, captchaToken, captchaAnswer);
    if (result.success) {
      router.replace('/dashboard');
    } else {
      setError(result.error || '登录失败');
      setLoading(false);
      loadCaptcha(); // Refresh captcha on failure
    }
  }

  return (
    <div className="login-container">
      <MatrixRain />
      <div className="login-scene">
        {/* Left: branding + terminal */}
        <div className="login-hero">
          <div className="login-hero-badge">
            <Database size={18} />
            <span>STARROCKS</span>
          </div>
          <h1 className="login-hero-title">
            StarRocks<br />Manager
          </h1>
          <p className="login-hero-desc">
            高性能 OLAP 数据库管理平台<br />
            实时监控 · 权限管控 · 集群运维
          </p>

          <div className="login-terminal">
            <div className="login-terminal-header">
              <div className="login-terminal-dots">
                <span style={{ background: '#ef4444' }} />
                <span style={{ background: '#eab308' }} />
                <span style={{ background: '#22c55e' }} />
              </div>
              <span className="login-terminal-title"><Terminal size={11} /> sr-manager</span>
            </div>
            <div className="login-terminal-body">
              <TerminalLine text="connecting to cluster..." delay={300} />
              <TerminalLine text="loading fe/be/cn nodes..." delay={1200} />
              <TerminalLine text="RBAC engine initialized" delay={2200} />
              <TerminalLine text="system ready — awaiting auth" delay={3200} />
            </div>
          </div>

          <div className="login-hero-stats">
            <div className="login-hero-stat">
              <Cpu size={14} />
              <div><div className="login-stat-value">FE / BE / CN</div><div className="login-stat-label">节点管理</div></div>
            </div>
            <div className="login-hero-stat">
              <Activity size={14} />
              <div><div className="login-stat-value">REAL-TIME</div><div className="login-stat-label">实时监控</div></div>
            </div>
          </div>
        </div>

        {/* Right: login form */}
        <div className="login-card">
          <div className="login-card-inner">
            <div className="login-card-header">
              <div className="login-logo-icon">SR</div>
              <div>
                <div className="login-logo-text">安全登录</div>
                <div className="login-logo-subtext">连接到 StarRocks 集群</div>
              </div>
              <div style={{ marginLeft: 'auto' }}><ThemeSwitcher /></div>
            </div>

            <form className="login-form" onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.76rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  用户名
                </label>
                <input
                  className="input login-input"
                  placeholder="请输入用户名"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  aria-label="用户名"
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.76rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  密码
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input login-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="请输入登录密码"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    style={{ paddingRight: '40px' }}
                    aria-label="密码"
                  />
                  <button
                    className="btn-ghost btn-icon"
                    style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)' }}
                    onClick={() => setShowPassword(!showPassword)}
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Captcha */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.76rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ShieldCheck size={12} />
                  安全验证
                </label>
                <div className="login-captcha-row">
                  <div className="login-captcha-image" onClick={loadCaptcha} title="点击刷新验证码" aria-label="验证码图片，点击刷新">
                    {captchaImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={captchaImage} alt="captcha" draggable={false} />
                    ) : (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>加载中...</span>
                    )}
                    {captchaLoading && <div className="login-captcha-loading"><RefreshCw size={14} className="spin" /></div>}
                  </div>
                  <input
                    className="input login-input"
                    placeholder="验证码"
                    value={captchaAnswer}
                    onChange={e => setCaptchaAnswer(e.target.value)}
                    autoComplete="off"
                    inputMode="numeric"
                    style={{ width: '90px', flexShrink: 0 }}
                    aria-label="验证码答案"
                  />

                </div>
                <div className="login-captcha-hint">
                  <ShieldCheck size={10} />
                  请计算上方算式并输入结果
                </div>
              </div>

              {error && (
                <div className="login-error">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <button
                className="login-submit"
                type="submit"
                disabled={loading || !username || !password || !captchaAnswer}
              >
                {loading ? (
                  <><span className="spinner" style={{ width: '16px', height: '16px' }} /> 正在登录...</>
                ) : (
                  <><LogIn size={16} /> 登录</>
                )}
              </button>
            </form>

            <div className="login-footer">
              <span className="login-footer-dot" /> StarRocks Manager v1.0
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
