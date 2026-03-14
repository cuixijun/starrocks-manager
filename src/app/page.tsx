'use client';

import React, { useState, useEffect } from 'react';
import { Database, Eye, EyeOff, Server, Save, Zap, Trash2 } from 'lucide-react';
import ThemeSwitcher from '@/components/ThemeSwitcher';

interface SavedConn {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  default_db: string;
  last_used_at: string | null;
}

export default function LoginPage() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9030');
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [defaultDb, setDefaultDb] = useState('');
  const [connName, setConnName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  const [savedConns, setSavedConns] = useState<SavedConn[]>([]);

  useEffect(() => {
    fetchSavedConnections();
  }, []);

  async function fetchSavedConnections() {
    try {
      const res = await fetch('/api/connections');
      const data = await res.json();
      setSavedConns(data.connections || []);
    } catch { /* ignore */ }
  }

  async function handleTest() {
    setTesting(true);
    setError('');
    setTestResult('');
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), username, password, testOnly: true }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(`连接成功! StarRocks 版本: ${data.version}`);
      } else {
        setError(data.error || '连接失败');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setTesting(false);
    }
  }

  async function handleConnect() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), username, password, database: defaultDb }),
      });
      const data = await res.json();
      if (data.success) {
        sessionStorage.setItem('sr-session', JSON.stringify({
          sessionId: data.sessionId,
          host,
          port: parseInt(port),
          username,
          version: data.version,
        }));
        window.location.href = '/dashboard';
      } else {
        setError(data.error || '连接失败');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!connName || !host || !username) {
      setError('请填写连接名称、主机地址和用户名');
      return;
    }
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: connName,
          host,
          port: parseInt(port),
          username,
          password,
          default_db: defaultDb,
        }),
      });
      const data = await res.json();
      if (data.connection) {
        setConnName('');
        fetchSavedConnections();
        setTestResult('连接已保存');
      } else {
        setError(data.error || '保存失败');
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleLoadConnection(conn: SavedConn) {
    // Fetch full connection details (with real password)
    try {
      const res = await fetch(`/api/connections/${conn.id}`);
      const data = await res.json();
      if (data.connection) {
        const c = data.connection;
        setHost(c.host);
        setPort(String(c.port));
        setUsername(c.username);
        setPassword(c.password);
        setDefaultDb(c.default_db || '');
        setConnName(c.name);
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteConnection(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch('/api/connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchSavedConnections();
    } catch { /* ignore */ }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">SR</div>
          <div className="login-logo-text">StarRocks Manager</div>
          <div className="login-logo-subtext">数据库管理工具</div>
          <ThemeSwitcher />
        </div>

        <div className="login-form">
          <div className="form-group">
            <label className="form-label">连接名称（用于保存）</label>
            <input
              className="input"
              placeholder="例如：生产环境"
              value={connName}
              onChange={e => setConnName(e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">主机地址</label>
              <input
                className="input"
                placeholder="192.168.1.100"
                value={host}
                onChange={e => setHost(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">端口</label>
              <input
                className="input"
                type="number"
                placeholder="9030"
                value={port}
                onChange={e => setPort(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">用户名</label>
              <input
                className="input"
                placeholder="root"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="密码"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
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
          </div>

          <div className="form-group">
            <label className="form-label">默认数据库（可选）</label>
            <input
              className="input"
              placeholder="留空则不指定"
              value={defaultDb}
              onChange={e => setDefaultDb(e.target.value)}
            />
          </div>

          {error && (
            <div style={{ color: 'var(--danger-500)', fontSize: '0.82rem', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)' }}>
              {error}
            </div>
          )}

          {testResult && (
            <div style={{ color: 'var(--success-500)', fontSize: '0.82rem', padding: '8px 12px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 'var(--radius-md)' }}>
              {testResult}
            </div>
          )}

          <div className="login-actions">
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleTest} disabled={testing || !host}>
                {testing ? <span className="spinner" /> : <Zap size={16} />}
                测试连接
              </button>
              <button className="btn btn-secondary" onClick={handleSave} disabled={!connName || !host} title="保存连接">
                <Save size={16} />
              </button>
            </div>
            <button className="btn btn-primary" onClick={handleConnect} disabled={loading || !host || !username}>
              {loading ? <span className="spinner" /> : <><Server size={16} /> 连接</>}
            </button>
          </div>
        </div>

        {savedConns.length > 0 && (
          <div className="saved-connections">
            <div className="saved-connections-title">
              <Database size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
              已保存的连接
            </div>
            {savedConns.map(conn => (
              <div key={conn.id} className="saved-connection-item" onClick={() => handleLoadConnection(conn)}>
                <div style={{ flex: 1 }}>
                  <div className="saved-connection-name">{conn.name}</div>
                  <div className="saved-connection-detail">{conn.username}@{conn.host}:{conn.port}</div>
                </div>
                <button
                  className="btn-ghost btn-icon"
                  onClick={(e) => handleDeleteConnection(conn.id, e)}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="login-footer">
          StarRocks 专用管理工具 — 支持存算分离与存算一体架构
        </div>
      </div>
    </div>
  );
}
