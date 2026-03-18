'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePagination } from '@/hooks/usePagination';
import { Pagination } from '@/components/ui';
import PrivilegeDetailModal, { CatalogSectionBlock } from '@/components/PrivilegeDetailModal';
import SearchableSelect from '@/components/SearchableSelect';
import { classifyGrants, type CatalogGrant } from '@/utils/grantClassifier';
import {
  Users, Plus, Trash2, RefreshCw, Search, X,
  ChevronUp, ChevronDown, ChevronsUpDown, Clock, Key, ShieldCheck, ChevronRight, ChevronLeft,
  Shield, ShieldOff, UserPlus, Eye, Wrench, Database, Code, FolderOpen,
} from 'lucide-react';

const SYSTEM_ROLES = new Set(['root', 'cluster_admin', 'db_admin', 'user_admin', 'public']);

interface UserEntry {
  identity: string;   // e.g. 'root'@'%'
  grants: string[];
}

type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />;
  return dir === 'asc'
    ? <ChevronUp size={12} style={{ color: 'var(--primary-500)' }} />
    : <ChevronDown size={12} style={{ color: 'var(--primary-500)' }} />;
}

/** Parse 'username'@'host' into { user, host } */
function parseIdentity(identity: string): { user: string; host: string } {
  const m = identity.match(/^['`]?([^'`@]+)['`]?@['`]?([^'`]*)['`]?$/);
  if (m) return { user: m[1], host: m[2] };
  return { user: identity, host: '%' };
}

const DEFAULT_FORM = { username: '', host: '%', password: '', roles: '' };

