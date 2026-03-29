# 数据库迁移版本管理 — 功能更新说明

> 分支：`feature/db-migrations`  
> 日期：2026-03-29

## 新增功能

### 1. Flyway 风格数据库迁移引擎

实现了基于 Flyway 模式的数据库版本迁移管理系统，取代原有的内联 DDL 和静态 SQL 文件方式。

**核心能力：**
- 版本化迁移文件：`V{版本号}__{描述}.{mysql|sqlite}.sql`
- SHA-256 Checksum 防篡改校验：已执行的迁移文件被修改时，启动报错终止
- `schema_history` 表记录每个迁移的版本号、checksum、执行耗时、成功状态
- 应用启动时自动执行所有待执行迁移，无需手动干预
- 幂等执行：重复启动不会重复执行已完成的迁移

**CLI 命令：**
- `npm run db:migrate` — 执行待执行迁移
- `npm run db:info` — 查看当前迁移状态（已执行/待执行版本）
- `npm run db:validate` — 校验已执行迁移文件的 checksum 完整性

### 2. db-migration 开发者 Skill

新增 `.agent/skills/db-migration/SKILL.md`，作为 Agent 辅助开发时的数据库变更流程指南，包含：
- 文件命名规范和目录结构
- 新增迁移的完整步骤（确定版本号 → 创建双方言文件 → 验证 → 更新代码）
- MySQL / SQLite 方言差异对照和常见操作示例

## 重构

### Schema 定义单一化

**Before（3 处重复定义）：**
- `db/migrations/001_init_mysql.sql` — 手动初始化使用
- `db/migrations/001_init_sqlite.sql` — 手动初始化使用
- `src/lib/local-db.ts` `initSchema()` — 应用启动内联 DDL（~200 行）

**After（1 处权威来源）：**
- `db/migrations/V1__init_schema.mysql.sql` — MySQL 完整 schema
- `db/migrations/V1__init_schema.sqlite.sql` — SQLite 完整 schema
- `src/lib/local-db.ts` — 调用 `runMigrations(db)` 委托给迁移引擎

### init-db.sh 简化

原脚本直接执行 SQL 文件并手动创建管理员，现简化为：
1. 创建数据库/目录（MySQL/SQLite）
2. 委托迁移引擎执行版本迁移
3. 自动创建管理员账号

## 文档更新

### README.md 重写

- 新增完整的 **5 步本地开发启动指南**（环境要求 → 克隆 → 安装 → 配置 → 启动）
- 新增 **常用命令表格**（dev/build/lint/db:migrate/db:info/db:validate）
- 新增 **数据库迁移** 章节
- 更新项目结构（添加 `migrator.ts`、`permissions.ts`、`proc-metadata.ts` 等新文件）
- 移除对不存在文件的引用（`pack-offline.sh`、`offline-install.sh`、`001_init_*.sql`）
- 移除过时的离线部署章节

### 清理

- 删除 `dist/` 目录（~70MB 过期离线打包产物）
- 删除旧迁移文件 `001_init_mysql.sql`、`001_init_sqlite.sql`

## 变更文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/lib/migrator.ts` | 新增 | Flyway 风格迁移引擎（扫描/校验/执行/记录） |
| `db/migrations/V1__init_schema.mysql.sql` | 新增 | MySQL V1 初始 schema（完整建表） |
| `db/migrations/V1__init_schema.sqlite.sql` | 新增 | SQLite V1 初始 schema（完整建表） |
| `.agent/skills/db-migration/SKILL.md` | 新增 | db-migration 开发者流程指南 |
| `src/lib/local-db.ts` | 修改 | 移除 ~200 行内联 DDL，改调 `runMigrations()` |
| `scripts/init-db.sh` | 修改 | 简化为 DB 创建 + 迁移委托 |
| `package.json` | 修改 | 新增 `db:migrate`、`db:info`、`db:validate` |
| `README.md` | 修改 | 重写（本地开发指南 + 项目结构更新） |
| `db/migrations/001_init_mysql.sql` | 删除 | 被 V1 替代 |
| `db/migrations/001_init_sqlite.sql` | 删除 | 被 V1 替代 |
