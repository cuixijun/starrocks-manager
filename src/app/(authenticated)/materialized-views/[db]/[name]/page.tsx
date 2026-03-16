'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { useParams, useRouter } from 'next/navigation';
import { Copy, Check, RefreshCw, Play, Power, Trash2, AlertTriangle, Clock, Settings } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import SqlHighlighter from '@/components/SqlHighlighter';
import { Modal } from '@/components/ui/Modal';

interface ColumnInfo {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default: string;
  Extra: string;
}

const STATUS_STYLE: Record<string, { color: string }> = {
  SUCCESS: { color: 'var(--success-600)' },
  FAILED: { color: 'var(--danger-500)' },
  RUNNING: { color: 'var(--primary-600)' },
  PENDING: { color: 'var(--warning-600)' },
};

export default function MVDetailPage() {
  const { session } = useSession();
  const router = useRouter();
  const params = useParams();
  const db = decodeURIComponent(params.db as string);
  const name = decodeURIComponent(params.name as string);

  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [ddl, setDdl] = useState('');
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; fields: { name: string }[] }>({ rows: [], fields: [] });
  const [taskRuns, setTaskRuns] = useState<Record<string, unknown>[]>([]);
  const [activeTab, setActiveTab] = useState('schema');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const [previewLimit, setPreviewLimit] = useState(10);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [taskRunsLoading, setTaskRunsLoading] = useState(false);
  const [taskRunsLoaded, setTaskRunsLoaded] = useState(false);

  // Management states
  const [refreshingMV, setRefreshingMV] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [mvIsActive, setMvIsActive] = useState(true);
  const [showAlterModal, setShowAlterModal] = useState(false);
  const [alterType, setAlterType] = useState<'refresh' | 'resource_group'>('refresh');
  const [alterInterval, setAlterInterval] = useState('INTERVAL 1 HOUR');
  const [alterResourceGroup, setAlterResourceGroup] = useState('');
  const [altering, setAltering] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (session) fetchDetail();
  }, [session, db, name]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const str = (v: unknown) => {
    const s = String(v ?? '');
    return s === 'null' || s === 'NULL' || s === '\\N' || s === 'undefined' ? '' : s;
  };

  async function fetchDetail(limit = 10) {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/materialized-views/${encodeURIComponent(db)}/${encodeURIComponent(name)}?sessionId=${encodeURIComponent(session.sessionId)}&limit=${limit}`
      );
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSchema(data.schema || []);
        setDdl(data.ddl || '');
        setPreview(data.preview || { rows: [], fields: [] });
        // Detect active status from MV info
        if (data.mvInfo) {
          setMvIsActive(str(data.mvInfo.IS_ACTIVE) === 'true');
        }
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }

  async function fetchPreview(limit: number) {
    if (!session) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/materialized-views/${encodeURIComponent(db)}/${encodeURIComponent(name)}?sessionId=${encodeURIComponent(session.sessionId)}&limit=${limit}`
      );
      const data = await res.json();
      if (!data.error) setPreview(data.preview || { rows: [], fields: [] });
    } catch { /* ignore */ }
    finally { setPreviewLoading(false); }
  }

  async function fetchTaskRuns() {
    if (!session || taskRunsLoaded) return;
    setTaskRunsLoading(true);
    try {
      const res = await fetch(
        `/api/materialized-views/${encodeURIComponent(db)}/${encodeURIComponent(name)}?sessionId=${encodeURIComponent(session.sessionId)}&section=task_runs`
      );
      const data = await res.json();
      if (!data.error) { setTaskRuns(data.taskRuns || []); setTaskRunsLoaded(true); }
    } catch { /* ignore */ }
    finally { setTaskRunsLoading(false); }
  }

  function handleTabChange(key: string) {
    setActiveTab(key);
    if (key === 'history' && !taskRunsLoaded) fetchTaskRuns();
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

  // ========== Management Actions ==========
  async function postAction(body: Record<string, unknown>) {
    if (!session) return null;
    const res = await fetch('/api/materialized-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, ...body }),
    });
    return res.json();
  }

  async function handleRefreshMV() {
    setRefreshingMV(true);
    const data = await postAction({ action: 'refresh', dbName: db, mvName: name });
    if (data?.error) setError(data.error);
    else setSuccess('已触发手动刷新');
    setRefreshingMV(false);
  }

  async function handleToggleActive() {
    setTogglingActive(true);
    const data = await postAction({ action: 'alter_active', dbName: db, mvName: name, active: !mvIsActive });
    if (data?.error) setError(data.error);
    else {
      setMvIsActive(!mvIsActive);
      setSuccess(`物化视图已${mvIsActive ? '停用' : '激活'}`);
    }
    setTogglingActive(false);
  }

  async function handleAlter() {
    setAltering(true); setActionError('');
    let body: Record<string, unknown> = { dbName: db, mvName: name };
    if (alterType === 'refresh') body = { ...body, action: 'alter_refresh', interval: alterInterval };
    else if (alterType === 'resource_group') body = { ...body, action: 'alter_resource_group', resourceGroup: alterResourceGroup };
    const data = await postAction(body);
    if (data?.error) setActionError(data.error);
    else { setShowAlterModal(false); setSuccess('物化视图设置已更新'); }
    setAltering(false);
  }

  async function handleDelete() {
    setDeleting(true); setActionError('');
    const data = await postAction({ action: 'drop', dbName: db, mvName: name });
    if (data?.error) setActionError(data.error);
    else { router.push('/materialized-views'); }
    setDeleting(false);
  }

  const selectStyle: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-secondary)', background: 'var(--bg-primary)',
    fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer',
  };

  const tabs = [
    { key: 'schema', label: `Schema (${schema.length})` },
    { key: 'ddl', label: 'DDL' },
    { key: 'preview', label: `数据预览 (${preview.rows.length})` },
    { key: 'history', label: taskRunsLoaded ? `执行记录 (${taskRuns.length})` : '执行记录' },
  ];

  return (
    <>
      <div className="page-header">
        <Breadcrumb items={[
          { label: '物化视图', href: '/materialized-views' },
          { label: db, href: '/materialized-views' },
          { label: name },
        ]} />
        <div className="page-header-row">
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {name}
              <button
                onClick={handleToggleActive}
                disabled={togglingActive || loading}
                title={`点击${mvIsActive ? '停用' : '激活'}`}
                style={{
                  padding: '3px 12px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                  cursor: togglingActive ? 'wait' : 'pointer',
                  border: `1px solid ${mvIsActive ? 'rgba(22,163,74,0.3)' : 'rgba(107,114,128,0.3)'}`,
                  backgroundColor: mvIsActive ? 'rgba(22,163,74,0.08)' : 'rgba(107,114,128,0.06)',
                  color: mvIsActive ? 'var(--success-600)' : 'var(--text-tertiary)',
                  transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: '4px',
                  opacity: togglingActive ? 0.5 : 1,
                }}
              >
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: mvIsActive ? 'var(--success-600)' : 'var(--text-tertiary)',
                }} />
                {togglingActive ? '...' : mvIsActive ? 'Active' : 'Inactive'}
              </button>
            </h1>
            <p className="page-description">{db} · {schema.length} 列 · 物化视图</p>
          </div>
          {/* Action buttons in header */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRefreshMV}
              disabled={refreshingMV}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Play size={13} />
              {refreshingMV ? '刷新中...' : '手动刷新'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setShowAlterModal(true); setActionError(''); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Settings size={13} />
              设置
            </button>
            <button
              className="btn btn-sm"
              onClick={() => { setShowDeleteModal(true); setActionError(''); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                backgroundColor: 'transparent', color: 'var(--danger-500)',
                border: '1px solid rgba(239,68,68,0.3)',
              }}
            >
              <Trash2 size={13} />
              删除
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Success / Error messages */}
        {success && (
          <div style={{
            color: 'var(--success-600)', marginBottom: '12px', padding: '10px 14px',
            background: 'rgba(22,163,74,0.06)', borderRadius: 'var(--radius-md)',
            fontSize: '0.82rem', border: '1px solid rgba(22,163,74,0.15)',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <Check size={14} /> {success}
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '12px', padding: '10px 14px', background: 'rgba(239,68,68,0.06)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', border: '1px solid rgba(239,68,68,0.15)' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : (
          <>
            <div className="tabs">
              {tabs.map(t => (
                <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => handleTabChange(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ========== Schema Tab ========== */}
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
                        <td><span className="badge badge-info">{col.Type}</span></td>
                        <td>{col.Null === 'YES' ? '✓' : '✗'}</td>
                        <td>{col.Key ? <span className="badge badge-warning">{col.Key}</span> : '-'}</td>
                        <td className="text-xs text-secondary">{col.Default || '-'}</td>
                        <td className="text-xs text-secondary">{col.Extra || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ========== DDL Tab ========== */}
            {activeTab === 'ddl' && (
              <div className="card fade-in">
                <SqlHighlighter sql={ddl || '无法获取 DDL'} onCopy={copyDdl} copied={copied} />
              </div>
            )}

            {/* ========== Data Preview Tab ========== */}
            {activeTab === 'preview' && (
              <div className="fade-in">
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
                  <div className="empty-state"><div className="empty-state-text">暂无数据</div></div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '48px', textAlign: 'center' }}>#</th>
                          {preview.fields.map(f => <th key={f.name}>{f.name}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, i) => (
                          <tr key={i}>
                            <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{i + 1}</td>
                            {preview.fields.map(f => (
                              <td key={f.name} className="text-xs">{String((row as Record<string, unknown>)[f.name] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ========== Execution History Tab ========== */}
            {activeTab === 'history' && (
              <div className="fade-in">
                <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                  显示最近 10 次执行记录（来自 <code style={{ padding: '1px 4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '3px' }}>information_schema.task_runs</code>）
                </p>
                {taskRunsLoading ? (
                  <div className="loading-overlay"><div className="spinner" /> 加载执行记录...</div>
                ) : taskRuns.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-text">暂无执行记录</div></div>
                ) : (
                  <div className="table-container" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', tableLayout: 'auto' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '36px', textAlign: 'center' }}>#</th>
                          <th style={{ minWidth: '60px' }}>状态</th>
                          <th style={{ minWidth: '130px' }}>开始时间</th>
                          <th style={{ minWidth: '130px' }}>结束时间</th>
                          <th style={{ minWidth: '50px' }}>耗时</th>
                          <th style={{ minWidth: '70px' }}>进度</th>
                          <th>刷新信息</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taskRuns.map((run, i) => {
                          const state = str(run.STATE || run.STATUS);
                          const stStyle = STATUS_STYLE[state] || STATUS_STYLE.PENDING;
                          const createTime = str(run.CREATE_TIME);
                          const finishTime = str(run.FINISH_TIME);
                          const progress = str(run.PROGRESS);
                          const extraMsg = str(run.EXTRA_MESSAGE || run.ERROR_MESSAGE);

                          const fmtDate = (d: string) => {
                            if (!d) return '';
                            try {
                              return new Date(d).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                            } catch { return d; }
                          };

                          let duration = '';
                          if (createTime && finishTime) {
                            const start = new Date(createTime).getTime();
                            const end = new Date(finishTime).getTime();
                            if (!isNaN(start) && !isNaN(end)) {
                              const secs = Math.round((end - start) / 1000);
                              duration = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
                            }
                          }

                          return (
                            <tr key={i}>
                              <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>{i + 1}</td>
                              <td>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: stStyle.color }}>
                                  {state}
                                </span>
                              </td>
                              <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(createTime)}</td>
                              <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(finishTime)}</td>
                              <td style={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{duration}</td>
                              <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{progress}</td>
                              <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: 1.5 }}>
                                {extraMsg}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ========== Settings Modal ========== */}
      <Modal
        open={showAlterModal}
        onClose={() => { setShowAlterModal(false); setActionError(''); }}
        title={`设置 — ${db}.${name}`}
        maxWidth="550px"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowAlterModal(false); setActionError(''); }}>取消</button>
            <button className="btn btn-primary btn-sm" onClick={handleAlter} disabled={altering}>
              {altering ? '执行中...' : '确认修改'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
          <button
            onClick={() => setAlterType('refresh')}
            style={{
              padding: '5px 14px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: alterType === 'refresh' ? 600 : 500,
              border: `1px solid ${alterType === 'refresh' ? 'var(--primary-400)' : 'var(--border-secondary)'}`,
              backgroundColor: alterType === 'refresh' ? 'var(--primary-50)' : 'transparent',
              color: alterType === 'refresh' ? 'var(--primary-600)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            <Clock size={12} style={{ verticalAlign: '-1px', marginRight: '4px' }} />
            执行频率
          </button>
          <button
            onClick={() => setAlterType('resource_group')}
            style={{
              padding: '5px 14px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: alterType === 'resource_group' ? 600 : 500,
              border: `1px solid ${alterType === 'resource_group' ? 'var(--primary-400)' : 'var(--border-secondary)'}`,
              backgroundColor: alterType === 'resource_group' ? 'var(--primary-50)' : 'transparent',
              color: alterType === 'resource_group' ? 'var(--primary-600)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            资源组
          </button>
        </div>
        {actionError && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
            {actionError}
          </div>
        )}
        {alterType === 'refresh' && (
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '8px' }}>刷新间隔</label>
            <select style={{ ...selectStyle, width: '100%', padding: '8px 12px' }} value={alterInterval} onChange={e => setAlterInterval(e.target.value)}>
              <option value="INTERVAL 5 MINUTE">每 5 分钟</option>
              <option value="INTERVAL 10 MINUTE">每 10 分钟</option>
              <option value="INTERVAL 30 MINUTE">每 30 分钟</option>
              <option value="INTERVAL 1 HOUR">每 1 小时</option>
              <option value="INTERVAL 2 HOUR">每 2 小时</option>
              <option value="INTERVAL 6 HOUR">每 6 小时</option>
              <option value="INTERVAL 12 HOUR">每 12 小时</option>
              <option value="INTERVAL 1 DAY">每 1 天</option>
            </select>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '10px', padding: '8px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
              SQL: <code style={{ color: 'var(--primary-600)' }}>ALTER MATERIALIZED VIEW {db}.{name} REFRESH ASYNC EVERY({alterInterval})</code>
            </div>
          </div>
        )}
        {alterType === 'resource_group' && (
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '8px' }}>资源组名称</label>
            <input className="input" placeholder="输入资源组名称，如 rg_mv" value={alterResourceGroup} onChange={e => setAlterResourceGroup(e.target.value)} style={{ width: '100%' }} />
            <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '10px', padding: '8px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
              SQL: <code style={{ color: 'var(--primary-600)' }}>ALTER MATERIALIZED VIEW {db}.{name} SET (&apos;resource_group&apos; = &apos;{alterResourceGroup || '...'}&apos;)</code>
            </div>
          </div>
        )}
      </Modal>

      {/* ========== Delete Modal ========== */}
      <Modal
        open={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setActionError(''); }}
        title={`删除物化视图`}
        maxWidth="500px"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowDeleteModal(false); setActionError(''); }}>取消</button>
            <button className="btn btn-sm" style={{ backgroundColor: 'var(--danger-500)', color: '#fff', borderColor: 'var(--danger-500)' }} onClick={handleDelete} disabled={deleting}>
              <Trash2 size={14} /> {deleting ? '删除中...' : '确认删除'}
            </button>
          </div>
        }
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          padding: '12px 14px', borderRadius: 'var(--radius-md)',
          backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
          fontSize: '0.82rem', color: 'var(--danger-500)', marginBottom: '12px',
        }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>此操作不可撤销！删除后物化视图数据将永久丢失。</div>
        </div>
        {actionError && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
            {actionError}
          </div>
        )}
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          确定要删除 <strong style={{ color: 'var(--text-primary)' }}>{db}.{name}</strong> 吗？
        </p>
      </Modal>
    </>
  );
}
