# 高级诊断 + 合并诊断 — 功能更新说明

> 分支：`feature/show-proc-advanced`  
> 日期：2026-03-29

## 新增功能

### 1. 高级诊断 (SHOW PROC)

基于 StarRocks 3.5 官方文档，将系统 `SHOW PROC` 命令可视化为结构化的诊断工具。

**目录视图：**
- 按 5 个分组（集群基础设施、数据与元数据、任务与作业、查询与监控、资源管理）展示 18 个 PROC 路径
- 每个路径卡片展示名称、路径、描述，点击进入详情查看器

**深层路径下钻：**
- 支持多级下钻导航（如 `/dbs → /dbs/{dbId} → /dbs/{dbId}/{tableId} → partitions`）
- 按官方层级规范控制最大下钻深度，自动跳过不可钻取行（VIEW / SCHEMA 等类型）
- `/dbs/{dbId}/{tableId}` 深度提供固定子节点选择（partitions / temp_partitions / index_schema）

**交互式面包屑导航：**
- 下钻时显示完整路径链，每个层级可点击跳转
- 支持「返回上级」和「返回目录」两种返回模式

**后端安全查询：**
- 基于静态白名单 `ALLOWED_PROC_PATHS` 校验请求路径，杜绝 SQL 注入
- 下钻路径使用正则 `/^\/[a-zA-Z_][a-zA-Z0-9_\/]*$/` 严格校验
- 查询结果缓存至本地数据库 `show_proc_cache` 表，支持强制刷新

**智能列格式化：**
- IP 地址 / 端口：等宽字体（JetBrains Mono）
- 系统状态 (Alive)：在线（绿色 Badge）/ 离线（红色 Badge）
- 百分比列：自动渲染进度条 + 阈值变色（60% 警告 / 80% 危险）
- 角色 (Role)：LEADER 黄色高亮 / FOLLOWER 蓝色
- 布尔值 / ID 列：语义化颜色和字体处理

### 2. 合并诊断 (Compaction Score)

基于 `information_schema.partitions_meta` 的分区合并健康度查看器。

**数据查询：**
- 查询 15 个关键列（DB_NAME, TABLE_NAME, PARTITION_NAME, DATA_SIZE, AVG_CS, MAX_CS 等）
- 支持服务端排序（白名单列校验）和分页（默认 10 条/页，可选 10/20/50/100/200）
- 数据库筛选通过 `SHOW DATABASES` 实时获取，过滤系统库并按字母排序

**表格功能：**
- 前两列（Database, Table）使用 `position: sticky` 冻结显示
- 分页切换时使用半透明遮罩层防止表格抖动（Jitter-free loading）
- 支持 CSV 导出（UTF-8 BOM，Excel 兼容）

### 3. 共享 UI 组件增强

**MiniSelect 分页下拉组件：**
- 替代 `Pagination` 组件中的原生 `<select>`，保持全站 UI 一致性
- 向上弹出（upward popover）、选中项 ✓ 标记、点击外部关闭
- 通过 Portal 渲染，避免被父容器 `overflow: hidden` 裁切

**SearchableSelect 组件应用：**
- 「物化视图管理」页面：数据库筛选 + 刷新状态筛选（替换 2 个原生 select）
- 「合并诊断」页面：数据库筛选（固定 160px 宽度）

## UI Pro Max 规范对齐

- **卡片化头部设计**：高级诊断详情页标题区域重构为带阴影的卡片容器，左侧渐变图标徽章（42px）、标题+副标题层级清晰
- **工具栏标准化**（`.table-toolbar`）：所有页面统一为「搜索 → 筛选 → 操作按钮」三段式布局
- **命名中文化**：Compaction Score → 合并诊断（菜单 + 页面标题 + 面包屑 + 空状态）
- **按钮文案优化**：CSV → 导出 CSV，刷新按钮添加旋转动画

## Bug 修复

- 修复 `health` API 路由中 `db.prepare()` 同步调用导致 MySQL 后端异常的问题（改为 `await db.get()`）
- 修复 `db.ts` 中 `recreatePool()` 缺少 `await` 导致连接池重建失败的问题
- 修复登录后 `useAuth` 未立即执行 health check 导致集群状态延迟感知的问题

## 变更文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/app/(authenticated)/show-proc/page.tsx` | 新增 | 高级诊断页面（目录视图 + 详情查看器） |
| `src/app/api/show-proc/route.ts` | 新增 | SHOW PROC 统一查询 API（白名单 + 缓存） |
| `src/lib/proc-metadata.ts` | 新增 | 18 个 PROC 路径元数据配置（分组/图标/描述） |
| `src/app/(authenticated)/compaction-score/page.tsx` | 新增 | 合并诊断页面（分页/排序/冻结列） |
| `src/app/api/compaction-score/route.ts` | 新增 | Compaction Score 分页查询 API |
| `src/components/Sidebar.tsx` | 修改 | 新增「高级诊断」+「合并诊断」菜单项 |
| `src/lib/permissions.ts` | 修改 | 注册 `SHOW_PROC` 权限 |
| `src/lib/local-db.ts` | 修改 | 新增 `show_proc_cache` 缓存表 |
| `src/components/ui/DataTable.tsx` | 修改 | 新增 MiniSelect 组件替代分页原生下拉 |
| `src/app/(authenticated)/materialized-views/page.tsx` | 修改 | 替换原生 select 为 SearchableSelect |
| `src/app/api/health/route.ts` | 修改 | 修复同步调用问题 |
| `src/hooks/useAuth.tsx` | 修改 | 登录后追加 health check |
| `src/lib/db.ts` | 修改 | 修复连接池重建 await 缺失 |
