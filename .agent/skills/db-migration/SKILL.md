---
name: db-migration
description: 数据库表结构变更管理流程（Flyway 模式）。当需要新增表、修改列、添加索引等数据库 schema 变更时，必须使用此 skill。
---

# 数据库迁移管理（Flyway 模式）

本项目采用 **Flyway 风格**的数据库版本迁移管理。所有表结构变更必须通过迁移脚本完成，**严禁直接修改已执行的迁移文件或在代码中内联 DDL**。

## 核心规则

| 规则 | 说明 |
|------|------|
| ✅ 单一 Source of Truth | 所有 schema 定义仅存在于 `db/migrations/V*__.*.sql` |
| ✅ 不可变性 | 已执行的迁移文件 **禁止修改**（启动时 SHA-256 校验） |
| ✅ 只增不减 | 新变更必须创建新版本号的迁移文件 |
| ✅ 双方言 | 每个版本必须同时提供 `.mysql.sql` 和 `.sqlite.sql` |

## 目录结构

```
db/migrations/
├── V1__init_schema.mysql.sql       # 初始 schema（MySQL）
├── V1__init_schema.sqlite.sql      # 初始 schema（SQLite）
├── V2__add_xxx_table.mysql.sql     # 增量变更（MySQL）
├── V2__add_xxx_table.sqlite.sql    # 增量变更（SQLite）
└── ...
```

## 文件命名规范

```
V{版本号}__{描述}.{mysql|sqlite}.sql
```

- **版本号**：正整数，严格递增（V1, V2, V3...）
- **双下划线** `__`：分隔版本号和描述
- **描述**：使用下划线分隔的英文描述（如 `add_audit_logs`, `alter_users_add_email`）
- **方言后缀**：`.mysql.sql` 或 `.sqlite.sql`

## 新增迁移步骤

### 1. 确定下一个版本号

查看 `db/migrations/` 目录中现有文件，找到最大版本号 N，新版本号为 N+1。

### 2. 创建迁移文件

必须同时创建两个文件：

```bash
# MySQL 版本
db/migrations/V{N+1}__{description}.mysql.sql

# SQLite 版本
db/migrations/V{N+1}__{description}.sqlite.sql
```

### 3. 编写迁移 SQL

每个文件头部必须包含注释说明：

```sql
-- ============================================================
-- V{版本号} — {中文描述}
-- Flyway-style migration: DO NOT MODIFY after first execution.
-- ============================================================
```

#### 常见操作示例

**新增表：**

```sql
-- MySQL
CREATE TABLE IF NOT EXISTS new_table (
  id INTEGER PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  name VARCHAR(255) NOT NULL COMMENT '名称',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表描述';

-- SQLite
CREATE TABLE IF NOT EXISTS new_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**新增列：**

```sql
-- MySQL
ALTER TABLE existing_table ADD COLUMN email VARCHAR(255) DEFAULT '' COMMENT '邮箱';

-- SQLite
ALTER TABLE existing_table ADD COLUMN email TEXT DEFAULT '';
```

**新增索引：**

```sql
-- MySQL & SQLite（语法通用）
CREATE INDEX IF NOT EXISTS idx_table_column ON existing_table(column_name);
```

### 4. 验证

```bash
# 执行迁移
npm run db:migrate

# 查看迁移状态
npm run db:info

# 校验 checksum
npm run db:validate
```

### 5. 更新代码

如果新增了表，需要在 `src/lib/local-db.ts` 中添加对应的 TypeScript 接口和 CRUD 函数。

## 迁移引擎工作原理

引擎代码位于 `src/lib/migrator.ts`，应用启动时自动执行：

1. 确保 `schema_history` 表存在
2. 扫描 `db/migrations/V*.{dialect}.sql` 文件
3. 对比 `schema_history` 表中已执行的版本
4. **SHA-256 校验**：检查已执行文件是否被篡改（篡改则报错终止）
5. 按版本号升序执行未应用的迁移
6. 记录版本号、checksum、执行耗时到 `schema_history`

## 可用命令

| 命令 | 说明 |
|------|------|
| `npm run db:migrate` | 执行所有待执行迁移 |
| `npm run db:info` | 查看当前迁移状态 |
| `npm run db:validate` | 校验已执行迁移的 checksum |
| `npm run init-db` | 完整初始化（含创建数据库 + 迁移 + 管理员） |

## ⚠ 注意事项

1. **永远不要修改已执行的迁移文件**，这会导致 checksum 校验失败
2. **SQLite 限制**：SQLite 不支持 `DROP COLUMN`、`MODIFY COLUMN`，需要重建表（CREATE → INSERT → DROP → RENAME）
3. **测试迁移**：在本地 SQLite 测试通过后，再应用到 MySQL 环境
4. **回滚**：当前不支持自动回滚，如需回滚请创建新的反向迁移（如 V3 是 V2 的反向操作）
