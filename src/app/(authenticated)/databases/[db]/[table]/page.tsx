'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Copy, Check } from 'lucide-react';

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

  useEffect(() => {
    if (!session) return;
    fetchTableDetail();
  }, [session, db, table]);

  async function fetchTableDetail() {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}?sessionId=${encodeURIComponent(session.sessionId)}`
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href={`/databases/${encodeURIComponent(db)}`} className="btn btn-ghost btn-icon">
            <ArrowLeft size={18} />
          </Link>
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
              preview.rows.length === 0 ? (
                <div className="empty-state fade-in">
                  <div className="empty-state-text">暂无数据</div>
                </div>
              ) : (
                <div className="table-container fade-in">
                  <table>
                    <thead>
                      <tr>
                        {preview.fields.map(f => (
                          <th key={f.name}>{f.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i}>
                          {preview.fields.map(f => (
                            <td key={f.name} className="text-xs">{String((row as Record<string, unknown>)[f.name] ?? 'NULL')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}
      </div>
    </>
  );
}
