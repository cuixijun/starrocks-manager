# SQL 血缘分析

> **日期**: 2026-03-30 ~ 2026-03-31  
> **分支**: feat/query-lineage-nodes

## 🎉 新增功能

- **SQL 血缘图谱**: 新增基于审计日志的表级数据血缘关系可视化页面（`/lineage`），采用 D3 Force-Directed 力导向图 + HTML5 Canvas 高性能渲染，支持 1000+ 节点。
- **血缘数据采集**: 实现 `lineage-collector.ts` 定时从 StarRocks 审计日志中采集 SQL 语句，`lineage-parser.ts` 解析 INSERT/CTAS/CREATE VIEW 等 DML 语句提取表级血缘关系。
- **查询血缘节点**: 新增 V3 迁移 `lineage_query_nodes` 和 `lineage_query_edges` 表，支持 SELECT 查询型血缘节点（胶囊形状）的解析与展示。
- **数据库迁移**: 新增 `V2__add_lineage_tables`、`V3__add_query_lineage`、`V4__add_lineage_schedule` 迁移脚本（MySQL/SQLite 双方言）。
- **节点深度过滤**: 支持按拓扑深度（2/3/4/5/全部）过滤血缘图谱，基于双向 BFS 从选中节点出发计算上下游跳数。
- **数据库筛选**: 支持按数据库名和搜索关键词过滤血缘节点，数据库下拉组件支持实时搜索，优先从缓存表获取数据库列表。
- **左侧数据库图例**: 滚动式侧边栏显示所有数据库及节点计数，支持颜色标识。
- **右侧详情面板**: 选中节点后显示表详情，含导出和复制按钮（导出完整信息 / 复制上下游表清单），支持点击上下游表名跳转导航。
- **定时调度同步**: 支持配置自动血缘采集频率（5分钟/10分钟/30分钟/1小时/手动），服务端 singleton 进程管理（`lineage-scheduler.ts`），分集群独立管理，关闭浏览器不中断采集。
- **审计日志记录**: 手动同步（`lineage.sync`）、定时同步（`lineage.auto_sync`）、调度配置变更（`lineage.schedule`）均记录审计日志。

## 🔧 重构与优化

- **方块节点优化**: 节点从菱形改为带圆角的方块，显示库名（上行小字）+ 表名（下行粗体等宽字体），3段式名称自动拆分为 `catalog.db` + `table`。
- **查询节点胶囊形状**: SELECT 查询节点采用圆角胶囊式 pill 形状，区分于普通表节点。
- **噪声 SQL 4 层过滤**:
  - **Phase 1（SQL 层）**: 使用 `LOCATE()` 函数（避免 LIKE/ESCAPE 兼容性问题）排除系统库（`information_schema`、`starrocks_audit_db__`、`_statistics_` 等）。
  - **Phase 2（应用层）**: `isNoiseSql()` 函数拦截 `SELECT 1`、`SHOW VERSION`、`SET` 等非业务 SQL。
  - **Phase 3（解析层）**: `isSystemRef()` 检查解析后的表引用是否属于系统库。
  - **Phase 4（读取层）**: `getLineageGraph()` 查询排除系统库节点，确保脏数据不渲染。
- **自引用循环防护**: 过滤采集器自身的审计查询（`starrocks_audit_tbl__`），杜绝血缘自引用。
- **节点点击自动居中**: 选中节点后自动平滑动画居中到可视区域，考虑右侧面板 320px 宽度偏移。
- **交互体验优化**:
  - 拖动与点击区分（5px 阈值），避免拖动结束误选节点。
  - 仅高亮节点（选中节点 + 邻居）可拖动，暗淡节点锁定。
  - 拖动时降低仿真活跃度（alphaTarget 0.3→0.05），消除关联节点抖动。
  - 拖动后节点钉在新位置，不弹回。
- **首屏性能优化**:
  - 同步预计算 120 轮力仿真迭代后再渲染首帧，消除首屏抖动。
  - `dimensions` 延迟初始化（null→真实尺寸），确保 simulation effect 仅执行一次。
  - `readyRef` 门控机制防止多个 useEffect 各自触发首帧绘制。
  - 预计算后停止仿真，仅拖动时短暂启动，大幅降低 CPU 消耗。
- **自动缩放 Fit-to-View**: 预计算后自动计算 bounding box 并缩放使全部节点适配视口。
- **自定义下拉组件**: 深度选择器和数据库筛选器均使用自定义毛玻璃(glassmorphism)风格下拉组件，替代原生 `<select>`。
- **连线优化**: 默认连线透明度加深（0.18→0.45），箭头更醒目（0.35→0.55），选中态高亮更鲜明。
- **审计日志时区修复**: `recordAuditLog()` 显式使用 `shanghaiDatetime()` 设置 `created_at`，修复 SQLite `CURRENT_TIMESTAMP` 返回 UTC 导致查询时区不一致的问题。

## 📝 文档变更

- 更新 `ui-pro-max/SKILL.md` 6.2 节：新增自定义下拉组件规范，禁止使用原生 `<select>` 作为功能性下拉选择器。
- 新增 `audit-logging/SKILL.md`：审计日志记录规范，约定所有变更类操作（API 增删改、后台任务）必须记录审计日志。

## 📦 新增文件

- `db/migrations/V2__add_lineage_tables.{mysql,sqlite}.sql` — 血缘表迁移
- `db/migrations/V3__add_query_lineage.{mysql,sqlite}.sql` — 查询血缘表迁移
- `db/migrations/V4__add_lineage_schedule.{mysql,sqlite}.sql` — 血缘调度配置表迁移
- `src/app/(authenticated)/lineage/page.tsx` — 血缘页面主组件
- `src/app/api/lineage/route.ts` — 血缘同步 & 查询 API
- `src/app/api/lineage/schedule/route.ts` — 血缘调度配置 API
- `src/components/lineage/ForceGraph.tsx` — Canvas 力导向图组件
- `src/components/lineage/TableLineagePanel.tsx` — 右侧详情面板
- `src/components/lineage/graph-layout.ts` — 力仿真 + 深度过滤
- `src/components/lineage/graph-types.ts` — 图谱类型定义
- `src/lib/lineage-collector.ts` — 血缘数据采集器（含 4 层噪声过滤）
- `src/lib/lineage-parser.ts` — SQL 血缘解析器
- `src/lib/lineage-scheduler.ts` — 服务端调度 singleton（分集群定时管理）
- `.agent/skills/audit-logging/SKILL.md` — 审计日志开发规范
