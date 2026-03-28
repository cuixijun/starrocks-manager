# 审计系统 + 全局水印 — 功能更新说明

> 分支：`feature/audit-system`  
> 日期：2026-03-28

## 新增功能

### 1. 审计日志系统

完整的操作审计记录能力，覆盖系统全链路关键操作。

**审计埋点覆盖范围：**
- 认证：登录 / 登出
- 用户管理：创建 / 更新 / 删除用户
- 集群管理：创建 / 更新 / 删除集群
- 数据库管理：创建 / 删除数据库
- 权限管理：授予权限 / 撤销权限 / 授予角色 / 撤销角色
- SQL 执行：DDL / DML 变更类语句（自动过滤 SELECT）

**审计级别体系：**
- `off` — 关闭审计
- `basic` — 仅记录认证操作
- `standard` — 记录所有管理操作（默认）
- `full` — 记录所有操作（含 SQL 执行）

> 仅 admin 角色可修改审计级别，其他用户仅可查看。

**审计日志页面功能：**
- 表格列顺序：序号 → 分类 → 操作 → 操作对象 → 用户 → 时间 → IP → 详情
- 时间范围筛选（默认最近 1 小时，支持 6h / 24h / 7d / 30d / 全部）
- 分类筛选（自定义下拉组件）
- 分页显示 + 底部行数统计
- 操作详情面板（支持 Esc / 点击外部 / X 按钮关闭）
- CSV 导出（UTF-8 BOM，Excel 兼容）

### 2. 全局水印（DLP 防泄露）

所有认证页面覆盖动态水印，用于截图溯源。

**技术特性：**
- Canvas 渲染，背景平铺，性能优异
- 显示内容：用户名 + 当前日期
- MutationObserver 防篡改（自动恢复被删除/修改的水印 DOM）
- 深浅主题自适应（中性灰 #888，12% 透明度）
- `pointer-events: none`，不影响页面交互

**可配置参数（Watermark 组件 props）：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `fontSize` | 8 | 字号（px） |
| `opacity` | 0.12 | 透明度 |
| `rotate` | -20 | 旋转角度 |
| `gap` | [120, 80] | 水印间距 [x, y] |
| `color` | #888888 | 文字颜色 |

## Bug 修复

- 修复审计日志时间筛选不准确的问题（SQLite `datetime()` 归一化日期格式）
- 修复浏览器扩展导致的 React Hydration Mismatch（`suppressHydrationWarning`）

## 变更文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/app/(authenticated)/audit/page.tsx` | 新增 | 审计日志页面 |
| `src/app/api/audit-config/route.ts` | 新增 | 审计配置 API |
| `src/app/api/audit-logs/route.ts` | 新增 | 审计日志查询 API |
| `src/components/Watermark.tsx` | 新增 | 全局水印组件 |
| `src/lib/local-db.ts` | 修改 | audit_logs 表 + 查询/写入函数 |
| `src/components/AppShell.tsx` | 修改 | 集成水印组件 |
| `src/components/Sidebar.tsx` | 修改 | 新增审计日志菜单 |
| `src/app/api/auth/route.ts` | 修改 | 登录/登出审计 |
| `src/app/api/clusters/route.ts` | 修改 | 集群操作审计 |
| `src/app/api/databases/route.ts` | 修改 | 数据库操作审计 |
| `src/app/api/grants/route.ts` | 修改 | 权限操作审计 |
| `src/app/api/query/route.ts` | 修改 | SQL 执行审计 |
| `src/app/api/sys-users/route.ts` | 修改 | 用户管理审计 |
| `src/app/layout.tsx` | 修改 | Hydration 修复 |
