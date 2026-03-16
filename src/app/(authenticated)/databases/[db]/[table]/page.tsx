'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Copy, Check, RefreshCw } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';

interface ColumnInfo {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default: string;
  Extra: string;
}

export default function TableDetailPage() {
  const { session } = useSession();
  const params = useParams();
  const db = decodeURIComponent(params.db as string);
  const table = decodeURIComponent(params.table as string);
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [ddl, setDdl] = useState('');
  const [partitions, setPartitions] = useState<Record<string, unknown>[]>([]);
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; fields: { name: string }[] }>({ rows: [], fields: [] });
  const [activeTab, setActiveTab] = useState('schema');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [previewLimit, setPreviewLimit] = useState(10);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetchTableDetail();
  }, [session, db, table]);

  async function fetchTableDetail(limit = 10) {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}?sessionId=${encodeURIComponent(session.sessionId)}&limit=${limit}`
      );
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSchema(data.schema || []);
        setDdl(data.ddl || '');
        setPartitions(data.partitions || []);
        setPreview(data.preview || { rows: [], fields: [] });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function fetchPreview(limit: number) {
    if (!session) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}?sessionId=${encodeURIComponent(session.sessionId)}&limit=${limit}`
      );
      const data = await res.json();
      if (!data.error) {
        setPreview(data.preview || { rows: [], fields: [] });
      }
    } catch { /* ignore */ }
    finally { setPreviewLoading(false); }
  }

  function handleLimitChange(newLimit: number) {
    setPreviewLimit(newLimit);
    fetchPreview(newLimit);
  }

  function copyDdl() {
    navigator.clipboard.writeText(ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tabs = [
    { key: 'schema', label: `Schema (${schema.length})` },
    { key: 'ddl', label: 'DDL' },
    { key: 'partitions', label: `分区 (${partitions.length})` },
    { key: 'preview', label: `数据预览 (${preview.rows.length})` },
  ];

  return (
    <>
      <div className="page-header">
        <Breadcrumb items={[
          { label: '数据库浏览', href: '/databases' },
          { label: db, href: `/databases/${encodeURIComponent(db)}` },
          { label: table },
        ]} />
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{table}</h1>
            <p className="page-description">{db} · {schema.length} 列</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : (
          <>
            <div className="tabs">
              {tabs.map(t => (
                <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === 'schema' && (
              <div className="table-container fade-in">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>列名</th>
                      <th>类型</th>
                      <th>允许 NULL</th>
                      <th>Key</th>
                      <th>默认值</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schema.map((col, i) => (
                      <tr key={col.Field}>
                        <td className="text-secondary">{i + 1}</td>
                        <td className="text-mono" style={{ fontWeight: 500 }}>{col.Field}</td>
                        <td>
                          <span className="badge badge-info">{col.Type}</span>
                        </td>
                        <td>{col.Null === 'YES' ? '✓' : '✗'}</td>
                        <td>
                          {col.Key ? <span className="badge badge-warning">{col.Key}</span> : '-'}
                        </td>
                        <td className="text-xs text-secondary">{col.Default || '-'}</td>
                        <td className="text-xs text-secondary">{col.Extra || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'ddl' && (
              <div className="card fade-in">
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                  <button className="btn btn-secondary btn-sm" onClick={copyDdl}>
                    {copied ? <><Check size={14} /> 已复制</> : <><Copy size={14} /> 复制</>}
                  </button>
                </div>
                <pre className="sql-editor" style={{ minHeight: '100px', whiteSpace: 'pre-wrap', cursor: 'text' }}>
                  {ddl || '无 DDL 信息'}
                </pre>
              </div>
            )}

            {activeTab === 'partitions' && (
              partitions.length === 0 ? (
                <div className="empty-state fade-in">
                  <div className="empty-state-text">该表没有分区信息</div>
                </div>
              ) : (
                <div className="table-container fade-in">
                  <table>
                    <thead>
                      <tr>
                        {Object.keys(partitions[0] || {}).map(key => (
                          <th key={key}>{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {partitions.map((p, i) => (
                        <tr key={i}>
                          {Object.values(p).map((v, j) => (
                            <td key={j} className="text-xs">{String(v ?? '-')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {activeTab === 'preview' && (
              <div className="fade-in">
                {/* Limit selector toolbar */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 0', marginBottom: '8px', gap: '12px', flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <span>显示行数</span>
                    <select
                      value={previewLimit}
                      onChange={e => handleLimitChange(Number(e.target.value))}
                      style={{
                        padding: '4px 8px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-secondary)', background: 'var(--bg-primary)',
                        fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer',
                      }}
                    >
                      {[10, 50, 100, 200, 500].map(n => (
                        <option key={n} value={n}>{n} 条</option>
                      ))}
                    </select>
                    {previewLoading && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--primary-500)', fontSize: '0.78rem' }}>
                        <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> 加载中...
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                    已加载 {preview.rows.length} 条记录
                  </span>
                </div>

                {preview.rows.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-text">暂无数据</div>
                  </div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '48px', textAlign: 'center' }}>#</th>
                          {preview.fields.map(f => (
                            <th key={f.name}>{f.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, i) => (
                          <tr key={i}>
                            <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{i + 1}</td>
                            {preview.fields.map(f => (
                              <td key={f.name} className="text-xs">{String((row as Record<string, unknown>)[f.name] ?? 'NULL')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
