# SQL 血缘分析

> **日期**: 2026-03-30  
> **分支**: feature/sql-lineage

## 🎉 新增功能

- **SQL 血缘图谱**: 新增基于审计日志的表级数据血缘关系可视化页面（`/lineage`），采用 D3 Force-Directed 力导向图 + HTML5 Canvas 高性能渲染，支持 1000+ 节点。
- **血缘数据采集**: 实现 `lineage-collector.ts` 定时从 StarRocks 审计日志中采集 SQL 语句，`lineage-parser.ts` 解析 INSERT/CTAS/CREATE VIEW 等 DML 语句提取表级血缘关系。
- **数据库迁移**: 新增 `V2__add_lineage_tables` 迁移脚本（MySQL/SQLite 双方言），创建血缘关系存储表。
- **节点深度过滤**: 支持按拓扑深度（2/3/4/5/全部）过滤血缘图谱，基于拓扑排序 + 动态规划计算每个节点的 DAG 层级深度。
- **数据库筛选**: 支持按数据库名和搜索关键词过滤血缘节点。
- **左侧数据库图例**: 滚动式侧边栏显示所有数据库及节点计数，支持颜色标识。

## 🔧 重构与优化

- **方块节点**: 节点从圆形改为带圆角的方块，显示库名（上行小字）+ 表名（下行粗体等宽字体），3段式名称自动拆分为 `catalog.db` + `table`。
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

## 📝 文档变更

- 更新 `ui-pro-max/SKILL.md` 6.2 节：新增自定义下拉组件规范，禁止使用原生 `<select>` 作为功能性下拉选择器。

## 📦 新增文件

- `db/migrations/V2__add_lineage_tables.mysql.sql` — 血缘表 MySQL 迁移
- `db/migrations/V2__add_lineage_tables.sqlite.sql` — 血缘表 SQLite 迁移
- `src/app/(authenticated)/lineage/page.tsx` — 血缘页面主组件
- `src/app/api/lineage/` — 血缘 API 路由
- `src/components/lineage/ForceGraph.tsx` — Canvas 力导向图组件
- `src/components/lineage/graph-layout.ts` — 力仿真 + 拓扑深度过滤
- `src/components/lineage/graph-types.ts` — 图谱类型定义
- `src/lib/lineage-collector.ts` — 血缘数据采集器
- `src/lib/lineage-parser.ts` — SQL 血缘解析器
