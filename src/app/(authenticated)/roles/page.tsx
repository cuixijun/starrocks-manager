'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePagination } from '@/hooks/usePagination';
import { Pagination, CommandLogButton} from '@/components/ui';
import PrivilegeDetailModal, { CatalogSectionBlock } from '@/components/PrivilegeDetailModal';
import SearchableSelect from '@/components/SearchableSelect';
import Breadcrumb from '@/components/Breadcrumb';
import { classifyGrants, type CatalogGrant } from '@/utils/grantClassifier';
import {
  ShieldCheck, Plus, Trash2, RefreshCw, Search, X,
  UserPlus, UserMinus, ChevronUp, ChevronDown, ChevronsUpDown, Clock,
  Shield, Key, Eye, ChevronRight, ChevronLeft,
  Wrench, Database, Code, FolderOpen,
} from 'lucide-react';
import { apiFetch } from '@/lib/fetch-patch';

type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={13} style={{ opacity: 0.35 }} />;
  return dir === 'asc'
    ? <ChevronUp size={13} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={13} style={{ color: 'var(--primary-500)' }} />;
}

const SYSTEM_ROLES = new Set(['root', 'cluster_admin', 'db_admin', 'user_admin', 'security_admin', 'public']);

export default function RolesPage() {
  const { session } = useSession();
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // Privilege detail modal (lazy-loaded on click)
  const [showPrivDetail, setShowPrivDetail] = useState<{ role: string; grants: string[]; catalogGrants?: { grant: string; catalog: string }[] } | null>(null);
  const [privLoading, setPrivLoading] = useState(false);

  // Grant Wizard state
  const [showGrant, setShowGrant] = useState<string | null>(null);
  type PrivCategory = 'system' | 'ddl' | 'dml' | 'function' | 'catalog';
  const [grantCategory, setGrantCategory] = useState<PrivCategory>('dml');
  const [grantPrivs, setGrantPrivs] = useState<Set<string>>(new Set());
  const [grantCatalog, setGrantCatalog] = useState('default_catalog');
  const [grantDb, setGrantDb] = useState('');
  const [grantScope, setGrantScope] = useState('database');
  const [grantObjType, setGrantObjType] = useState('all_table');
  const [grantAllObjects, setGrantAllObjects] = useState(true);
  const [grantSpecific, setGrantSpecific] = useState('');
  const [grantDbMulti, setGrantDbMulti] = useState<Set<string>>(new Set());
  const [grantSpecificMulti, setGrantSpecificMulti] = useState<Set<string>>(new Set());
  const [grantCatalogs, setGrantCatalogs] = useState<string[]>([]);
  const [grantDbs, setGrantDbs] = useState<string[]>([]);
  const [grantTables, setGrantTables] = useState<string[]>([]);
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [quickRevoking, setQuickRevoking] = useState(false);
  const grantDirtyRef = useRef(false);
  const [grantExisting, setGrantExisting] = useState<import('@/utils/grantClassifier').CatalogGroup[]>([]);
  const [grantExistingOpen, setGrantExistingOpen] = useState(false);
  const metaCacheRef = React.useRef<Map<string, { data: string[]; ts: number }>>(new Map());
  const META_TTL = 10 * 60 * 1000;

  // User assignment Transfer List state
  const [showUserAssign, setShowUserAssign] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<{ identity: string; grants: string[] }[]>([]);
  const [userRightSet, setUserRightSet] = useState<Set<string>>(new Set());
  const [userOriginalSet, setUserOriginalSet] = useState<Set<string>>(new Set());
  const [userLeftChecked, setUserLeftChecked] = useState<Set<string>>(new Set());
  const [userRightChecked, setUserRightChecked] = useState<Set<string>>(new Set());
  const [userLeftSearch, setUserLeftSearch] = useState('');
  const [userRightSearch, setUserRightSearch] = useState('');
  const [userSubmitting, setUserSubmitting] = useState(false);

  const fetchRoles = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/roles?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const names: string[] = (data.roles || []).map((r: Record<string, unknown>) =>
          String(r['Name'] || r['name'] || r['Value'] || Object.values(r)[0] || '')
        );

        setRoles(names);

        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchRoles(); }, [session, fetchRoles]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  async function handleCreateRole() {
    if (!session || !newRole) return;
    setError('');
    try {
      const res = await apiFetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action: 'create', roleName: newRole }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setShowCreate(false); setNewRole(''); setSuccess('角色创建成功'); fetchRoles(); }
    } catch (err) { setError(String(err)); }
  }

  async function handleDeleteRole(name: string) {
    if (!session) return;
    setDeleteConfirm(name);
  }

  async function confirmDelete() {
    if (!session || !deleteConfirm) return;
    try {
      const res = await apiFetch('/api/roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, roleName: deleteConfirm }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess('角色已删除'); fetchRoles(); }
    } catch (err) { setError(String(err)); }
    finally { setDeleteConfirm(null); }
  }

  // ── Privilege category → available privileges (scope-aware) ──
  const DDL_PRIVS_BY_SCOPE: Record<string, { label: string; value: string }[]> = {
    database: [
      { label: 'CREATE TABLE', value: 'CREATE TABLE' },
      { label: 'CREATE VIEW', value: 'CREATE VIEW' },
      { label: 'CREATE MV', value: 'CREATE MATERIALIZED VIEW' },
      { label: 'ALTER', value: 'ALTER' },
      { label: 'DROP', value: 'DROP' },
    ],
    all_table: [{ label: 'ALTER', value: 'ALTER' }, { label: 'DROP', value: 'DROP' }],
    specific_table: [{ label: 'ALTER', value: 'ALTER' }, { label: 'DROP', value: 'DROP' }, { label: 'EXPORT', value: 'EXPORT' }],
    all_view: [{ label: 'ALTER', value: 'ALTER' }, { label: 'DROP', value: 'DROP' }],
    specific_view: [{ label: 'ALTER', value: 'ALTER' }, { label: 'DROP', value: 'DROP' }],
    all_mv: [{ label: 'ALTER', value: 'ALTER' }, { label: 'DROP', value: 'DROP' }, { label: 'REFRESH', value: 'REFRESH' }],
    specific_mv: [{ label: 'ALTER', value: 'ALTER' }, { label: 'DROP', value: 'DROP' }, { label: 'REFRESH', value: 'REFRESH' }],
  };
  const DML_PRIVS_BY_SCOPE: Record<string, { label: string; value: string }[]> = {
    database: [{ label: 'SELECT', value: 'SELECT' }, { label: 'INSERT', value: 'INSERT' }, { label: 'UPDATE', value: 'UPDATE' }, { label: 'DELETE', value: 'DELETE' }],
    all_table: [{ label: 'SELECT', value: 'SELECT' }, { label: 'INSERT', value: 'INSERT' }, { label: 'UPDATE', value: 'UPDATE' }, { label: 'DELETE', value: 'DELETE' }],
    specific_table: [{ label: 'SELECT', value: 'SELECT' }, { label: 'INSERT', value: 'INSERT' }, { label: 'UPDATE', value: 'UPDATE' }, { label: 'DELETE', value: 'DELETE' }, { label: 'EXPORT', value: 'EXPORT' }],
    all_view: [{ label: 'SELECT', value: 'SELECT' }],
    specific_view: [{ label: 'SELECT', value: 'SELECT' }],
    all_mv: [{ label: 'SELECT', value: 'SELECT' }],
    specific_mv: [{ label: 'SELECT', value: 'SELECT' }],
  };

  function getPrivOptions(): { label: string; value: string }[] {
    if (grantCategory === 'system') return [{ label: 'OPERATE', value: 'OPERATE' }, { label: 'NODE', value: 'NODE' }, { label: 'CREATE RESOURCE GROUP', value: 'CREATE RESOURCE GROUP' }];
    if (grantCategory === 'catalog') return [{ label: 'USAGE', value: 'USAGE' }, { label: 'CREATE DATABASE', value: 'CREATE DATABASE' }, { label: 'DROP', value: 'DROP' }, { label: 'ALTER', value: 'ALTER' }];
    if (grantCategory === 'function') return [{ label: 'USAGE', value: 'USAGE' }, { label: 'CREATE FUNCTION', value: 'CREATE FUNCTION' }, { label: 'DROP', value: 'DROP' }];
    const scopeKey = grantScope === 'database' ? 'database' : (grantObjType || 'all_table');
    if (grantCategory === 'ddl') return DDL_PRIVS_BY_SCOPE[scopeKey] || DDL_PRIVS_BY_SCOPE['database'];
    if (grantCategory === 'dml') return DML_PRIVS_BY_SCOPE[scopeKey] || DML_PRIVS_BY_SCOPE['all_table'];
    return [];
  }
  const PRIV_OPTIONS = getPrivOptions();

  const CATEGORY_META_UI: Record<string, { label: string; color: string; bg: string }> = {
    system:   { label: '系统', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
    ddl:      { label: 'DDL',  color: '#d97706', bg: 'rgba(234,179,8,0.08)' },
    dml:      { label: 'DML',  color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    function: { label: '函数', color: '#0284c7', bg: 'rgba(2,132,199,0.08)' },
    catalog:  { label: 'Catalog', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  };

  const roleTarget = (name: string) => `ROLE '${name}'`;

  async function openGrantModal(roleName: string) {
    setShowGrant(roleName);
    setGrantCategory('dml');
    setGrantPrivs(new Set());
    setGrantCatalog('default_catalog');
    setGrantDb('');
    setGrantScope('database');
    setGrantSpecific('');
    setGrantSubmitting(false);
    setGrantExisting([]);
    setGrantExistingOpen(false);
    grantDirtyRef.current = false;
    setGrantTables([]);
    if (session) {
      try {
        const [catRes, grantRes] = await Promise.all([
          apiFetch(`/api/catalogs?sessionId=${encodeURIComponent(session.sessionId)}`),
          apiFetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(roleTarget(roleName))}`),
        ]);
        const catData = await catRes.json();
        if (catData.catalogs) {
          const names = catData.catalogs.map((c: Record<string, unknown>) => String(c['CatalogName'] || c['Catalog'] || Object.values(c)[0]));
          names.sort((a: string, b: string) => { if (a === 'default_catalog') return -1; if (b === 'default_catalog') return 1; return a.localeCompare(b); });
          setGrantCatalogs(names);
          loadGrantDbs('default_catalog');
        }
        const grantData = await grantRes.json();
        if (grantData.grants) setGrantExisting(classifyGrants(grantData.grants, grantData.catalogGrants));
      } catch { /* ignore */ }
    }
  }

  async function loadGrantDbs(catalog: string) {
    if (!session) return;
    const cacheKey = `dbs:${catalog}`;
    const cached = metaCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < META_TTL) { setGrantDbs(cached.data); if (cached.data.length > 0) setGrantDb(cached.data[0]); return; }
    try {
      const res = await apiFetch(`/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, sql: `SHOW DATABASES FROM \`${catalog}\`` }) });
      const data = await res.json();
      if (data.rows) {
        const names = data.rows.map((r: Record<string, unknown>) => String(r['Database'] || Object.values(r)[0]));
        setGrantDbs(names); if (names.length > 0) setGrantDb(names[0]);
        metaCacheRef.current.set(cacheKey, { data: names, ts: Date.now() });
      }
    } catch { /* ignore */ }
  }

  async function loadGrantTables(catalog: string, db: string, objType: string = 'table') {
    if (!session || !db) return;
    const cacheKey = `tables:${catalog}.${db}:${objType}`;
    const cached = metaCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < META_TTL) { setGrantTables(cached.data); return; }
    try {
      let sql = '';
      if (objType === 'view') sql = `SHOW FULL TABLES FROM \`${catalog}\`.\`${db}\` WHERE Table_type = 'VIEW'`;
      else if (objType === 'mv') sql = `SHOW MATERIALIZED VIEWS FROM \`${db}\``;
      else sql = `SHOW TABLES FROM \`${catalog}\`.\`${db}\``;
      const res = await apiFetch(`/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, sql }) });
      const data = await res.json();
      if (data.rows) {
        const names = objType === 'mv'
          ? data.rows.map((r: Record<string, unknown>) => String(r['name'] || r['Name'] || Object.values(r)[0]))
          : data.rows.map((r: Record<string, unknown>) => String(Object.values(r)[0]));
        setGrantTables(names);
        metaCacheRef.current.set(cacheKey, { data: names, ts: Date.now() });
      } else { setGrantTables([]); }
    } catch { setGrantTables([]); }
  }

  function buildGrantSQL(action: 'GRANT' | 'REVOKE'): string {
    const privStr = Array.from(grantPrivs).join(', ');
    if (!privStr) return '';
    const toFrom = action === 'GRANT' ? 'TO' : 'FROM';
    const target = roleTarget(showGrant!);
    if (grantCategory === 'system') return `${action} ${privStr} ON SYSTEM ${toFrom} ${target}`;
    if (!grantScope) return '';
    if (grantCategory === 'catalog') {
      if (grantScope === 'all_catalogs') return `${action} ${privStr} ON ALL CATALOGS ${toFrom} ${target}`;
      return `${action} ${privStr} ON CATALOG ${grantCatalog} ${toFrom} ${target}`;
    }
    if (grantCategory === 'function') {
      if (grantScope === 'all_global') return `${action} ${privStr} ON ALL GLOBAL FUNCTIONS ${toFrom} ${target}`;
      if (grantScope === 'all_in_db') return `${action} ${privStr} ON ALL FUNCTIONS IN DATABASE ${grantDb} ${toFrom} ${target}`;
      return `${action} ${privStr} ON GLOBAL FUNCTION ${grantSpecific || '...'} ${toFrom} ${target}`;
    }
    const DDL_SET = new Set(['CREATE TABLE', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW', 'ALTER', 'DROP', 'CREATE FUNCTION']);
    const catalogOnlyPrivs = ['CREATE DATABASE'];
    if (grantScope === 'database') {
      const dbs = Array.from(grantDbMulti);
      if (dbs.length === 0) return '';
      const selectedPrivs = Array.from(grantPrivs).filter(p => !catalogOnlyPrivs.includes(p));
      if (selectedPrivs.length === 0) return '';
      const ddlPrivs = selectedPrivs.filter(p => DDL_SET.has(p));
      const dmlPrivs = selectedPrivs.filter(p => !DDL_SET.has(p));
      const stmts: string[] = [];
      for (const db of dbs) {
        if (ddlPrivs.length > 0) stmts.push(`${action} ${ddlPrivs.join(', ')} ON DATABASE ${db} ${toFrom} ${target}`);
        if (dmlPrivs.length > 0) {
          const tableOnlyDml = dmlPrivs.filter(p => p !== 'SELECT');
          const hasSelect = dmlPrivs.includes('SELECT');
          if (tableOnlyDml.length > 0) {
            const tablePrivs = hasSelect ? ['SELECT', ...tableOnlyDml] : tableOnlyDml;
            stmts.push(`${action} ${tablePrivs.join(', ')} ON ALL TABLES IN DATABASE ${db} ${toFrom} ${target}`);
            if (hasSelect) {
              stmts.push(`${action} SELECT ON ALL VIEWS IN DATABASE ${db} ${toFrom} ${target}`);
              stmts.push(`${action} SELECT ON ALL MATERIALIZED VIEWS IN DATABASE ${db} ${toFrom} ${target}`);
            }
          } else if (hasSelect) {
            stmts.push(`${action} SELECT ON ALL TABLES IN DATABASE ${db} ${toFrom} ${target}`);
            stmts.push(`${action} SELECT ON ALL VIEWS IN DATABASE ${db} ${toFrom} ${target}`);
            stmts.push(`${action} SELECT ON ALL MATERIALIZED VIEWS IN DATABASE ${db} ${toFrom} ${target}`);
          }
        }
      }
      return stmts.join('; ');
    }
    if (grantScope === 'object') {
      if (!grantDb) return '';
      if (grantObjType.startsWith('all_')) {
        const typeMap: Record<string, string> = { all_table: 'ALL TABLES', all_view: 'ALL VIEWS', all_mv: 'ALL MATERIALIZED VIEWS' };
        return `${action} ${privStr} ON ${typeMap[grantObjType] || 'ALL TABLES'} IN DATABASE ${grantDb} ${toFrom} ${target}`;
      } else {
        const typeMap: Record<string, string> = { specific_table: 'TABLE', specific_view: 'VIEW', specific_mv: 'MATERIALIZED VIEW' };
        const items = Array.from(grantSpecificMulti);
        if (items.length === 0) return '';
        return items.map(item => `${action} ${privStr} ON ${typeMap[grantObjType] || 'TABLE'} ${grantDb}.${item} ${toFrom} ${target}`).join('; ');
      }
    }
    return '';
  }

  async function handleGrantSubmit(action: 'GRANT' | 'REVOKE') {
    if (!session || !showGrant) return;
    const sqlFull = buildGrantSQL(action);
    if (!sqlFull) return;
    setGrantSubmitting(true); setError('');
    try {
      const stmts = sqlFull.split(';').map(s => s.trim()).filter(Boolean);
      for (const sql of stmts) {
        const res = await apiFetch('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, sql }) });
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
      }
      setSuccess('授权成功');
      grantDirtyRef.current = true;
      setShowGrant(null);
      fetchRoles(true);
    } catch (err) { setError(String(err)); }
    finally { setGrantSubmitting(false); }
  }

  async function handleQuickRevoke(rawGrant: string) {
    if (!session || !showGrant) return;
    const revokeSQL = rawGrant.replace(/^GRANT\b/i, 'REVOKE').replace(/\bTO\b/i, 'FROM');
    setQuickRevoking(true); setError('');
    try {
      const res = await apiFetch('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, sql: revokeSQL }) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setSuccess('已撤销');
      grantDirtyRef.current = true;
      const gRes = await apiFetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(roleTarget(showGrant))}`);
      const gData = await gRes.json();
      if (gData.grants) setGrantExisting(classifyGrants(gData.grants, gData.catalogGrants));
    } catch (err) { setError(String(err)); }
    finally { setQuickRevoking(false); }
  }

  function closeGrantModal() {
    if (grantSubmitting || quickRevoking) return;
    setShowGrant(null);
    if (grantDirtyRef.current) { fetchRoles(true); grantDirtyRef.current = false; }
  }

  // ── User Assignment Transfer List ──
  async function openUserAssignModal(roleName: string) {
    setShowUserAssign(roleName);
    setUserLeftChecked(new Set()); setUserRightChecked(new Set());
    setUserLeftSearch(''); setUserRightSearch('');
    setUserSubmitting(false);
    if (!session) return;
    try {
      const res = await apiFetch(`/api/users?sessionId=${encodeURIComponent(session.sessionId)}`);
      const data = await res.json();
      if (!data.error && data.users) {
        setAllUsers(data.users);
        // Find users who have this role
        const assignedUsers = new Set<string>();
        for (const u of data.users) {
          for (const g of u.grants) {
            const roleMatch = g.match(/GRANT\s+((?:['`][^'`]+['`](?:\s*,\s*)?)+)\s+TO/i);
            if (roleMatch) {
              const roles = roleMatch[1].match(/['`]([^'`]+)['`]/g) || [];
              if (roles.some((r: string) => r.replace(/['`]/g, '') === roleName)) {
                assignedUsers.add(u.identity);
                break;
              }
            }
          }
        }
        setUserRightSet(new Set(assignedUsers));
        setUserOriginalSet(new Set(assignedUsers));
      }
    } catch { /* ignore */ }
  }

  async function handleUserSubmit() {
    if (!session || !showUserAssign) return;
    setUserSubmitting(true); setError('');
    try {
      const ops: Promise<Response>[] = [];
      for (const userId of userRightSet) {
        if (!userOriginalSet.has(userId)) {
          ops.push(apiFetch('/api/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, action: 'grant_role', grantee: userId, roleName: showUserAssign }) }));
        }
      }
      for (const userId of userOriginalSet) {
        if (!userRightSet.has(userId)) {
          ops.push(apiFetch('/api/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, action: 'revoke_role', grantee: userId, roleName: showUserAssign }) }));
        }
      }
      if (ops.length === 0) { setShowUserAssign(null); return; }
      const results = await Promise.all(ops);
      const errors: string[] = [];
      for (const r of results) { const d = await r.json(); if (d.error) errors.push(d.error); }
      if (errors.length) setError(errors.join('; '));
      else { setSuccess('角色用户已更新'); setShowUserAssign(null); fetchRoles(true); }
    } catch (err) { setError(String(err)); }
    finally { setUserSubmitting(false); }
  }

  const filtered = roles
    .filter(name => name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aSystem = SYSTEM_ROLES.has(a) ? 1 : 0;
      const bSystem = SYSTEM_ROLES.has(b) ? 1 : 0;
      if (aSystem !== bSystem) return aSystem - bSystem;
      return sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    });

  const systemCount = filtered.filter(n => SYSTEM_ROLES.has(n)).length;
  const customCount = filtered.length - systemCount;

  const pg = usePagination(filtered);

  return (
    <>
      <div className="page-header">
        <Breadcrumb items={[{ label: '权限管理' }, { label: '角色管理' }]} />
        <div className="page-header-row">
          <div>
            <h1 className="page-title">角色管理</h1>
            <p className="page-description">
              管理 StarRocks 角色 · {roles.length} 个角色
              {lastRefreshed && (
                <span className="timestamp-hint">
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span className="badge-cache">CACHE</span>}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div className="error-banner">{error}</div>
        )}
        {success && <span className="success-flash">✓ {success}</span>}

        <div className="table-toolbar">
          <div className="table-search">
            <Search size={15} className="table-search-icon" />
            <input placeholder="搜索角色..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="toolbar-actions">
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> 创建角色
            </button>
            <CommandLogButton source="roles" title="角色管理" />
            <button className="btn btn-secondary" onClick={() => fetchRoles(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><ShieldCheck size={48} /><div className="empty-state-text">暂无角色</div></div>
        ) : (
          <div className="table-container fade-in">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '48px', textAlign: 'center' }}>#</th>
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      角色名称 <SortIcon active dir={sortDir} />
                    </span>
                  </th>
                  <th>类型</th>
                  <th style={{ textAlign: 'center', width: '160px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pg.paginatedData.map((name, idx) => {
                  const globalIdx = (pg.page - 1) * pg.pageSize + idx;
                  const isSystem = SYSTEM_ROLES.has(name);
                  return (
                    <tr key={name}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{globalIdx + 1}</td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                          <div className={`icon-box ${isSystem ? 'icon-box-accent' : 'icon-box-primary'}`}>
                            <ShieldCheck size={14} />
                          </div>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{name}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
                          backgroundColor: isSystem ? 'rgba(139,92,246,0.08)' : 'var(--bg-secondary)',
                          color: isSystem ? 'var(--accent-600)' : 'var(--text-secondary)',
                          border: `1px solid ${isSystem ? 'rgba(139,92,246,0.2)' : 'var(--border-secondary)'}`,
                        }}>
                          {isSystem ? '● 系统角色' : '● 自定义角色'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            className="btn-action btn-action-view"
                            title="查看权限"
                            disabled={privLoading}
                            onClick={async () => {
                              if (!session) return;
                              setPrivLoading(true);
                              setError('');
                              try {
                                const gRes = await apiFetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(roleTarget(name))}`);
                                const gData = await gRes.json();
                                if (gData.error) { setError(gData.error); } else {
                                  setShowPrivDetail({ role: name, grants: gData.grants || [], catalogGrants: gData.catalogGrants });
                                }
                              } catch (err) { setError(String(err)); }
                              finally { setPrivLoading(false); }
                            }}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            className="btn-action btn-action-grant"
                            disabled={isSystem}
                            title={isSystem ? '系统角色不可通过UI授权' : '授权'}
                            onClick={() => !isSystem && openGrantModal(name)}
                          >
                            <Shield size={14} />
                          </button>
                          <button
                            className="btn-action btn-action-teal"
                            disabled={isSystem}
                            title={isSystem ? '系统角色不可分配' : '分配给用户'}
                            onClick={() => !isSystem && openUserAssignModal(name)}
                          >
                            <UserPlus size={14} />
                          </button>
                          <button
                            className="btn-action btn-action-danger"
                            disabled={isSystem}
                            onClick={() => !isSystem && handleDeleteRole(name)}
                            title={isSystem ? '系统角色不可删除' : '删除角色'}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="table-footer">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span>
                  共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个角色
                  {search && ` (过滤自 ${roles.length} 个)`}
                  <span style={{ marginLeft: '12px', color: 'var(--accent-600)' }}>系统 {systemCount}</span>
                  <span style={{ marginLeft: '8px', color: 'var(--primary-600)' }}>自定义 {customCount}</span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> SHOW ROLES</span>
              </div>
              <Pagination page={pg.page} pageSize={pg.pageSize} totalPages={pg.totalPages} totalItems={pg.totalItems} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
            </div>
          </div>
        )}

        {/* Create Role Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">创建角色</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowCreate(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">角色名称</label>
                  <input className="input" placeholder="role_name" value={newRole} onChange={e => setNewRole(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleCreateRole} disabled={!newRole}>
                  <Plus size={16} /> 创建
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grant Wizard Modal */}
        {showGrant && (
          <div className="modal-overlay" onClick={closeGrantModal}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '680px' }}>
              <div className="modal-header">
                <div className="modal-title">权限授予 — 角色 {showGrant}</div>
                <button className="btn-ghost btn-icon" onClick={closeGrantModal} disabled={grantSubmitting || quickRevoking}><X size={18} /></button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '70vh', overflowY: 'auto', position: 'relative' }}>
                {(grantSubmitting || quickRevoking) && (
                  <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(1px)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <span className="spinner" /> {grantSubmitting ? '授权执行中...' : '撤销中...'}
                    </div>
                  </div>
                )}
                {/* Step 1: Category */}
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: '6px', fontWeight: 600 }}>① 权限类型</div>
                  <div className="priv-type-cards">
                    {(Object.keys(CATEGORY_META_UI) as Array<keyof typeof CATEGORY_META_UI>).map(cat => {
                      const meta = CATEGORY_META_UI[cat];
                      const active = grantCategory === cat;
                      return (
                        <div key={cat} className={`priv-type-card${active ? ' active' : ''}`}
                          style={active ? { '--card-border': meta.color, '--card-bg': meta.bg } as React.CSSProperties : {}}
                          onClick={() => { setGrantCategory(cat as PrivCategory); setGrantPrivs(new Set());
                            if (cat === 'system') setGrantScope('system'); else if (cat === 'catalog') setGrantScope('catalog'); else if (cat === 'function') setGrantScope('all_global'); else setGrantScope('database');
                          }}>
                          <span className="priv-icon" style={{ backgroundColor: meta.bg, color: meta.color }}>
                            {cat === 'system' ? <Shield size={14} /> : cat === 'ddl' ? <Wrench size={14} /> : cat === 'dml' ? <Database size={14} /> : cat === 'function' ? <Code size={14} /> : <FolderOpen size={14} />}
                          </span>
                          {meta.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Step 2: Privileges */}
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: '4px', fontWeight: 600 }}>② 具体权限</div>
                  <div className="priv-checks">
                    {PRIV_OPTIONS.map(opt => (
                      <label key={opt.value} className="priv-check-item">
                        <input type="checkbox" checked={grantPrivs.has(opt.value)} onChange={e => { const next = new Set(grantPrivs); e.target.checked ? next.add(opt.value) : next.delete(opt.value); setGrantPrivs(next); }} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                {/* Step 3: Scope */}
                {grantCategory !== 'system' && (
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: '6px', fontWeight: 600 }}>③ 作用范围</div>
                    <div className="cascade-row">
                      {grantCategory === 'catalog' ? (
                        <>
                          <div className="cascade-col"><label>范围</label><SearchableSelect value={grantScope} onChange={setGrantScope} placeholder="请选择范围..." options={[{ label: '指定 Catalog', value: 'catalog' }, { label: '所有 Catalogs', value: 'all_catalogs' }]} /></div>
                          {grantScope === 'catalog' && <div className="cascade-col"><label>Catalog</label><SearchableSelect value={grantCatalog} onChange={setGrantCatalog} placeholder="选择 Catalog" options={grantCatalogs.map(c => ({ label: c, value: c }))} /></div>}
                        </>
                      ) : grantCategory === 'function' ? (
                        <>
                          <div className="cascade-col"><label>范围</label><SearchableSelect value={grantScope} onChange={setGrantScope} placeholder="请选择范围..." options={[{ label: '所有全局函数', value: 'all_global' }, { label: '指定数据库内全部函数', value: 'all_in_db' }, { label: '指定函数', value: 'specific' }]} /></div>
                          {grantScope === 'all_in_db' && <div className="cascade-col"><label>Database</label><SearchableSelect value={grantDb} onChange={setGrantDb} placeholder="选择数据库" options={grantDbs.map(d => ({ label: d, value: d }))} /></div>}
                          {grantScope === 'specific' && <div className="cascade-col"><label>函数名</label><input value={grantSpecific} onChange={e => setGrantSpecific(e.target.value)} placeholder="function_name" /></div>}
                        </>
                      ) : (
                        <>
                          <div className="cascade-col"><label>Catalog</label><SearchableSelect value={grantCatalog} onChange={val => { setGrantCatalog(val); setGrantDb(''); setGrantDbs([]); setGrantTables([]); setGrantSpecific(''); loadGrantDbs(val); }} placeholder="选择 Catalog" options={grantCatalogs.map(c => ({ label: c, value: c }))} /></div>
                          <div className="cascade-col"><label>范围</label><SearchableSelect value={grantScope} onChange={val => { setGrantScope(val); setGrantPrivs(new Set()); setGrantSpecific(''); setGrantDbMulti(new Set()); setGrantSpecificMulti(new Set()); setGrantAllObjects(true); if (val !== '' && grantDbs.length === 0) loadGrantDbs(grantCatalog); }} placeholder="请选择范围..." options={[{ label: '数据库级别', value: 'database' }, { label: '对象级别', value: 'object' }]} /></div>
                          {grantScope === 'database' && <div className="cascade-col"><label>Database（可多选）</label><SearchableSelect multiple multiValue={grantDbMulti} onMultiChange={setGrantDbMulti} placeholder="选择数据库" options={grantDbs.map(d => ({ label: d, value: d }))} /></div>}
                          {grantScope === 'object' && (
                            <>
                              <div className="cascade-col"><label>Database</label><SearchableSelect value={grantDb} onChange={val => { setGrantDb(val); setGrantSpecificMulti(new Set()); setGrantTables([]); if (grantObjType.startsWith('specific_') && val) loadGrantTables(grantCatalog, val, grantObjType.replace('specific_', '')); }} placeholder="选择数据库" options={grantDbs.map(d => ({ label: d, value: d }))} /></div>
                              <div className="cascade-col"><label>对象范围</label><SearchableSelect value={grantObjType} onChange={val => { setGrantObjType(val); setGrantPrivs(new Set()); setGrantSpecificMulti(new Set()); setGrantTables([]); if (val.startsWith('specific_') && grantDb) loadGrantTables(grantCatalog, grantDb, val.replace('specific_', '')); }} placeholder="选择对象范围" options={[{ label: '全部表', value: 'all_table' }, { label: '指定表', value: 'specific_table' }, { label: '全部视图', value: 'all_view' }, { label: '指定视图', value: 'specific_view' }, { label: '全部物化视图', value: 'all_mv' }, { label: '指定物化视图', value: 'specific_mv' }]} /></div>
                              {grantObjType.startsWith('specific_') && (
                                <div className="cascade-col"><label>{grantObjType === 'specific_table' ? '表名' : grantObjType === 'specific_view' ? '视图名' : 'MV名'}（可多选）</label><SearchableSelect multiple multiValue={grantSpecificMulti} onMultiChange={setGrantSpecificMulti} placeholder={grantObjType === 'specific_table' ? '搜索表名...' : grantObjType === 'specific_view' ? '搜索视图...' : '搜索 MV...'} searchPlaceholder="输入关键字搜索..." options={grantTables.map(t => ({ label: t, value: t }))} /></div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
                {/* Existing Privileges */}
                {grantExisting.length > 0 && (
                  <div style={{ border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    <button onClick={() => setGrantExistingOpen(!grantExistingOpen)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <Eye size={13} style={{ color: 'var(--primary-500)' }} />
                      已有权限（{grantExisting.reduce((s, g) => s + g.totalCount, 0)} 项）
                      <ChevronDown size={14} style={{ marginLeft: 'auto', transform: grantExistingOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    </button>
                    {grantExistingOpen && (
                      <div style={{ maxHeight: '220px', overflowY: 'auto', padding: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {grantExisting.map((cg, i) => <CatalogSectionBlock key={i} group={cg} onRevoke={handleQuickRevoke} revoking={quickRevoking} />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* SQL Preview */}
                <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginBottom: '3px' }}>SQL 预览</div>
                  <code style={{ fontSize: '0.77rem', color: 'var(--primary-600)', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all', lineHeight: 1.8, display: 'block', whiteSpace: 'pre-wrap' }}>
                    {(buildGrantSQL('GRANT') || '请选择权限和范围...').split('; ').join(';\n')}
                  </code>
                </div>
              </div>
              <div className="modal-footer" style={{ gap: '8px' }}>
                <button className="btn btn-secondary" onClick={closeGrantModal} disabled={grantSubmitting || quickRevoking}>取消</button>
                <button className="btn btn-primary" disabled={grantPrivs.size === 0 || !buildGrantSQL('GRANT') || grantSubmitting || quickRevoking} onClick={() => handleGrantSubmit('GRANT')} style={{ minWidth: '120px' }}>
                  {grantSubmitting ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> 执行中...</> : <><Shield size={14} /> GRANT</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Assignment Transfer List Modal */}
        {showUserAssign && (
          <div className="modal-overlay" onClick={() => !userSubmitting && setShowUserAssign(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '680px' }}>
              <div className="modal-header">
                <div className="modal-title">分配角色给用户 — {showUserAssign}</div>
                <button className="btn-ghost btn-icon" onClick={() => !userSubmitting && setShowUserAssign(null)}><X size={18} /></button>
              </div>
              <div className="modal-body" style={{ position: 'relative' }}>
                {userSubmitting && (
                  <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(1px)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <span className="spinner" /> 更新中...
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'stretch' }}>
                  {/* Left - Available */}
                  <div style={{ border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', maxHeight: '340px' }}>
                    <div style={{ padding: '8px', borderBottom: '1px solid var(--border-secondary)', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>可选用户</div>
                    <div style={{ padding: '4px 8px' }}>
                      <input className="input" style={{ height: '28px', fontSize: '0.75rem' }} placeholder="搜索..." value={userLeftSearch} onChange={e => setUserLeftSearch(e.target.value)} />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
                      {allUsers.filter(u => !userRightSet.has(u.identity) && u.identity.toLowerCase().includes(userLeftSearch.toLowerCase())).map(u => (
                        <label key={u.identity} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px', fontSize: '0.78rem', cursor: 'pointer', borderRadius: '4px' }}
                          className="transfer-item">
                          <input type="checkbox" checked={userLeftChecked.has(u.identity)} onChange={e => { const next = new Set(userLeftChecked); e.target.checked ? next.add(u.identity) : next.delete(u.identity); setUserLeftChecked(next); }} />
                          {u.identity}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Center - Actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center', padding: '0 4px' }}>
                    <button className="btn btn-sm btn-secondary" title="添加到右侧" disabled={userLeftChecked.size === 0} onClick={() => {
                      const next = new Set(userRightSet);
                      userLeftChecked.forEach(u => next.add(u));
                      setUserRightSet(next); setUserLeftChecked(new Set());
                    }}><ChevronRight size={16} /></button>
                    <button className="btn btn-sm btn-secondary" title="移回左侧" disabled={userRightChecked.size === 0} onClick={() => {
                      const next = new Set(userRightSet);
                      userRightChecked.forEach(u => next.delete(u));
                      setUserRightSet(next); setUserRightChecked(new Set());
                    }}><ChevronLeft size={16} /></button>
                  </div>
                  {/* Right - Assigned */}
                  <div style={{ border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', maxHeight: '340px' }}>
                    <div style={{ padding: '8px', borderBottom: '1px solid var(--border-secondary)', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>已分配用户 ({userRightSet.size})</div>
                    <div style={{ padding: '4px 8px' }}>
                      <input className="input" style={{ height: '28px', fontSize: '0.75rem' }} placeholder="搜索..." value={userRightSearch} onChange={e => setUserRightSearch(e.target.value)} />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
                      {Array.from(userRightSet).filter(u => u.toLowerCase().includes(userRightSearch.toLowerCase())).map(u => (
                        <label key={u} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px', fontSize: '0.78rem', cursor: 'pointer', borderRadius: '4px' }}
                          className="transfer-item">
                          <input type="checkbox" checked={userRightChecked.has(u)} onChange={e => { const next = new Set(userRightChecked); e.target.checked ? next.add(u) : next.delete(u); setUserRightChecked(next); }} />
                          {u}
                          {!userOriginalSet.has(u) && <span style={{ fontSize: '0.6rem', color: 'var(--success-600)', marginLeft: 'auto' }}>+新增</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Diff summary */}
                {(userRightSet.size !== userOriginalSet.size || [...userRightSet].some(u => !userOriginalSet.has(u))) && (
                  <div style={{ marginTop: '8px', padding: '6px 10px', fontSize: '0.72rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)', color: 'var(--text-secondary)' }}>
                    变更：
                    {[...userRightSet].filter(u => !userOriginalSet.has(u)).length > 0 && <span style={{ color: 'var(--success-600)', marginLeft: '4px' }}>+{[...userRightSet].filter(u => !userOriginalSet.has(u)).length} 新增</span>}
                    {[...userOriginalSet].filter(u => !userRightSet.has(u)).length > 0 && <span style={{ color: 'var(--danger-600)', marginLeft: '4px' }}>-{[...userOriginalSet].filter(u => !userRightSet.has(u)).length} 移除</span>}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowUserAssign(null)} disabled={userSubmitting}>取消</button>
                <button className="btn btn-primary" onClick={handleUserSubmit} disabled={userSubmitting || (userRightSet.size === userOriginalSet.size && ![...userRightSet].some(u => !userOriginalSet.has(u)))}>
                  {userSubmitting ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> 保存中...</> : <><UserPlus size={14} /> 保存</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirm Modal */}
        {deleteConfirm && (
          <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
              <div className="modal-header">
                <div className="modal-title">确认删除</div>
                <button className="btn-ghost btn-icon" onClick={() => setDeleteConfirm(null)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <p style={{ margin: 0, fontSize: '0.88rem' }}>
                  确定要删除角色 <strong style={{ color: 'var(--danger-600)' }}>{deleteConfirm}</strong> 吗？此操作不可撤销。
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>取消</button>
                <button className="btn btn-danger" onClick={confirmDelete}>
                  <Trash2 size={14} /> 确认删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Privilege Detail Modal */}
        {showPrivDetail && (
          <PrivilegeDetailModal
            title={`角色 ${showPrivDetail.role}`}
            grants={showPrivDetail.grants}
            catalogGrants={showPrivDetail.catalogGrants}
            onClose={() => setShowPrivDetail(null)}
          />
        )}
      </div>
    </>
  );
}
