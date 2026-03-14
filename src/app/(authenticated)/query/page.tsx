'use client';

import React, { useState, useRef } from 'react';
import { useSession } from '@/hooks/useSession';
import { Play, Clock, Download, Trash2, Terminal } from 'lucide-react';

interface QueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string }[];
  rowCount: number;
  duration: number;
  error?: string;
}

interface HistoryEntry {
  sql: string;
  timestamp: number;
  duration?: number;
  rowCount?: number;
  error?: string;
}

export default function QueryPage() {
  const { session } = useSession();
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'result' | 'history'>('result');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleExecute() {
    if (!session || !sql.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setActiveTab('result');

    const entry: HistoryEntry = { sql: sql.trim(), timestamp: Date.now() };

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, sql: sql.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        entry.error = data.error;
      } else {
        setResult(data);
        entry.duration = data.duration;
        entry.rowCount = data.rowCount;
      }
    } catch (err) {
      const errMsg = String(err);
      setError(errMsg);
      entry.error = errMsg;
    } finally {
      setLoading(false);
      setHistory(prev => [entry, ...prev].slice(0, 50));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
  }

  function loadFromHistory(entry: HistoryEntry) {
    setSql(entry.sql);
    if (textareaRef.current) textareaRef.current.focus();
  }

  function exportCsv() {
    if (!result || result.rows.length === 0) return;
    const headers = result.fields.map(f => f.name);
    const csvRows = [
      headers.join(','),
      ...result.rows.map(row =>
        headers.map(h => {
          const val = String(row[h] ?? '');
          return val.includes(',') || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        }).join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_result_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">SQL 查询</h1>
            <p className="page-description">执行 SQL 查询并查看结果 · Ctrl+Enter 执行</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Editor */}
        <div className="card mb-4">
          <textarea
            ref={textareaRef}
            className="sql-editor"
            placeholder="输入 SQL 查询语句...&#10;&#10;示例:&#10;  SELECT * FROM information_schema.tables LIMIT 10;&#10;  SHOW DATABASES;&#10;  SHOW PROCESSLIST;"
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={8}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
            <div className="text-xs text-secondary">
              Ctrl+Enter 执行 · 支持单条 SQL 语句
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => setSql('')} disabled={!sql}>
                <Trash2 size={14} /> 清空
              </button>
              <button className="btn btn-primary" onClick={handleExecute} disabled={loading || !sql.trim()}>
                {loading ? <span className="spinner" /> : <Play size={16} />}
                执行
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="tabs">
          <button className={`tab ${activeTab === 'result' ? 'active' : ''}`} onClick={() => setActiveTab('result')}>
            查询结果 {result ? `(${result.rowCount} 行)` : ''}
          </button>
          <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            查询历史 ({history.length})
          </button>
        </div>

        {/* Result Tab */}
        {activeTab === 'result' && (
          result ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-secondary">
                  <Clock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                  {result.duration}ms · {result.rowCount} 行
                </div>
                <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={result.rows.length === 0}>
                  <Download size={14} /> 导出 CSV
                </button>
              </div>
              {result.rows.length === 0 ? (
                <div className="empty-state">
                  <Terminal size={36} />
                  <div className="empty-state-text">查询执行成功，没有返回数据</div>
                </div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        {result.fields.map(f => <th key={f.name}>{f.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i}>
                          <td className="text-secondary">{i + 1}</td>
                          {result.fields.map(f => (
                            <td key={f.name} className="text-xs">
                              {row[f.name] === null ? <span className="text-secondary" style={{ fontStyle: 'italic' }}>NULL</span> : String(row[f.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <Terminal size={48} />
              <div className="empty-state-text">输入 SQL 语句并点击执行</div>
            </div>
          )
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          history.length === 0 ? (
            <div className="empty-state">
              <Clock size={48} />
              <div className="empty-state-text">暂无查询历史</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {history.map((h, i) => (
                <div key={i} className="card" style={{ cursor: 'pointer', padding: '14px' }} onClick={() => loadFromHistory(h)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-secondary">
                      {new Date(h.timestamp).toLocaleString('zh-CN')}
                    </div>
                    <div className="flex gap-2">
                      {h.duration !== undefined && (
                        <span className="badge badge-info"><Clock size={10} /> {h.duration}ms</span>
                      )}
                      {h.rowCount !== undefined && (
                        <span className="badge badge-neutral">{h.rowCount} 行</span>
                      )}
                      {h.error && (
                        <span className="badge badge-danger">错误</span>
                      )}
                    </div>
                  </div>
                  <div className="text-mono text-xs truncate" style={{ color: h.error ? 'var(--danger-500)' : 'var(--text-primary)' }}>
                    {h.sql}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}
