# SQL 血缘分析

> **日期**: 2026-03-30 ~ 2026-04-04  
> **分支**: feat/query-lineage-nodes → fix/lineage-audit-issues

## 🎉 新增功能

- **SQL 血缘图谱**: 新增基于审计日志的表级数据血缘关系可视化页面（`/lineage`），采用 D3 Force-Directed 力导向图 + HTML5 Canvas 高性能渲染，支持 1000+ 节点。
- **血缘数据采集**: 实现 `lineage-collector.ts` 定时从 StarRocks 审计日志中采集 SQL 语句，`lineage-parser.ts` 解析 INSERT/CTAS/CREATE VIEW 等 DML 语句提取表级血缘关系。
- **查询血缘节点**: 新增 V3 迁移 `lineage_query_nodes` 和 `lineage_query_edges` 表，支持 SELECT 查询型血缘节点（胶囊形状）的解析与展示。
- **数据库迁移**: 新增 V2~V7 迁移脚本（MySQL/SQLite 双方言），覆盖血缘表、查询血缘、调度配置、索引优化。
- **节点深度过滤**: 支持按拓扑深度（2/3/4/5/全部）过滤血缘图谱，基于双向 BFS 从选中节点出发计算上下游跳数。
- **数据库筛选**: 支持按数据库名和搜索关键词过滤血缘节点，数据库下拉组件支持实时搜索，优先从缓存表获取数据库列表。
- **左侧数据库图例**: 滚动式侧边栏显示所有数据库及节点计数，支持颜色标识。
- **右侧详情面板**: 选中节点后显示表详情，含导出和复制按钮（导出完整信息 / 复制上下游表清单），支持点击上下游表名跳转导航。
- **定时调度同步**: 支持配置自动血缘采集频率（5分钟/10分钟/30分钟/1小时/手动），服务端 singleton 进程管理（`lineage-scheduler.ts`），分集群独立管理，关闭浏览器不中断采集。
- **审计日志记录**: 手动同步（`lineage.sync`）、定时同步（`lineage.auto_sync`）、调度配置变更（`lineage.schedule`）均记录审计日志。
- **Beta 标签**: 侧边栏菜单 "SQL 血缘" 项添加紫色渐变 Beta 徽章，标识功能处于测试阶段。

## 🔒 安全修复（三轮审计，累计修复 36 个问题）

- **SQL 注入防护**: 所有 SQL 查询全面参数化（`?` 占位符），消除字符串拼接注入风险。
- **sessionId 越权防护**: API 层增加 `sessionId` 归属校验，防止水平越权访问其他用户的血缘数据。
- **集群级访问控制**: 所有 API 端点增加集群维度权限校验，防止跨集群数据泄露。
- **连接池泄漏修复**: 采集器统一使用 `try/finally` 确保数据库连接释放，杜绝连接泄漏。
- **CTE 解析加固**: 修复 WITH 子句中 CTE 名称被误识别为表引用的解析缺陷。
- **并发同步控制**: 采集器增加分集群互斥锁，防止并发同步导致数据重复。
- **BFS 深度保护**: 图遍历增加最大深度限制和 visited 集合，防止循环引用导致的无限递归。

## 🔧 重构与优化

- **方块节点优化**: 节点从菱形改为带圆角的方块，显示库名（上行小字）+ 表名（下行粗体等宽字体），3段式名称自动拆分为 `catalog.db` + `table`。
- **查询节点胶囊形状**: SELECT 查询节点采用圆角胶囊式 pill 形状，区分于普通表节点。
- **噪声 SQL 4 层过滤**:
  - **Phase 1（SQL 层）**: 使用 `LOCATE()` 函数排除系统库。
  - **Phase 2（应用层）**: `isNoiseSql()` 拦截非业务 SQL。
  - **Phase 3（解析层）**: `isSystemRef()` 检查系统库引用。
  - **Phase 4（读取层）**: `getLineageGraph()` 查询排除系统库节点。
- **N+1 查询消除**: 采集器批量查询替代循环单条查询，大幅减少数据库 roundtrip。
- **Canvas 渲染优化**: 预计算 120 轮力仿真迭代后再渲染首帧，消除首屏抖动；预计算后停止仿真降低 CPU 消耗。
- **图谱搜索优化**: 搜索过滤采用子图剪枝策略，移除孤立节点，确保搜索结果整洁。
- **自动缩放 Fit-to-View**: 预计算后自动计算 bounding box 并缩放使全部节点适配视口。
- **自定义下拉组件**: 深度选择器和数据库筛选器均使用自定义毛玻璃风格下拉组件，替代原生 `<select>`。
- **连线优化**: 默认连线透明度加深（0.18→0.45），箭头更醒目（0.35→0.55），选中态高亮更鲜明。
- **审计日志时区修复**: `recordAuditLog()` 显式使用 `shanghaiDatetime()`，修复 SQLite UTC 时区不一致问题。
- **侧边栏宽度优化**: 全局侧边栏宽度从 240px 缩减至 208px，为主内容区回收 32px 空间。

## 📝 文档变更

- 更新 `ui-pro-max/SKILL.md`：新增自定义下拉组件规范；侧边栏布局宽度从 240px 更新为 208px。
- 新增 `audit-logging/SKILL.md`：审计日志记录规范。

## 📦 新增文件

- `db/migrations/V2__add_lineage_tables.{mysql,sqlite}.sql` — 血缘表迁移
- `db/migrations/V3__add_query_lineage.{mysql,sqlite}.sql` — 查询血缘表迁移
- `db/migrations/V4__add_lineage_schedule.{mysql,sqlite}.sql` — 血缘调度配置表迁移
- `db/migrations/V5__add_query_node_index.{mysql,sqlite}.sql` — 查询节点索引
- `db/migrations/V6__add_sync_log_index.{mysql,sqlite}.sql` — 同步日志索引
- `db/migrations/V7__add_edge_last_exec_index.{mysql,sqlite}.sql` — 边执行时间索引
- `src/app/(authenticated)/lineage/page.tsx` — 血缘页面主组件
- `src/app/api/lineage/route.ts` — 血缘同步 & 查询 API
- `src/app/api/lineage/schedule/route.ts` — 血缘调度配置 API
- `src/app/api/lineage/sync-logs/route.ts` — 同步日志查询 API
- `src/app/api/lineage/table/route.ts` — 表血缘详情 API
- `src/components/lineage/ForceGraph.tsx` — Canvas 力导向图组件
- `src/components/lineage/TableLineagePanel.tsx` — 右侧详情面板
- `src/components/lineage/graph-layout.ts` — 力仿真 + 深度过滤
- `src/components/lineage/graph-types.ts` — 图谱类型定义
- `src/lib/lineage-collector.ts` — 血缘数据采集器（含 4 层噪声过滤）
- `src/lib/lineage-parser.ts` — SQL 血缘解析器
- `src/lib/lineage-scheduler.ts` — 服务端调度 singleton（分集群定时管理）
- `.agent/skills/audit-logging/SKILL.md` — 审计日志开发规范
