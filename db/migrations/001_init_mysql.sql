-- StarRocks Manager 初始化 Schema (MySQL)

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '连接ID',
  name VARCHAR(255) NOT NULL COMMENT '连接名称',
  host VARCHAR(255) NOT NULL COMMENT '主机地址',
  port INTEGER NOT NULL DEFAULT 9030 COMMENT '端口号',
  username VARCHAR(255) NOT NULL COMMENT '用户名',
  password VARCHAR(255) NOT NULL DEFAULT '' COMMENT '密码',
  default_db VARCHAR(255) DEFAULT '' COMMENT '默认数据库',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  last_used_at TIMESTAMP NULL COMMENT '最后使用时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='StarRocks连接配置';

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(255) PRIMARY KEY COMMENT '配置键',
  value TEXT NOT NULL COMMENT '配置值',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统设置';

CREATE TABLE IF NOT EXISTS db_metadata_cache (
  id           INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '缓存ID',
  connection_id VARCHAR(255) NOT NULL COMMENT '连接标识',
  db_name      VARCHAR(255) NOT NULL COMMENT '数据库名称',
  table_count  INTEGER NOT NULL DEFAULT 0 COMMENT '表数量',
  view_count   INTEGER NOT NULL DEFAULT 0 COMMENT '视图数量',
  mv_count     INTEGER NOT NULL DEFAULT 0 COMMENT '物化视图数量',
  cached_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间',
  UNIQUE KEY idx_conn_db (connection_id, db_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库元数据缓存';

CREATE TABLE IF NOT EXISTS users_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '用户列表JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户信息缓存';

CREATE TABLE IF NOT EXISTS roles_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '角色列表JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色信息缓存';

CREATE TABLE IF NOT EXISTS resource_groups_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '资源组列表JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源组信息缓存';

CREATE TABLE IF NOT EXISTS catalogs_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT 'Catalog列表JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Catalog信息缓存';

CREATE TABLE IF NOT EXISTS functions_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '函数列表JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='函数信息缓存';

CREATE TABLE IF NOT EXISTS variables_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '系统变量JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统变量缓存';

CREATE TABLE IF NOT EXISTS materialized_views_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '物化视图列表JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='物化视图信息缓存';

CREATE TABLE IF NOT EXISTS broker_load_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT 'Broker Load任务JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Broker Load任务缓存';

CREATE TABLE IF NOT EXISTS routine_load_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT 'Routine Load任务JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Routine Load任务缓存';

CREATE TABLE IF NOT EXISTS pipes_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT 'Pipe任务JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Pipe任务缓存';

CREATE TABLE IF NOT EXISTS tasks_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '任务列表JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务信息缓存';

CREATE TABLE IF NOT EXISTS task_runs_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识(sessionId::taskName)',
  data          LONGTEXT NOT NULL COMMENT '任务运行记录JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务运行记录缓存(按任务)';

CREATE TABLE IF NOT EXISTS task_runs_all_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '全量任务运行记录JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全量任务运行记录缓存';

CREATE TABLE IF NOT EXISTS nodes_cache (
  connection_id VARCHAR(255) PRIMARY KEY COMMENT '连接标识',
  data          LONGTEXT NOT NULL COMMENT '节点信息JSON数据',
  cached_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '缓存时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='集群节点信息缓存';

CREATE TABLE IF NOT EXISTS command_log (
  id            INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
  session_id    VARCHAR(255) NOT NULL COMMENT '会话标识',
  source        VARCHAR(255) NOT NULL DEFAULT 'unknown' COMMENT '来源模块',
  sql_text      TEXT NOT NULL COMMENT 'SQL语句内容',
  status        VARCHAR(50) NOT NULL DEFAULT 'success' COMMENT '执行状态(success/error)',
  error_message TEXT COMMENT '错误信息',
  row_count     INTEGER DEFAULT 0 COMMENT '返回行数',
  duration_ms   INTEGER DEFAULT 0 COMMENT '执行耗时(毫秒)',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '执行时间',
  INDEX idx_command_log_session_source (session_id, source),
  INDEX idx_command_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SQL命令执行日志';

CREATE TABLE IF NOT EXISTS sys_users (
  id            INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '用户ID',
  username      VARCHAR(255) NOT NULL UNIQUE COMMENT '登录用户名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希值(bcrypt)',
  display_name  VARCHAR(255) DEFAULT '' COMMENT '显示名称',
  role          VARCHAR(50) NOT NULL DEFAULT 'viewer' COMMENT '角色(admin/editor/viewer)',
  is_active     TINYINT DEFAULT 1 COMMENT '是否启用(1=启用,0=禁用)',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  last_login_at TIMESTAMP NULL COMMENT '最后登录时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表';

CREATE TABLE IF NOT EXISTS clusters (
  id          INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '集群ID',
  name        VARCHAR(255) NOT NULL UNIQUE COMMENT '集群名称',
  host        VARCHAR(255) NOT NULL COMMENT 'FE主机地址',
  port        INTEGER NOT NULL DEFAULT 9030 COMMENT 'FE查询端口',
  username    VARCHAR(255) NOT NULL COMMENT '连接用户名',
  password    VARCHAR(255) NOT NULL DEFAULT '' COMMENT '连接密码',
  default_db  VARCHAR(255) DEFAULT '' COMMENT '默认数据库',
  description TEXT DEFAULT NULL COMMENT '集群描述',
  is_active   TINYINT DEFAULT 1 COMMENT '是否为当前活跃集群(1=是,0=否)',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='StarRocks集群配置表';

CREATE TABLE IF NOT EXISTS user_cluster_access (
  user_id    INTEGER NOT NULL COMMENT '用户ID',
  cluster_id INTEGER NOT NULL COMMENT '集群ID',
  PRIMARY KEY (user_id, cluster_id),
  FOREIGN KEY (user_id)    REFERENCES sys_users(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户集群访问权限关联表';

CREATE TABLE IF NOT EXISTS sys_sessions (
  token       VARCHAR(255) PRIMARY KEY COMMENT '会话令牌',
  user_id     INTEGER NOT NULL COMMENT '用户ID',
  cluster_id  INTEGER COMMENT '当前活跃集群ID',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  expires_at  TIMESTAMP NOT NULL COMMENT '过期时间',
  FOREIGN KEY (user_id)    REFERENCES sys_users(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统会话表';
