---
name: permissions-dev
description: 系统权限开发流程规范。新增功能模块时必须遵循此流程注册权限项，确保权限控制完整覆盖。
---

# Permissions Dev — 系统权限开发规范

> **适用范围：** 任何涉及新增功能模块、菜单项、API 路由的开发工作  
> **核心文件：**  
> - `src/lib/permissions.ts` — 权限常量定义 & 服务端检查  
> - `src/lib/local-db.ts` — `sys_role_permissions` 表  
> - `src/hooks/usePermissions.ts` — 前端权限 hook  
> - `src/components/Sidebar.tsx` — 菜单权限控制  
> - `src/app/(authenticated)/sys-permissions/page.tsx` — 权限管理 UI

---

## 1. 权限模型

### 1.1 角色体系

| 角色 | 说明 | 权限来源 |
|------|------|----------|
| `admin` | 管理员 | **代码级全权限**，不受 DB 配置影响 |
| `editor` | 编辑者 | DB 表 `sys_role_permissions` 配置 |
| `viewer` | 只读者 | DB 表 `sys_role_permissions` 配置 |

### 1.2 权限项结构

每个权限项是一个字符串常量，定义在 `PERMISSIONS` 对象中：

```typescript
// src/lib/permissions.ts
export const PERMISSIONS = {
  DASHBOARD: 'dashboard',
  DATABASES: 'databases',
  // ... 每个功能模块一个权限项
} as const;
```

### 1.3 数据库存储

```sql
-- sys_role_permissions 表
-- role: 'editor' | 'viewer'
-- permission: 权限项字符串
-- granted: 1=允许, 0=禁止
CREATE TABLE sys_role_permissions (
  role       TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (role, permission)
);
```

---

## 2. 新增功能模块流程

**每次新增一个功能模块（含页面 + API），必须按以下步骤注册权限：**

### Step 1: 注册权限常量

在 `src/lib/permissions.ts` 的 `PERMISSIONS` 对象中新增常量：

```typescript
export const PERMISSIONS = {
  // ... 已有项
  NEW_FEATURE: 'new_feature',   // ← 新增
} as const;
```

同时在 `PERMISSION_META` 中添加元数据（用于管理 UI 显示）：

```typescript
export const PERMISSION_META: Record<string, { label: string; group: string; description: string }> = {
  // ... 已有项
  new_feature: {
    label: '新功能',
    group: '所属分组',           // 对应 sidebar section 名
    description: '新功能的描述',
  },
};
```

### Step 2: 设置默认权限

在 `DEFAULT_PERMISSIONS` 中为 editor 和 viewer 配置默认值：

```typescript
export const DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  editor: {
    // ... 已有项
    new_feature: true,    // ← editor 默认是否有权限
  },
  viewer: {
    // ... 已有项
    new_feature: false,   // ← viewer 默认是否有权限
  },
};
```

### Step 3: Sidebar 注册

在 `Sidebar.tsx` 的 `navItems` 中使用 `permission` 字段：

```typescript
const navItems: NavItem[] = [
  // ...
  { href: '/new-feature', icon: SomeIcon, label: '新功能', permission: 'new_feature' },
];
```

### Step 4: API 路由保护

在 API route 中使用 `requirePermission`：

```typescript
import { requirePermission } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const { user } = requirePermission(request, 'new_feature');
  // ...
}
```

### Step 5: 前端页面权限检查（可选）

页面级别可通过 `usePermissions` hook 检查：

```tsx
const { hasPermission } = usePermissions();

if (!hasPermission('new_feature')) {
  return <AccessDenied />;
}
```

---

## 3. 权限检查 API

### 3.1 服务端

```typescript
// 检查角色是否有指定权限（admin 始终返回 true）
hasPermission(role: SysRole, permission: string): boolean

// API 路由中间件：requireAuth + 权限检查
requirePermission(request: Request, permission: string): { user, session }

// 获取角色的所有权限
getPermissionsForRole(role: SysRole): string[]
```

### 3.2 前端

```typescript
// usePermissions hook
const { permissions, hasPermission, loading } = usePermissions();

// permissions: string[]         — 当前用户拥有的权限列表
// hasPermission(p: string)      — 检查是否有指定权限
// loading: boolean              — 是否正在加载
```

---

## 4. 权限管理 UI

路径：`/sys-permissions`

- **权限矩阵**：行 = 功能模块（按 PERMISSION_META.group 分组），列 = 角色
- **admin 列**：始终全选，不可编辑（灰色 checkbox）
- **editor / viewer 列**：可勾选/取消
- **保存**：修改即时保存到 DB
- **重置**：可恢复到 `DEFAULT_PERMISSIONS` 默认值

---

## 5. Checklist（新增功能时必须检查）

- [ ] `PERMISSIONS` 中注册了权限常量
- [ ] `PERMISSION_META` 中添加了标签、分组、描述
- [ ] `DEFAULT_PERMISSIONS` 设置了 editor/viewer 默认值
- [ ] Sidebar `navItems` 使用 `permission` 字段
- [ ] API route 使用 `requirePermission()` 保护
- [ ] 权限管理 UI 自动加载新权限项（无需额外修改）
