# MySQL 双后端支持

> 日期: 2026-03-28  
> 分支: `feature/mysql-backend` → merged to `main`  
> 提交: `e529b84`, `e6fd268`

## 变更概要

将本地元数据数据库从仅支持 SQLite 扩展为 **SQLite + MySQL 双后端**，通过 `config.yaml` 的 `database.type` 字段切换。容器化部署时使用外部 MySQL 存储，本地开发继续使用 SQLite。

## 核心变更

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/db-adapter.ts` | 统一异步 `DbAdapter` 接口，包含 `SqliteAdapter` 和 `MysqlAdapter` 两个实现 |

### 重写文件

| 文件 | 改动说明 |
|------|---------|
| `src/lib/local-db.ts` | 所有导出函数改为 async，通过 adapter 实例操作数据库，双后端 schema 自动初始化 |
| `src/lib/auth.ts` | `createSession`, `validateSession`, `requireAuth`, `requireRole` 等全部 async 化 |
| `src/lib/permissions.ts` | `hasPermission`, `requirePermission`, `getAllRolePermissions` 等全部 async 化 |

### 修改文件（添加 await）

涉及 25 个 API 路由文件和 `health-monitor.ts`，为 `requirePermission()`, `requireAuth()`, `getLocalDb()`, `getBlobCache()`, `setBlobCache()`, `recordAuditLog()` 等调用添加 `await`。

### SQL 兼容性处理

| 差异点 | SQLite 语法 | MySQL 语法 | 处理方式 |
|--------|------------|-----------|---------|
| UPSERT | `ON CONFLICT DO UPDATE SET x = excluded.x` | `ON DUPLICATE KEY UPDATE x = VALUES(x)` | `db.upsertSql()` 帮助方法 |
| 忽略重复 | `INSERT OR IGNORE` | `INSERT IGNORE` | `db.isMysql` 条件分支 |
| 子查询 DELETE | 直接引用同表 | 需派生表包装 | 统一使用派生表兼容写法 |

### 迁移文件同步

补充 `db/migrations/001_init_mysql.sql` 中缺失的两张表：
- `audit_logs` — 操作审计日志（含 3 个索引）
- `sys_role_permissions` — 角色权限配置

文件现包含全部 **21 张表**，与代码中 MySQL schema 完全一致。

## 统计

- **33 files changed**, +772 insertions, -910 deletions
- TypeScript 编译: **0 errors**

## 测试结论

| 场景 | 结果 |
|------|------|
| 登录（验证码 + 认证） | ✅ 通过 |
| 仪表盘加载 | ✅ 通过 |
| 数据库浏览页 | ✅ 通过 |
| 权限管理页 | ✅ 通过 |
| 系统用户页 | ✅ 通过 |
| 健康监控 | ✅ 通过 |

**结论：所有功能测试通过，无回退。**