export default function UsersPage() {
  const { session } = useSession();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [expandedGrants, setExpandedGrants] = useState<Set<string>>(new Set());
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null); // user identity pending delete
  // Privilege detail modal
  const [showPrivDetail, setShowPrivDetail] = useState<{ identity: string; grants: string[]; catalogGrants?: { grant: string; catalog: string }[] } | null>(null);

  // Grant privilege modal - wizard state
  const [showGrant, setShowGrant] = useState<string | null>(null);
  type PrivCategory = 'system' | 'ddl' | 'dml' | 'function' | 'catalog';
  const [grantCategory, setGrantCategory] = useState<PrivCategory>('dml');
  const [grantPrivs, setGrantPrivs] = useState<Set<string>>(new Set());
  const [grantCatalog, setGrantCatalog] = useState('default_catalog');
  const [grantDb, setGrantDb] = useState('');
  const [grantScope, setGrantScope] = useState('database'); // database | object
  const [grantObjType, setGrantObjType] = useState('all_table'); // all_table | specific_table | all_view | ...
  const [grantAllObjects, setGrantAllObjects] = useState(true); // true=all objects, false=specific
  const [grantSpecific, setGrantSpecific] = useState('');
  const [grantDbMulti, setGrantDbMulti] = useState<Set<string>>(new Set()); // multi-select DBs
  const [grantSpecificMulti, setGrantSpecificMulti] = useState<Set<string>>(new Set()); // multi-select tables
  const [grantCatalogs, setGrantCatalogs] = useState<string[]>([]);
  const [grantDbs, setGrantDbs] = useState<string[]>([]);
  const [grantTables, setGrantTables] = useState<string[]>([]);
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [grantExisting, setGrantExisting] = useState<import('@/utils/grantClassifier').CatalogGroup[]>([]);
  const [grantExistingOpen, setGrantExistingOpen] = useState(false);
  // 10-min client-side metadata cache
  const metaCacheRef = React.useRef<Map<string, { data: string[]; ts: number }>>(new Map());
  const META_TTL = 10 * 60 * 1000; // 10 minutes
  // Role assignment modal - Transfer List
  const [showRoleAssign, setShowRoleAssign] = useState<string | null>(null);
  const [allRoles, setAllRoles] = useState<string[]>([]);
  const [roleRightSet, setRoleRightSet] = useState<Set<string>>(new Set()); // assigned roles
  const [roleOriginalSet, setRoleOriginalSet] = useState<Set<string>>(new Set()); // original assigned
  const [roleLeftChecked, setRoleLeftChecked] = useState<Set<string>>(new Set());
  const [roleRightChecked, setRoleRightChecked] = useState<Set<string>>(new Set());
  const [roleLeftSearch, setRoleLeftSearch] = useState('');
  const [roleRightSearch, setRoleRightSearch] = useState('');
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  const fetchUsers = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const url = `/api/users?sessionId=${encodeURIComponent(session.sessionId)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setUsers(data.users || []);
        const ts = data.cachedAt
          ? new Date(data.cachedAt).toLocaleString('zh-CN', { hour12: false })
          : new Date().toLocaleString('zh-CN', { hour12: false });
        setLastRefreshed(ts);
        setFromCache(!!data.fromCache);
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [session]);

  useEffect(() => { if (session) fetchUsers(); }, [session, fetchUsers]);
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  // Open role assignment modal: fetch roles + parse existing
  async function openRoleAssignModal(userIdentity: string) {
    setShowRoleAssign(userIdentity);
    setRoleLeftChecked(new Set());
    setRoleRightChecked(new Set());
    setRoleLeftSearch('');
    setRoleRightSearch('');
    setRoleSubmitting(false);
    if (!session) return;
    // Parse the user's existing roles
    const thisUser = users.find(u => u.identity === userIdentity);
    const existingRoles = new Set<string>();
    if (thisUser) {
      thisUser.grants.forEach(g => {
        const roleMatch = g.match(/GRANT\s+((?:['`][^'`]+['`](?:\s*,\s*)?)+)\s+TO/i);
        if (roleMatch) {
          const roles = roleMatch[1].match(/['`]([^'`]+)['`]/g) || [];
          roles.forEach(r => existingRoles.add(r.replace(/['`]/g, '')));
        }
      });
    }
    setRoleRightSet(new Set(existingRoles));
    setRoleOriginalSet(new Set(existingRoles));
    // Fetch all roles if not cached
    if (allRoles.length === 0) {
      try {
        const res = await fetch(`/api/roles?sessionId=${encodeURIComponent(session.sessionId)}`);
        const data = await res.json();
        if (!data.error) {
          const names: string[] = (data.roles || []).map((r: Record<string, unknown>) =>
            String(r['Name'] || r['name'] || r['Value'] || Object.values(r)[0] || '')
          );
          setAllRoles(names);
        }
      } catch { /* ignore */ }
    }
  }

  async function handleCreate() {
    if (!session || !form.username) return;
    setCreating(true); setError('');
    try {
      const roles = form.roles ? form.roles.split(',').map(r => r.trim()).filter(Boolean) : [];
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          username: form.username,
          host: form.host,
          password: form.password,
          roles,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setShowCreate(false); setForm(DEFAULT_FORM); setSuccess('用户创建成功'); fetchUsers(); }
    } catch (err) { setError(String(err)); }
    finally { setCreating(false); }
  }

  async function handleDelete(identity: string) {
    if (!session) return;
    setDeleteConfirm(identity);
  }

  async function confirmDelete() {
    if (!session || !deleteConfirm) return;
    const { user, host } = parseIdentity(deleteConfirm);
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, username: user, host }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setSuccess('用户已删除'); fetchUsers(); }
    } catch (err) { setError(String(err)); }
    finally { setDeleteConfirm(null); }
  }

  function toggleRoles(identity: string) {
    setExpandedGrants(prev => {
      const next = new Set<string>();
      // Only allow ONE row expanded at a time
      if (!prev.has(identity)) next.add(identity);
      return next;
    });
  }

  const SYSTEM_USERS = new Set(['root', 'starrocks']);

  // ── Privilege category → available privileges ──
  const PRIV_OPTIONS: Record<string, { label: string; value: string }[]> = {
    system: [
      { label: 'OPERATE', value: 'OPERATE' },
      { label: 'NODE', value: 'NODE' },
      { label: 'CREATE RESOURCE GROUP', value: 'CREATE RESOURCE GROUP' },
    ],
    ddl: [
      { label: 'CREATE TABLE', value: 'CREATE TABLE' },
      { label: 'CREATE VIEW', value: 'CREATE VIEW' },
      { label: 'CREATE MV', value: 'CREATE MATERIALIZED VIEW' },
      { label: 'CREATE DATABASE', value: 'CREATE DATABASE' },
      { label: 'ALTER', value: 'ALTER' },
      { label: 'DROP', value: 'DROP' },
      { label: 'REFRESH', value: 'REFRESH' },
    ],
    dml: [
      { label: 'SELECT', value: 'SELECT' },
      { label: 'INSERT', value: 'INSERT' },
      { label: 'UPDATE', value: 'UPDATE' },
      { label: 'DELETE', value: 'DELETE' },
      { label: 'EXPORT', value: 'EXPORT' },
    ],
    function: [
      { label: 'USAGE', value: 'USAGE' },
      { label: 'CREATE FUNCTION', value: 'CREATE FUNCTION' },
      { label: 'DROP', value: 'DROP' },
    ],
    catalog: [
      { label: 'USAGE', value: 'USAGE' },
      { label: 'CREATE DATABASE', value: 'CREATE DATABASE' },
      { label: 'DROP', value: 'DROP' },
      { label: 'ALTER', value: 'ALTER' },
    ],
  };

  const CATEGORY_META_UI: Record<string, { label: string; color: string; bg: string }> = {
    system:   { label: '系统', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
    ddl:      { label: 'DDL',  color: '#d97706', bg: 'rgba(234,179,8,0.08)' },
    dml:      { label: 'DML',  color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    function: { label: '函数', color: '#0284c7', bg: 'rgba(2,132,199,0.08)' },
    catalog:  { label: 'Catalog', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  };

  async function openGrantModal(identity: string) {
    setShowGrant(identity);
    setGrantCategory('dml');
    setGrantPrivs(new Set());
    setGrantCatalog('default_catalog');
    setGrantDb('');
    setGrantScope('database');
    setGrantSpecific('');
    setGrantSubmitting(false);
    setGrantExisting([]);
    setGrantExistingOpen(false);
    setGrantTables([]);
    // Load catalogs + existing privileges + default_catalog databases
    if (session) {
      try {
        const [catRes, grantRes] = await Promise.all([
          fetch(`/api/catalogs?sessionId=${encodeURIComponent(session.sessionId)}`),
          fetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(identity)}`),
        ]);
        const catData = await catRes.json();
        if (catData.catalogs) {
          const names = catData.catalogs.map((c: Record<string, unknown>) =>
            String(c['CatalogName'] || c['Catalog'] || Object.values(c)[0])
          );
          // Sort: default_catalog first, then alphabetically
          names.sort((a: string, b: string) => {
            if (a === 'default_catalog') return -1;
            if (b === 'default_catalog') return 1;
            return a.localeCompare(b);
          });
          setGrantCatalogs(names);
          loadGrantDbs('default_catalog');
        }
        const grantData = await grantRes.json();
        if (grantData.grants) {
          setGrantExisting(classifyGrants(grantData.grants, grantData.catalogGrants));
        }
      } catch { /* ignore */ }
    }
  }

  async function loadGrantDbs(catalog: string) {
    if (!session) return;
    const cacheKey = `dbs:${catalog}`;
    const cached = metaCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < META_TTL) {
      setGrantDbs(cached.data);
      if (cached.data.length > 0) setGrantDb(cached.data[0]);
      return;
    }
    try {
      const res = await fetch(`/api/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, sql: `SHOW DATABASES FROM \`${catalog}\`` }),
      });
      const data = await res.json();
      if (data.rows) {
        const names = data.rows.map((r: Record<string, unknown>) =>
          String(r['Database'] || Object.values(r)[0])
        );
        setGrantDbs(names);
        if (names.length > 0) setGrantDb(names[0]);
        metaCacheRef.current.set(cacheKey, { data: names, ts: Date.now() });
      }
    } catch { /* ignore */ }
  }

  async function loadGrantTables(catalog: string, db: string, objType: string = 'table') {
    if (!session || !db) return;
    const cacheKey = `tables:${catalog}.${db}:${objType}`;
    const cached = metaCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < META_TTL) {
      setGrantTables(cached.data);
      return;
    }
    try {
      let sql = '';
      if (objType === 'view') {
        sql = `SHOW FULL TABLES FROM \`${catalog}\`.\`${db}\` WHERE Table_type = 'VIEW'`;
      } else if (objType === 'mv') {
        sql = `SHOW MATERIALIZED VIEWS FROM \`${db}\``;
      } else {
        sql = `SHOW TABLES FROM \`${catalog}\`.\`${db}\``;
      }
      const res = await fetch(`/api/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, sql }),
      });
      const data = await res.json();
      if (data.rows) {
        let names: string[];
        if (objType === 'mv') {
          names = data.rows.map((r: Record<string, unknown>) =>
            String(r['name'] || r['Name'] || Object.values(r)[0])
          );
        } else {
          names = data.rows.map((r: Record<string, unknown>) =>
            String(Object.values(r)[0])
          );
        }
        setGrantTables(names);
        metaCacheRef.current.set(cacheKey, { data: names, ts: Date.now() });
      } else {
        setGrantTables([]);
      }
    } catch { setGrantTables([]); }
  }

  function buildGrantSQL(action: 'GRANT' | 'REVOKE'): string {
    const privStr = Array.from(grantPrivs).join(', ');
    if (!privStr) return '';
    const toFrom = action === 'GRANT' ? 'TO' : 'FROM';

    if (grantCategory === 'system') {
      return `${action} ${privStr} ON SYSTEM ${toFrom} ${showGrant}`;
    }
    if (!grantScope) return '';
    if (grantCategory === 'catalog') {
      if (grantScope === 'all_catalogs') {
        return `${action} ${privStr} ON ALL CATALOGS ${toFrom} ${showGrant}`;
      }
      return `${action} ${privStr} ON CATALOG ${grantCatalog} ${toFrom} ${showGrant}`;
    }
    if (grantCategory === 'function') {
      if (grantScope === 'all_global') {
        return `${action} ${privStr} ON ALL GLOBAL FUNCTIONS ${toFrom} ${showGrant}`;
      }
      if (grantScope === 'all_in_db') {
        return `${action} ${privStr} ON ALL FUNCTIONS IN DATABASE ${grantDb} ${toFrom} ${showGrant}`;
      }
      return `${action} ${privStr} ON GLOBAL FUNCTION ${grantSpecific || '...'} ${toFrom} ${showGrant}`;
    }
    // DDL / DML — 2 scopes: database | object
    if (grantScope === 'database') {
      const dbs = Array.from(grantDbMulti);
      if (dbs.length === 0) return '';
      return dbs.map(db => `${action} ${privStr} ON DATABASE ${db} ${toFrom} ${showGrant}`).join('; ');
    }
    if (grantScope === 'object') {
      if (!grantDb) return '';
      if (grantObjType.startsWith('all_')) {
        const typeMap: Record<string, string> = { all_table: 'ALL TABLES', all_view: 'ALL VIEWS', all_mv: 'ALL MATERIALIZED VIEWS' };
        return `${action} ${privStr} ON ${typeMap[grantObjType] || 'ALL TABLES'} IN DATABASE ${grantDb} ${toFrom} ${showGrant}`;
      } else {
        const typeMap: Record<string, string> = { specific_table: 'TABLE', specific_view: 'VIEW', specific_mv: 'MATERIALIZED VIEW' };
        const items = Array.from(grantSpecificMulti);
        if (items.length === 0) return '';
        return items.map(item => `${action} ${privStr} ON ${typeMap[grantObjType] || 'TABLE'} ${grantDb}.${item} ${toFrom} ${showGrant}`).join('; ');
      }
    }
    return '';
  }

  async function handleGrantSubmit(action: 'GRANT' | 'REVOKE') {
    if (!session || !showGrant) return;
    const sql = buildGrantSQL(action);
    if (!sql) return;
    setGrantSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, sql }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSuccess(`${action === 'GRANT' ? '授权' : '撤销'}成功`);
        setShowGrant(null);
        fetchUsers(true);
      }
    } catch (err) { setError(String(err)); }
    finally { setGrantSubmitting(false); }
  }

  async function handleRoleSubmit() {
    if (!session || !showRoleAssign) return;
    setRoleSubmitting(true);
    setError('');
    try {
      const ops: Promise<Response>[] = [];
      // Grant new roles
      for (const role of roleRightSet) {
        if (!roleOriginalSet.has(role)) {
          ops.push(fetch('/api/grants', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.sessionId, action: 'grant_role', grantee: showRoleAssign, roleName: role }),
          }));
        }
      }
      // Revoke removed roles
      for (const role of roleOriginalSet) {
        if (!roleRightSet.has(role)) {
          ops.push(fetch('/api/grants', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.sessionId, action: 'revoke_role', grantee: showRoleAssign, roleName: role }),
          }));
        }
      }
      if (ops.length === 0) { setShowRoleAssign(null); return; }
      const results = await Promise.all(ops);
      const errors: string[] = [];
      for (const r of results) { const d = await r.json(); if (d.error) errors.push(d.error); }
      if (errors.length) setError(errors.join('; '));
      else {
        setSuccess(`角色变更完成（${ops.length} 项）`);
        setShowRoleAssign(null);
        fetchUsers(true);
      }
    } catch (err) { setError(String(err)); }
    finally { setRoleSubmitting(false); }
  }

  const filtered = users
    .filter(u => u.identity.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aUser = parseIdentity(a.identity).user;
      const bUser = parseIdentity(b.identity).user;
      const aSystem = SYSTEM_USERS.has(aUser) ? 0 : 1;
      const bSystem = SYSTEM_USERS.has(bUser) ? 0 : 1;
      if (aSystem !== bSystem) return aSystem - bSystem;
      return sortDir === 'asc'
        ? aUser.localeCompare(bUser)
        : bUser.localeCompare(aUser);
    });

  const pg = usePagination(filtered);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pg.resetPage(); }, [search, sortDir]);

  const systemCount = filtered.filter(u => SYSTEM_USERS.has(parseIdentity(u.identity).user)).length;
  const customCount = filtered.length - systemCount;

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">用户管理</h1>
            <p className="page-description">
              管理 StarRocks 数据库用户 · {users.length} 个用户
              {lastRefreshed && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} /> {fromCache ? '缓存时间：' : '刷新时间：'}{lastRefreshed}
                  {fromCache && <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--warning-600)', fontWeight: 600 }}>CACHE</span>}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => fetchUsers(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} style={{ animation: (loading || refreshing) ? 'spin 1s linear infinite' : 'none' }} /> {refreshing ? '刷新中...' : '刷新'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> 创建用户
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div style={{ color: 'var(--danger-500)', marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}
        {success && <div className="toast toast-success">{success}</div>}

        <div className="search-bar mb-4">
          <Search />
          <input
            className="input"
            placeholder="搜索用户名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><Users size={48} /><div className="empty-state-text">暂无用户</div></div>
        ) : (
          <div className="table-container fade-in">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '44px', textAlign: 'center' }}>#</th>
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      用户名 <SortIcon active dir={sortDir} />
                    </span>
                  </th>
                  <th>主机</th>
                  <th>类型</th>
                  <th>角色</th>
                  <th>权限项</th>
                  <th style={{ textAlign: 'center', width: '130px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pg.paginatedData.map((u, idx) => {
                  const globalIdx = (pg.page - 1) * pg.pageSize + idx;
                  const { user, host } = parseIdentity(u.identity);
                  const isSystem = SYSTEM_USERS.has(user);
                  const isExpanded = expandedGrants.has(u.identity);

                  // Parse grants into roles and privileges
                  const roleNames: string[] = [];
                  const privEntries: string[] = [];
                  u.grants.forEach(g => {
                    const roleMatch = g.match(/GRANT\s+((?:['`][^'`]+['`](?:\s*,\s*)?)+)\s+TO/i);
                    if (roleMatch) {
                      const roles = roleMatch[1].match(/['`]([^'`]+)['`]/g) || [];
                      roles.forEach(r => roleNames.push(r.replace(/['`]/g, '')));
                      return;
                    }
                    privEntries.push(g);
                  });

                  return (
                    <tr key={u.identity}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{globalIdx + 1}</td>

                      {/* Username */}
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: 'var(--radius-md)',
                            backgroundColor: isSystem ? 'rgba(139,92,246,0.1)' : 'rgba(37,99,235,0.08)',
                            color: isSystem ? 'var(--accent-600)' : 'var(--primary-600)',
                            borderWidth: '1px', borderStyle: 'solid', borderColor: isSystem ? 'rgba(139,92,246,0.2)' : 'rgba(37,99,235,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <Users size={13} />
                          </div>
                          <code style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                            {user}
                          </code>
                        </div>
                      </td>

                      {/* Host */}
                      <td>
                        <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-secondary)' }}>
                          {host || '%'}
                        </code>
                      </td>

                      {/* Type */}
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                          backgroundColor: isSystem ? 'rgba(139,92,246,0.08)' : 'var(--bg-secondary)',
                          color: isSystem ? 'var(--accent-600)' : 'var(--text-secondary)',
                          borderWidth: '1px', borderStyle: 'solid', borderColor: isSystem ? 'rgba(139,92,246,0.2)' : 'var(--border-secondary)',
                        }}>
                          {isSystem ? '● 系统' : '● 普通'}
                        </span>
                      </td>

                      {/* Roles column */}
                      <td>
                        {roleNames.length === 0 ? (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                            {(isExpanded ? roleNames : roleNames.slice(0, 2)).map((r, i) => (
                              <span key={i} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                                padding: '1px 7px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 500,
                                backgroundColor: 'rgba(22,163,74,0.08)', color: 'var(--success-600)',
                                borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(22,163,74,0.2)',
                                maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                <ShieldCheck size={9} />{r}
                              </span>
                            ))}
                            {!isExpanded && roleNames.length > 2 && (
                              <button
                                onClick={() => toggleRoles(u.identity)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '2px',
                                  padding: '1px 6px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 500,
                                  backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                                  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-secondary)', cursor: 'pointer',
                                }}
                              >
                                +{roleNames.length - 2}
                              </button>
                            )}
                            {isExpanded && roleNames.length > 2 && (
                              <button
                                onClick={() => toggleRoles(u.identity)}
                                style={{ fontSize: '0.68rem', color: 'var(--primary-600)', background: 'none', border: 'none', cursor: 'pointer', padding: '0' }}
                              >
                                ▲
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Privileges column */}
                      <td>
                        {privEntries.length === 0 ? (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>—</span>
                        ) : (
                          <button
                            onClick={async () => {
                              try {
                                const gRes = await fetch(`/api/grants?sessionId=${encodeURIComponent(session!.sessionId)}&target=${encodeURIComponent(u.identity)}`);
                                const gData = await gRes.json();
                                setShowPrivDetail({
                                  identity: u.identity,
                                  grants: gData.grants || privEntries,
                                  catalogGrants: gData.catalogGrants,
                                });
                              } catch {
                                setShowPrivDetail({ identity: u.identity, grants: privEntries });
                              }
                            }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 500,
                              backgroundColor: 'rgba(37,99,235,0.06)', color: 'var(--primary-600)',
                              borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(37,99,235,0.15)',
                              cursor: 'pointer', transition: 'all 0.15s',
                            }}
                          >
                            <Key size={10} />{privEntries.length} 项权限
                            <Eye size={10} style={{ marginLeft: '2px', opacity: 0.6 }} />
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                          <button
                            disabled={isSystem}
                            onClick={() => !isSystem && openGrantModal(u.identity)}
                            title={isSystem ? '系统用户请通过命令行管理' : '授权'}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '3px 10px', borderRadius: '6px', fontSize: '0.75rem',
                              border: `1px solid ${isSystem ? 'var(--border-secondary)' : 'var(--primary-200)'}`,
                              backgroundColor: isSystem ? 'transparent' : 'var(--primary-50)',
                              color: isSystem ? 'var(--text-tertiary)' : 'var(--primary-600)',
                              cursor: isSystem ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s',
                              fontWeight: 500, whiteSpace: 'nowrap',
                              opacity: isSystem ? 0.4 : 1,
                            }}
                          >
                            <Shield size={12} /> 授权
                          </button>
                          <button
                            disabled={isSystem}
                            onClick={() => !isSystem && openRoleAssignModal(u.identity)}
                            title={isSystem ? '系统用户请通过命令行管理' : '分配角色'}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '3px 10px', borderRadius: '6px', fontSize: '0.75rem',
                              border: isSystem ? '1px solid var(--border-secondary)' : '1px solid rgba(20,184,166,0.3)',
                              backgroundColor: isSystem ? 'transparent' : 'rgba(20,184,166,0.06)',
                              color: isSystem ? 'var(--text-tertiary)' : '#0d9488',
                              cursor: isSystem ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s',
                              fontWeight: 500, whiteSpace: 'nowrap',
                              opacity: isSystem ? 0.4 : 1,
                            }}
                          >
                            <UserPlus size={12} /> 角色
                          </button>
                          <span style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-secondary)', margin: '0 2px' }} />
                          <button
                            className="btn-ghost btn-icon"
                            disabled={isSystem}
                            onClick={() => !isSystem && handleDelete(u.identity)}
                            title={isSystem ? '系统用户不可删除' : '删除用户'}
                            style={{
                              color: isSystem ? 'var(--text-quaternary, #d1d5db)' : 'var(--danger-400, #f87171)',
                              padding: '4px', borderRadius: '6px',
                              transition: 'all 0.15s',
                              opacity: isSystem ? 0.3 : 0.7,
                              cursor: isSystem ? 'not-allowed' : 'pointer',
                            }}
                            onMouseEnter={e => { if (!isSystem) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--danger-500, #ef4444)'; e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.08)'; } }}
                            onMouseLeave={e => { if (!isSystem) { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.color = 'var(--danger-400, #f87171)'; e.currentTarget.style.backgroundColor = 'transparent'; } }}
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

            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--border-secondary)',
              fontSize: '0.78rem', color: 'var(--text-tertiary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            }}>
              <span>
                共 <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> 个用户
                {search && ` (过滤自 ${users.length} 个)`}
                <span style={{ marginLeft: '12px', color: 'var(--accent-600)' }}>系统 {systemCount}</span>
                <span style={{ marginLeft: '8px', color: 'var(--primary-600)' }}>普通 {customCount}</span>
              </span>
              <Pagination page={pg.page} pageSize={pg.pageSize} totalPages={pg.totalPages} totalItems={pg.totalItems} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
            </div>
          </div>
        )}

        {/* Create User Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">创建用户</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowCreate(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">用户名 <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                    <input className="input" placeholder="username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">主机</label>
                    <input className="input" placeholder="%" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">密码</label>
                  <input className="input" type="password" placeholder="（留空则不设密码）" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">授予角色（逗号分隔，可选）</label>
                  <input className="input" placeholder="role1, role2" value={form.roles} onChange={e => setForm({ ...form, roles: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !form.username}>
                  {creating ? <span className="spinner" /> : <Plus size={16} />} 创建
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grant Privilege Modal - Wizard */}
        {showGrant && (
          <div className="modal-overlay" onClick={() => setShowGrant(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '680px' }}>
              <div className="modal-header">
                <div className="modal-title">权限授予 — {showGrant}</div>
                <button className="btn-ghost btn-icon" onClick={() => setShowGrant(null)}><X size={18} /></button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '70vh', overflowY: 'auto' }}>
                {/* Step 1: Category */}
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: '6px', fontWeight: 600 }}>① 权限类型</div>
                  <div className="priv-type-cards">
                    {(Object.keys(CATEGORY_META_UI) as Array<keyof typeof CATEGORY_META_UI>).map(cat => {
                      const meta = CATEGORY_META_UI[cat];
                      const active = grantCategory === cat;
                      return (
                        <div
                          key={cat}
                          className={`priv-type-card${active ? ' active' : ''}`}
                          style={active ? { '--card-border': meta.color, '--card-bg': meta.bg } as React.CSSProperties : {}}
                          onClick={() => {
                            setGrantCategory(cat as PrivCategory);
                            setGrantPrivs(new Set());
                            // Reset scope
                            if (cat === 'system') setGrantScope('system');
                            else if (cat === 'catalog') setGrantScope('catalog');
                            else if (cat === 'function') setGrantScope('all_global');
                            else setGrantScope('database');
                          }}
                        >
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
                    {(PRIV_OPTIONS[grantCategory] || []).map(opt => (
                      <label key={opt.value} className="priv-check-item">
                        <input
                          type="checkbox"
                          checked={grantPrivs.has(opt.value)}
                          onChange={e => {
                            const next = new Set(grantPrivs);
                            e.target.checked ? next.add(opt.value) : next.delete(opt.value);
                            setGrantPrivs(next);
                          }}
                        />
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
                          <div className="cascade-col">
                            <label>范围</label>
                            <SearchableSelect
                              value={grantScope}
                              onChange={setGrantScope}
                              placeholder="请选择范围..."
                              options={[
                                { label: '指定 Catalog', value: 'catalog' },
                                { label: '所有 Catalogs', value: 'all_catalogs' },
                              ]}
                            />
                          </div>
                          {grantScope === 'catalog' && (
                            <div className="cascade-col">
                              <label>Catalog</label>
                              <SearchableSelect
                                value={grantCatalog}
                                onChange={setGrantCatalog}
                                placeholder="选择 Catalog"
                                options={grantCatalogs.map(c => ({ label: c, value: c }))}
                              />
                            </div>
                          )}
                        </>
                      ) : grantCategory === 'function' ? (
                        <>
                          <div className="cascade-col">
                            <label>范围</label>
                            <SearchableSelect
                              value={grantScope}
                              onChange={setGrantScope}
                              placeholder="请选择范围..."
                              options={[
                                { label: '所有全局函数', value: 'all_global' },
                                { label: '指定数据库内全部函数', value: 'all_in_db' },
                                { label: '指定函数', value: 'specific' },
                              ]}
                            />
                          </div>
                          {grantScope === 'all_in_db' && (
                            <div className="cascade-col">
                              <label>Database</label>
                              <SearchableSelect
                                value={grantDb}
                                onChange={setGrantDb}
                                placeholder="选择数据库"
                                options={grantDbs.map(d => ({ label: d, value: d }))}
                              />
                            </div>
                          )}
                          {grantScope === 'specific' && (
                            <div className="cascade-col">
                              <label>函数名</label>
                              <input value={grantSpecific} onChange={e => setGrantSpecific(e.target.value)} placeholder="function_name" />
                            </div>
                          )}
                        </>
                      ) : (
                        /* DDL / DML — simplified 2-level */
                        <>
                          <div className="cascade-col">
                            <label>Catalog</label>
                            <SearchableSelect
                              value={grantCatalog}
                              onChange={val => {
                                setGrantCatalog(val);
                                setGrantDb('');
                                setGrantDbs([]);
                                setGrantTables([]);
                                setGrantSpecific('');
                                loadGrantDbs(val);
                              }}
                              placeholder="选择 Catalog"
                              options={grantCatalogs.map(c => ({ label: c, value: c }))}
                            />
                          </div>
                          <div className="cascade-col">
                            <label>范围</label>
                            <SearchableSelect
                              value={grantScope}
                              onChange={val => {
                                setGrantScope(val);
                                setGrantSpecific('');
                                setGrantDbMulti(new Set());
                                setGrantSpecificMulti(new Set());
                                setGrantAllObjects(true);
                                if (val !== '' && grantDbs.length === 0) {
                                  loadGrantDbs(grantCatalog);
                                }
                              }}
                              placeholder="请选择范围..."
                              options={[
                                { label: '数据库级别', value: 'database' },
                                { label: '对象级别', value: 'object' },
                              ]}
                            />
                          </div>
                          {/* 数据库级别: multi-select */}
                          {grantScope === 'database' && (
                            <div className="cascade-col">
                              <label>Database（可多选）</label>
                              <SearchableSelect
                                multiple
                                multiValue={grantDbMulti}
                                onMultiChange={setGrantDbMulti}
                                placeholder="选择数据库"
                                options={grantDbs.map(d => ({ label: d, value: d }))}
                              />
                            </div>
                          )}
                          {/* 对象级别: DB + type + all/specific */}
                          {grantScope === 'object' && (
                            <>
                              <div className="cascade-col">
                                <label>Database</label>
                                <SearchableSelect
                                  value={grantDb}
                                  onChange={val => {
                                    setGrantDb(val);
                                    setGrantSpecificMulti(new Set());
                                    setGrantTables([]);
                                    if (grantObjType.startsWith('specific_') && val) {
                                      const t = grantObjType.replace('specific_', '');
                                      loadGrantTables(grantCatalog, val, t);
                                    }
                                  }}
                                  placeholder="选择数据库"
                                  options={grantDbs.map(d => ({ label: d, value: d }))}
                                />
                              </div>
                              <div className="cascade-col">
                                <label>对象范围</label>
                                <SearchableSelect
                                  value={grantObjType}
                                  onChange={val => {
                                    setGrantObjType(val);
                                    setGrantSpecificMulti(new Set());
                                    setGrantTables([]);
                                    if (val.startsWith('specific_') && grantDb) {
                                      const t = val.replace('specific_', '');
                                      loadGrantTables(grantCatalog, grantDb, t);
                                    }
                                  }}
                                  placeholder="选择对象范围"
                                  options={[
                                    { label: '全部表', value: 'all_table' },
                                    { label: '指定表', value: 'specific_table' },
                                    { label: '全部视图', value: 'all_view' },
                                    { label: '指定视图', value: 'specific_view' },
                                    { label: '全部物化视图', value: 'all_mv' },
                                    { label: '指定物化视图', value: 'specific_mv' },
                                  ]}
                                />
                              </div>
                              {grantObjType.startsWith('specific_') && (
                                <div className="cascade-col">
                                  <label>{grantObjType === 'specific_table' ? '表名' : grantObjType === 'specific_view' ? '视图名' : 'MV名'}（可多选）</label>
                                  <SearchableSelect
                                    multiple
                                    multiValue={grantSpecificMulti}
                                    onMultiChange={setGrantSpecificMulti}
                                    placeholder={grantObjType === 'specific_table' ? '搜索表名...' : grantObjType === 'specific_view' ? '搜索视图...' : '搜索 MV...'}
                                    searchPlaceholder="输入关键字搜索..."
                                    options={grantTables.map(t => ({ label: t, value: t }))}
                                  />
                                </div>
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
                    <button
                      onClick={() => setGrantExistingOpen(!grantExistingOpen)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '7px 12px', background: 'var(--bg-tertiary)', border: 'none',
                        cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)',
                      }}
                    >
                      <Eye size={13} style={{ color: 'var(--primary-500)' }} />
                      已有权限（{grantExisting.reduce((s, g) => s + g.totalCount, 0)} 项）
                      <ChevronDown size={14} style={{ marginLeft: 'auto', transform: grantExistingOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    </button>
                    {grantExistingOpen && (
                      <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {grantExisting.map((cg, i) => <CatalogSectionBlock key={i} group={cg} />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* SQL Preview */}
                <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginBottom: '3px' }}>SQL 预览</div>
                  <code style={{ fontSize: '0.77rem', color: 'var(--primary-600)', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all', lineHeight: 1.6 }}>
                    {buildGrantSQL('GRANT') || '请选择权限和范围...'}
                  </code>
                </div>
              </div>
              <div className="modal-footer" style={{ gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => setShowGrant(null)}>取消</button>
                <button
                  className="btn"
                  disabled={grantPrivs.size === 0 || grantSubmitting}
                  style={{ backgroundColor: 'var(--danger-500, #ef4444)', color: '#fff', border: 'none' }}
                  onClick={() => handleGrantSubmit('REVOKE')}
                >
                  {grantSubmitting ? <span className="spinner" /> : <ShieldOff size={14} />} REVOKE
                </button>
                <button
                  className="btn btn-primary"
                  disabled={grantPrivs.size === 0 || grantSubmitting}
                  onClick={() => handleGrantSubmit('GRANT')}
                >
                  {grantSubmitting ? <span className="spinner" /> : <Shield size={14} />} GRANT
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Role Assignment Modal - Transfer List */}
        {showRoleAssign && (() => {
          const availableRoles = allRoles.filter(r => !SYSTEM_ROLES.has(r) && !roleRightSet.has(r));
          const filteredLeft = availableRoles.filter(r => !roleLeftSearch || r.toLowerCase().includes(roleLeftSearch.toLowerCase()));
          const rightRoles = Array.from(roleRightSet);
          const filteredRight = rightRoles.filter(r => !roleRightSearch || r.toLowerCase().includes(roleRightSearch.toLowerCase()));
          // SQL preview
          const sqlLines: string[] = [];
          for (const role of roleRightSet) {
            if (!roleOriginalSet.has(role)) sqlLines.push(`GRANT '${role}' TO ${showRoleAssign}`);
          }
          for (const role of roleOriginalSet) {
            if (!roleRightSet.has(role)) sqlLines.push(`REVOKE '${role}' FROM ${showRoleAssign}`);
          }


          return (
            <div className="modal-overlay" onClick={() => setShowRoleAssign(null)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '820px', padding: 0 }}>
                <div style={{ padding: '16px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="modal-title">角色分配 — {showRoleAssign}</div>
                  <button className="btn-ghost btn-icon" onClick={() => setShowRoleAssign(null)}><X size={18} /></button>
                </div>

                <div style={{ padding: '0 20px 12px' }}>
                  <div className="transfer-container">
                    {/* Left Panel - Available Roles */}
                    <div className="transfer-panel">
                      <div className="transfer-panel-header">
                        <input
                          type="checkbox"
                          checked={filteredLeft.length > 0 && filteredLeft.every(r => roleLeftChecked.has(r))}
                          onChange={e => {
                            if (e.target.checked) setRoleLeftChecked(new Set(filteredLeft));
                            else setRoleLeftChecked(new Set());
                          }}
                        />
                        <Shield size={13} />
                        <span>可分配角色</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>
                          {roleLeftChecked.size > 0 ? `${roleLeftChecked.size}/` : ''}{filteredLeft.length} 个
                        </span>
                      </div>
                      <div className="transfer-panel-search">
                        <input placeholder="搜索角色..." value={roleLeftSearch} onChange={e => setRoleLeftSearch(e.target.value)} />
                      </div>
                      <div className="transfer-panel-list">
                        {filteredLeft.length === 0 ? (
                          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>暂无可分配角色</div>
                        ) : filteredLeft.map(r => (
                          <div
                            key={r}
                            className={`transfer-item${roleLeftChecked.has(r) ? ' checked' : ''}`}
                            onClick={() => {
                              const next = new Set(roleLeftChecked);
                              next.has(r) ? next.delete(r) : next.add(r);
                              setRoleLeftChecked(next);
                            }}
                          >
                            <input type="checkbox" checked={roleLeftChecked.has(r)} readOnly />
                            <span className="transfer-item-name">{r}</span>
                          </div>
                        ))}
                      </div>
                      <div className="transfer-panel-footer">
                        共 {availableRoles.length} 个可用
                      </div>
                    </div>

                    {/* Middle Actions */}
                    <div className="transfer-actions">
                      <button
                        disabled={roleLeftChecked.size === 0}
                        title="分配选中角色"
                        onClick={() => {
                          const next = new Set(roleRightSet);
                          for (const r of roleLeftChecked) next.add(r);
                          setRoleRightSet(next);
                          setRoleLeftChecked(new Set());
                        }}
                      >
                        <ChevronRight size={16} />
                      </button>
                      <button
                        disabled={roleRightChecked.size === 0}
                        title="撤销选中角色"
                        onClick={() => {
                          const next = new Set(roleRightSet);
                          for (const r of roleRightChecked) next.delete(r);
                          setRoleRightSet(next);
                          setRoleRightChecked(new Set());
                        }}
                      >
                        <ChevronLeft size={16} />
                      </button>
                    </div>

                    {/* Right Panel - Assigned Roles */}
                    <div className="transfer-panel">
                      <div className="transfer-panel-header">
                        <input
                          type="checkbox"
                          checked={filteredRight.length > 0 && filteredRight.every(r => roleRightChecked.has(r))}
                          onChange={e => {
                            if (e.target.checked) setRoleRightChecked(new Set(filteredRight));
                            else setRoleRightChecked(new Set());
                          }}
                        />
                        <ShieldCheck size={13} />
                        <span>已分配角色</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>
                          {roleRightChecked.size > 0 ? `${roleRightChecked.size}/` : ''}{filteredRight.length} 个
                        </span>
                      </div>
                      <div className="transfer-panel-search">
                        <input placeholder="搜索角色..." value={roleRightSearch} onChange={e => setRoleRightSearch(e.target.value)} />
                      </div>
                      <div className="transfer-panel-list">
                        {filteredRight.length === 0 ? (
                          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>暂无已分配角色</div>
                        ) : filteredRight.map(r => (
                          <div
                            key={r}
                            className={`transfer-item${roleRightChecked.has(r) ? ' checked' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={roleRightChecked.has(r)}
                              onChange={() => {
                                const next = new Set(roleRightChecked);
                                next.has(r) ? next.delete(r) : next.add(r);
                                setRoleRightChecked(next);
                              }}
                            />
                            <span className="transfer-item-name" onClick={() => {
                              const next = new Set(roleRightChecked);
                              next.has(r) ? next.delete(r) : next.add(r);
                              setRoleRightChecked(next);
                            }}>{r}</span>
                            {!roleOriginalSet.has(r) && (
                              <span style={{ fontSize: '0.6rem', padding: '0 5px', borderRadius: '999px', backgroundColor: 'rgba(59,130,246,0.08)', color: 'var(--primary-500)', fontWeight: 600 }}>新增</span>
                            )}
                            <button
                              className="btn-ghost btn-icon"
                              style={{ padding: '2px', marginLeft: '2px' }}
                              title="查看权限"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!session) return;
                                try {
                                  const res = await fetch(`/api/grants?sessionId=${encodeURIComponent(session.sessionId)}&target=${encodeURIComponent(`ROLE '${r}'`)}`);
                                  const data = await res.json();
                                  if (!data.error) {
                                    setShowPrivDetail({ identity: `角色: ${r}`, grants: data.grants || [], catalogGrants: data.catalogGrants });
                                  }
                                } catch { /* ignore */ }
                              }}
                            >
                              <Eye size={13} style={{ color: 'var(--text-tertiary)' }} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="transfer-panel-footer">
                        共 {rightRoles.length} 个已分配
                      </div>
                    </div>
                  </div>

                  {/* SQL Preview */}
                  {sqlLines.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)', maxHeight: '80px', overflowY: 'auto' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginBottom: '3px' }}>SQL 预览 ({sqlLines.length} 条)</div>
                      {sqlLines.map((s, i) => (
                        <div key={i} style={{ fontSize: '0.72rem', color: s.startsWith('REVOKE') ? 'var(--danger-500)' : 'var(--primary-600)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>{s}</div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border-secondary)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button className="btn btn-secondary" onClick={() => setShowRoleAssign(null)}>取消</button>
                  <button className="btn btn-primary" onClick={handleRoleSubmit} disabled={roleSubmitting || sqlLines.length === 0}>
                    {roleSubmitting ? <span className="spinner" /> : <UserPlus size={16} />} 确定
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
              <div className="modal-header">
                <div className="modal-title" style={{ color: 'var(--danger-500, #ef4444)' }}>
                  <Trash2 size={18} style={{ marginRight: '6px' }} /> 确认删除用户
                </div>
                <button className="btn-ghost btn-icon" onClick={() => setDeleteConfirm(null)}><X size={18} /></button>
              </div>
              <div className="modal-body" style={{ padding: '20px' }}>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                  确定要删除用户 <code style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-tertiary)', fontWeight: 600 }}>{deleteConfirm}</code> 吗？
                </p>
                <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  此操作不可撤销，该用户的所有权限也将被移除。
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>取消</button>
                <button
                  className="btn"
                  style={{
                    backgroundColor: 'var(--danger-500, #ef4444)', color: '#fff', border: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                  }}
                  onClick={confirmDelete}
                >
                  <Trash2 size={14} /> 确认删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Privilege Detail Modal */}
        {showPrivDetail && (
          <PrivilegeDetailModal
            title={showPrivDetail.identity}
            grants={showPrivDetail.grants}
            catalogGrants={showPrivDetail.catalogGrants}
            onClose={() => setShowPrivDetail(null)}
          />
        )}
      </div>
    </>
  );
}
