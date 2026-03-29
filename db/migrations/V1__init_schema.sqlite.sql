-- ============================================================
-- StarRocks Manager — V1 Initial Schema (SQLite)
-- Flyway-style migration: DO NOT MODIFY after first execution.
-- ============================================================

-- 连接配置
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 9030,
  username TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  default_db TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);

-- 系统设置
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 数据库元数据缓存
CREATE TABLE IF NOT EXISTS db_metadata_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  db_name TEXT NOT NULL,
  table_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  mv_count INTEGER NOT NULL DEFAULT 0,
  cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(connection_id, db_name)
);

-- JSON Blob 缓存表
CREATE TABLE IF NOT EXISTS users_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS roles_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS resource_groups_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS catalogs_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS functions_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS variables_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS materialized_views_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS broker_load_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS routine_load_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pipes_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS task_runs_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS task_runs_all_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS nodes_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS show_proc_cache (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at DATETIME DEFAULT CURRENT_TIMESTAMP);

-- SQL命令执行日志
CREATE TABLE IF NOT EXISTS command_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  sql_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  row_count INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_command_log_session_source ON command_log(session_id, source);
CREATE INDEX IF NOT EXISTS idx_command_log_created ON command_log(created_at);

-- 系统用户表
CREATE TABLE IF NOT EXISTS sys_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

-- StarRocks集群配置表
CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 9030,
  username TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  default_db TEXT DEFAULT '',
  description TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户集群访问权限关联表
CREATE TABLE IF NOT EXISTS user_cluster_access (
  user_id INTEGER NOT NULL,
  cluster_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, cluster_id),
  FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

-- 系统会话表
CREATE TABLE IF NOT EXISTS sys_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  cluster_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL
);

-- 操作审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',
  level TEXT NOT NULL DEFAULT 'basic',
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);

-- 角色权限配置表
CREATE TABLE IF NOT EXISTS sys_role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (role, permission)
);
