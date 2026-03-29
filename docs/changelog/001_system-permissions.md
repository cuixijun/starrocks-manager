# 系统权限管理模块 — 功能更新说明

> 分支：`feature/system-permissions`  
> 日期：2026-03-28

## 新增功能

### 1. 可配置的系统角色权限

将原有硬编码的 `minRole` 菜单控制改为基于数据库的动态权限配置，管理员可按角色粒度配置各功能模块的访问权限。

**核心设计：**
- `admin` 角色：代码级全权限，不受数据库配置影响，确保系统始终可管理
- `editor` / `viewer` 角色：通过 `sys_role_permissions` 表动态配置
- 默认权限与原硬编码行为一致，升级后无感切换

**权限覆盖范围（21 项，6 分组）：**
- 监控：仪表盘
- 数据管理：数据库浏览、Catalog 管理、物化视图、SQL 查询
- 任务管理：Routine Load、Broker Load、Pipes、Submit Task、Task Runs
- 权限管理：用户管理、角色管理、权限管理
- 集群运维：节点管理、资源组、函数管理、变量管理
- 系统设置：集群管理、系统用户、审计日志、权限配置

### 2. 权限配置管理页面

全新的矩阵式权限管理 UI，仅管理员可访问。

**页面特性：**
- 分组展示，支持折叠/展开（点击分组标题行）
- 折叠态显示各角色权限摘要计数（如 `4/4`、`3/5`）
- 分组颜色区分（蓝/紫/青/红/翠/灰，克制风格）
- 分组级批量全选（✓ 按钮）
- 统一工具栏：保存 + 刷新，未保存修改提示
- 使用 DataTable 组件，与其他管理页面风格一致

### 3. 权限开发流程技能文档

创建 `permissions-dev` 技能，标准化后续功能开发的权限注册流程：
1. 在 `PERMISSIONS` 注册常量
2. 在 `PERMISSION_META` 添加元数据
3. 在 `DEFAULT_PERMISSIONS` 设置默认值
4. Sidebar 使用 `permission` 属性
5. API 使用 `requirePermission()` 中间件保护

## 功能测试

| # | 测试场景 | 结果 | 说明 |
|---|---------|------|------|
| 1 | 页面加载 | ✅ 通过 | 21 个权限项、6 个分组正确渲染，颜色区分正常 |
| 2 | 分组折叠/展开 | ✅ 通过 | 点击标题行切换，摘要计数实时更新 |
| 3 | 权限切换 + 保存 | ✅ 通过 | 切换 checkbox → 出现"未保存"提示 → 保存成功 |
| 4 | 批量全选 | ✅ 通过 | ✓ 按钮正确勾选分组内所有权限 |
| 5 | 侧边栏联动 | ✅ 通过 | admin 用户显示全部菜单项，动态权限生效 |
| 6 | TypeScript 编译 | ✅ 通过 | 0 错误 |

**测试结论：** 所有功能测试通过，模块可投入使用。

### 4. API 路由权限中间件集成

对所有 19 个数据面 API 路由文件注入 `requirePermission` 中间件，实现服务端权限校验。

**集成策略：**
- 每个 API handler 函数入口添加 `requirePermission(request, PERMISSIONS.X)` 调用
- 未通过权限检查的请求返回 `403 权限不足`
- `admin` 角色始终通过（代码级保证）
- 仅 admin 操作的路由（`clusters` 写操作、`sys-users`、`audit-config` PUT）保留 `requireRole('admin')`

**覆盖路由清单：**

| API 路由 | 权限 Key |
|----------|---------|
| `/api/queries` | `dashboard` |
| `/api/databases` | `databases` |
| `/api/catalogs` | `catalogs` |
| `/api/materialized-views` | `materialized_views` |
| `/api/query` | `query` |
| `/api/routine-load` | `routine_load` |
| `/api/broker-load` | `broker_load` |
| `/api/pipes` | `pipes` |
| `/api/tasks` | `tasks` |
| `/api/users` | `users` |
| `/api/roles` | `roles` |
| `/api/privileges` | `privileges` |
| `/api/grants` | `privileges` |
| `/api/nodes` | `nodes` |
| `/api/resource-groups` | `resource_groups` |
| `/api/functions` | `functions` |
| `/api/variables` | `variables` |
| `/api/audit-logs` | `audit` |
| `/api/audit-config` (GET) | `audit` |

## 变更文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/lib/permissions.ts` | 新增 | 权限常量、元数据、DB 读写、`requirePermission` 中间件 |
| `src/hooks/usePermissions.tsx` | 新增 | 前端权限 Provider + Hook |
| `src/app/api/sys-permissions/route.ts` | 新增 | 权限配置 API（GET 读矩阵 / PUT 更新） |
| `src/app/(authenticated)/sys-permissions/page.tsx` | 新增 | 权限矩阵管理 UI 页面 |
| `.agent/skills/permissions-dev/SKILL.md` | 新增 | 权限开发流程技能文档 |
| `src/lib/local-db.ts` | 修改 | 新增 `sys_role_permissions` 表 |
| `src/components/Sidebar.tsx` | 修改 | `minRole` → `permission` 动态权限检查 |
| `src/app/layout.tsx` | 修改 | 添加 `PermissionsProvider` |
| `src/app/api/databases/route.ts` | 修改 | 注入 `requirePermission(DATABASES)` |
| `src/app/api/catalogs/route.ts` | 修改 | 注入 `requirePermission(CATALOGS)` |
| `src/app/api/materialized-views/route.ts` | 修改 | 注入 `requirePermission(MV)` |
| `src/app/api/query/route.ts` | 修改 | 注入 `requirePermission(QUERY)` |
| `src/app/api/routine-load/route.ts` | 修改 | 注入 `requirePermission(ROUTINE_LOAD)` |
| `src/app/api/broker-load/route.ts` | 修改 | 注入 `requirePermission(BROKER_LOAD)` |
| `src/app/api/pipes/route.ts` | 修改 | 注入 `requirePermission(PIPES)` |
| `src/app/api/tasks/route.ts` | 修改 | 注入 `requirePermission(TASKS)` |
| `src/app/api/users/route.ts` | 修改 | 注入 `requirePermission(USERS)` |
| `src/app/api/roles/route.ts` | 修改 | 注入 `requirePermission(ROLES)` |
| `src/app/api/privileges/route.ts` | 修改 | 注入 `requirePermission(PRIVILEGES)` |
| `src/app/api/grants/route.ts` | 修改 | 注入 `requirePermission(PRIVILEGES)` |
| `src/app/api/nodes/route.ts` | 修改 | 注入 `requirePermission(NODES)` |
| `src/app/api/resource-groups/route.ts` | 修改 | 注入 `requirePermission(RESOURCE_GROUPS)` |
| `src/app/api/functions/route.ts` | 修改 | 注入 `requirePermission(FUNCTIONS)` |
| `src/app/api/variables/route.ts` | 修改 | 注入 `requirePermission(VARIABLES)` |
| `src/app/api/queries/route.ts` | 修改 | 注入 `requirePermission(DASHBOARD)` |
| `src/app/api/audit-logs/route.ts` | 修改 | 注入 `requirePermission(AUDIT)` |
| `src/app/api/audit-config/route.ts` | 修改 | GET 注入 `requirePermission(AUDIT)` |

