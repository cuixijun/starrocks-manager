---
name: ui-pro-max
description: StarRocks Manager 完整 UI 规范。任何涉及 UI 修改、新页面、新组件的工作必须参考此规范。
---

# UI Pro Max — StarRocks Manager 设计规范

> **适用范围：** 所有页面、组件、样式修改  
> **核心文件：** `src/app/globals.css` (2500+ 行设计系统)  
> **图标库：** `lucide-react`  
> **图表库：** `recharts`

---

## 1. 技术栈约束

| 层 | 技术 | 注意 |
|---|---|---|
| 框架 | Next.js 16 (App Router) | `'use client'` 组件 |
| UI | React 19 + vanilla CSS | **禁止 Tailwind** |
| 样式 | `globals.css` + inline style | 全局类在 CSS 中定义，小组件可用 inline style |
| 字体 | Inter (正文) + JetBrains Mono (代码/数据) | Google Fonts CDN |
| 图标 | `lucide-react` | 统一 size 参数 |
| 图表 | `recharts` | 仅 Dashboard 使用 |

---

## 2. 设计令牌 (Design Tokens)

### 2.1 颜色体系

```
Primary (蓝):  50→700  #eff6ff → #1d4ed8   主操作、链接、激活态
Accent (紫):   400→600 #a78bfa → #7c3aed   品牌强调、渐变
Success (绿):  400→600 #4ade80 → #16a34a   在线、成功
Warning (黄):  400→600 #facc15 → #ca8a04   警告、Leader 角色
Danger (红):   400→600 #f87171 → #dc2626   错误、离线、删除
Gray (灰):     50→950  #f8fafc → #020617   背景、文字、边框
```

### 2.2 语义化颜色变量

**必须使用 CSS 变量，禁止硬编码颜色值。**

| 用途 | Light | Dark |
|---|---|---|
| `--bg-primary` | `#ffffff` | `gray-950` |
| `--bg-secondary` | `gray-50` | `gray-900` |
| `--bg-tertiary` | `gray-100` | `gray-800` |
| `--bg-elevated` | `#ffffff` | `gray-900` |
| `--bg-hover` | `gray-100` | `gray-800` |
| `--text-primary` | `gray-900` | `gray-50` |
| `--text-secondary` | `gray-600` | `gray-400` |
| `--text-tertiary` | `gray-400` | `gray-500` |
| `--border-primary` | `gray-200` | `gray-700` |
| `--border-secondary` | `gray-100` | `gray-800` |

### 2.3 圆角

```
--radius-sm:  6px   小元素 (badge, icon button)
--radius-md:  8px   输入框、按钮、nav item
--radius-lg:  12px  卡片、表格容器、模态框
--radius-xl:  16px  登录卡片、大模态框
999px              药丸型 (pill badge, tag)
```

### 2.4 阴影

```
--shadow-sm:  微影 — 立按钮、switcher
--shadow-md:  中影 — 卡片 hover
--shadow-lg:  大影 — 下拉菜单
--shadow-xl:  超大影 — 模态框
```

### 2.5 Glassmorphism

```
--glass-bg:     rgba(255,255,255,0.7) / rgba(15,23,42,0.7)
--glass-border: rgba(255,255,255,0.3) / rgba(51,65,85,0.4)
backdrop-filter: blur(8px)  — 仅用于 page-header sticky
```

---

## 3. 主题系统

- **切换方式：** `<html data-theme="dark">` 属性切换
- **所有颜色通过 CSS 变量自动适配**，组件代码无需 if/else
- **Dark 模式额外规则：**
  - 半透明背景 alpha 通常 +5%（如 0.1 → 0.15）
  - 状态色使用 400 而非 600（更亮以保证可读性）

---

## 4. 布局规范

```
┌─ Sidebar (208px, fixed) ─┬─ Main Content (flex: 1) ─────────────┐
│  sidebar-header (76px)    │  page-header (sticky, 76px min)      │
│  sidebar-nav              │  ┌─ topbar-header (absolute, 右上角) │
│  (可滚动)                  │  │  cluster-switcher + user-menu     │
│  sidebar-footer           │  └────────────────────────────────────│
│                           │  page-body (flex:1, 可滚动)           │
│                           │    padding: 16px 24px               │
└───────────────────────────┴──────────────────────────────────────┘
```

**关键规则：**
- `page-header` 的 `padding-right: 320px` 为右上角控件预留空间
- `page-body` 使用 `overflow-y: auto` 实现内容区分独滚动
- 响应式：`≤768px` 隐藏 sidebar，main-content 全宽

---

## 5. 字体规范

| 用途 | 字体 | 典型 size | weight |
|---|---|---|---|
| 页面标题 | Inter | 1.3rem (18.2px) | 700 |
| 卡片/模态标题 | Inter | 1.1rem / 1rem | 600-700 |
| 正文 | Inter | 0.85rem (11.9px) | 400-500 |
| 描述/辅助文字 | Inter | 0.78-0.82rem | 500 |
| 极小文字 | Inter | 0.68-0.72rem | 600 |
| 表头 | Inter | 0.78rem | 600, uppercase, letter-spacing: 0.04em |
| 代码/IP/端口 | JetBrains Mono | 0.82-0.88rem | 400-700 |
| HTML 基准 | — | `font-size: 14px` | — |

---

## 6. 组件规范

### 6.1 按钮 `.btn`

| 变体 | 类名 | 用途 |
|---|---|---|
| Primary | `.btn.btn-primary` | 主操作（添加、保存）— 渐变蓝 |
| Danger | `.btn.btn-danger` | 危险操作（删除）— 渐变红 |
| Secondary | `.btn.btn-secondary` | 次操作（刷新、取消）— 白底灰框 |
| Ghost | `.btn.btn-ghost` | 隐形按钮 — 透明背景 |
| Small | 追加 `.btn-sm` | 紧凑场景 |
| Icon-only | 追加 `.btn-icon` | 仅图标 6px padding |

**行内操作按钮 `.btn-action`：** 28×28px 圆角方形，配合 `-view / -grant / -danger / -primary / -success / -teal` 色彩变体。

### 6.2 表单

```
.form-group          — 垂直排列 label + input
.form-label          — 0.8rem, weight 500, text-secondary
.input               — 9px 12px padding, border: 1px, radius-md
.form-row            — 水平 2 列 grid
select.input         — 仅用于简单表单字段; 独立功能下拉必须使用自定义组件
```

> [!IMPORTANT]
> **禁止使用原生 `<select>` 作为功能性下拉选择器。** 所有下拉组件（筛选器、设置选择器等）必须使用统一的自定义下拉组件模式：
> - **触发器** (`.xxx-trigger`): `button` 元素，显示图标 + 当前值 + 箭头
> - **菜单** (`.xxx-menu`): `div` 绝对定位，`box-shadow: var(--shadow-lg)`，`animation: dropdownFadeIn`
> - **选项** (`.xxx-item`): `button` 元素，选中态显示 ✓ 图标，active 高亮
> - **外部点击关闭**: `useEffect` + `document.addEventListener('mousedown', handler)`
> 
> 参考实现：`DbDropdown` (page.tsx), `DepthDropdown` (ForceGraph.tsx), `.ln-dropdown-*` / `.ln-graph-depth-*` (globals.css)

### 6.3 表格

```
.table-container     — overflow-x: auto, border + radius-lg
table                — width: 100%, border-collapse
thead                — bg-tertiary
th                   — 0.78rem, uppercase, letter-spacing, nowrap
td                   — 6px 12px padding, border-bottom
tr:hover td          — bg-hover
.table-toolbar       — flex 容器, search 左 + actions 右
.table-footer        — 分页和统计信息
```

### 6.4 卡片

```
.card                — bg-elevated, border, radius-lg, 20px padding
.stat-card           — 统计数字卡, hover 上浮 1px
.icon-box            — 30×30 图标容器, -primary/-accent/-success/-warning/-danger 变体
```

### 6.5 模态框

```
.modal-overlay       — 固定全屏, rgba(0,0,0,0.5) + blur(4px)
.modal               — radius-xl, 24px padding, max-width 480px
.modal.modal-lg      — 720px, padding 0, 内部分 header/body/footer
.modal-header        — flex between, 20px margin-bottom
.modal-footer        — flex end, 8px gap
```

### 6.6 标签页

| 类型 | 类名 | 用途 |
|---|---|---|
| 下划线标签 | `.underline-tabs` + `.underline-tab` | 主内容区切换 (节点、用户等) |
| 基础标签 | `.tabs` + `.tab` | 旧版标签页 |
| 分段控件 | `.segmented-control` + `.segmented-option` | 变量作用域切换 |

### 6.7 Badge

```
.badge               — pill 形状, 0.72rem, 600 weight
  -success / -danger / -warning / -info / -neutral 变体
.status-badge        — 类似 badge 但含 status dot
VersionBadge         — 紫色 accent pill (inline component)
DatabaseBadge        — 蓝色 primary pill (inline component)
StatusBadge          — 动态颜色 (inline component)
```

### 6.8 Toast 通知

```
.toast               — 固定顶部居中, blur 背景, 带进度条动画
  -success / -error / -info 变体
  自动 3s 后消失 (toastProgress 动画)
```

### 6.9 其他组件

| 组件 | 类名 | 说明 |
|---|---|---|
| 穿梭框 | `.transfer-*` | 双面板选择器 |
| 搜索选择器 | `.ss-*` | 带搜索的下拉选择 |
| 树形视图 | `.tree-item` | 数据库浏览器 |
| SQL 编辑器 | `.sql-editor` | textarea, JetBrains Mono |
| 主题切换 | `.theme-switcher` | Sun/Moon 图标切换 |
| 空状态 | `.empty-state` | 居中图标 + 文字 |
| 加载态 | `.spinner` + `.loading-overlay` | 旋转圆环 |
| 面包屑 | `Breadcrumb` 组件 | 页面导航路径 |

---

## 7. 共用 UI 组件 (`src/components/ui/`)

| 文件 | 导出 | 用途 |
|---|---|---|
| `PageHeader.tsx` | `PageHeader` | 标准页面头（标题+面包屑+描述+操作） |
| `StatusBadge.tsx` | `StatusBadge`, `VersionBadge`, `DatabaseBadge` | 状态/版本/库名 pill |
| `DataTable.tsx` | `DataTable`, `Pagination`, `ErrorBanner`, `SuccessToast` | 表格+分页+消息 |
| `SearchToolbar.tsx` | `SearchToolbar` | 搜索工具栏 |
| `Modal.tsx` | `Modal`, `SqlPreview` | 模态框+SQL预览 |
| `ConfirmModal.tsx` | `ConfirmModal` | 确认对话框 |
| `CommandLogModal.tsx` | `CommandLogButton` | 命令日志 |
| `CacheTimeBadge.tsx` | `CacheTimeBadge` | 缓存时间标签 |

**新增组件时必须：**
1. 在 `src/components/ui/` 下创建文件
2. 在 `index.ts` 中导出
3. 复用已有 CSS 类，必要时在 `globals.css` 中追加

---

## 8. 内联样式约定

以下场景允许使用 inline style 而非 CSS class：

1. **一次性小组件**（如 `StatusDot`, `ProgressBar`）— 仅在单个页面使用
2. **动态计算值**（如 `width: ${pct}%`、条件性 `opacity`）
3. **颜色条件**（如根据 `alive` 动态选择 success/danger 色）

**Inline style 规范：**
```tsx
// ✅ 正确 - 使用 CSS 变量
style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}

// ❌ 错误 - 硬编码颜色
style={{ color: '#666', fontSize: '11px' }}

// ✅ 正确 - 条件性半透明背景
style={{ backgroundColor: isLeader ? 'rgba(234,179,8,0.1)' : 'rgba(37,99,235,0.08)' }}
```

---

## 9. 间距与密度

本项目为**紧凑型管理界面**，间距比常规应用更小：

| 场景 | 值 |
|---|---|
| 页面边距 | 16px 24px (page-body) |
| 卡片内边距 | 20px |
| 表格单元格 | 6px 12px (td), 7px 12px (th) |
| 表单行间距 | 16px gap |
| 按钮内边距 | 8px 16px (normal), 5px 10px (sm) |
| 组件间最小间距 | 6-8px |
| 模态框内间距 | 24px |

---

## 10. 图标使用

```tsx
import { Server, Plus, Trash2, RefreshCw } from 'lucide-react';

// 标准尺寸
<Server size={14} />   // 表格行内图标、icon-box 内
<Server size={16} />   // 按钮内图标
<Server size={18} />   // stat-card 图标
<Server size={48} />   // 空状态图标
```

---

## 11. 动画规范

| 名称 | 用途 | 参数 |
|---|---|---|
| `fadeIn` | 通用渐入 | 0.3s ease |
| `slideUp` | 模态框弹出 | 0.2s ease |
| `slideIn` | 侧边滑入 | 0.2s ease |
| `spin` | 加载旋转 | 0.6s linear infinite |
| `pulse` | 呼吸闪烁 | 2s ease-in-out infinite |
| `toastSlideDown` | Toast 下滑 | 0.4s cubic-bezier |
| `toastProgress` | Toast 进度条 | 3s linear |
| `pulse-ring` | 状态脉冲环 | 2s ease-in-out infinite |

**CSS 类：** `.fade-in`, `.animate-pulse`

---

## 12. 新页面模板

```tsx
'use client';

import React from 'react';
import { useSession } from '@/hooks/useSession';
import { useDataFetch } from '@/hooks/useDataFetch';
import { PageHeader, ErrorBanner, SuccessToast } from '@/components/ui';
import { SomeIcon } from 'lucide-react';

export default function NewPage() {
  const { session } = useSession();
  const { data, loading, refreshing, error, success, refresh } = useDataFetch(/* ... */);

  return (
    <>
      <PageHeader
        title="页面标题"
        breadcrumb={[{ label: '分类' }, { label: '页面标题' }]}
        description="页面描述"
      />
      <div className="page-body">
        <ErrorBanner error={error} />
        <SuccessToast message={success} />

        {/* Toolbar */}
        <div className="table-toolbar">
          {/* search + actions */}
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : data.length === 0 ? (
          <div className="empty-state">
            <SomeIcon size={48} />
            <div className="empty-state-text">暂无数据</div>
          </div>
        ) : (
          <div className="table-container fade-in" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', tableLayout: 'auto' }}>
              {/* ... */}
            </table>
          </div>
        )}
      </div>
    </>
  );
}
```

---

## 13. Checklist（新增/修改 UI 时必须检查）

- [ ] 所有颜色使用 CSS 变量（`var(--xxx)`），无硬编码
- [ ] Dark 模式正确显示（通过变量自动适配，或追加 `[data-theme="dark"]` 规则）
- [ ] 图标使用 lucide-react，尺寸符合规范
- [ ] 组件 hover/focus/disabled 状态完整
- [ ] `whiteSpace: 'nowrap'` 应用于不应换行的文本（版本号、IP等）
- [ ] 新增 CSS 类追加到 `globals.css` 对应分段
- [ ] 新增共用组件在 `index.ts` 中导出
- [ ] 表格使用 `.table-container` 包裹并设置 `overflowX: 'auto'`
- [ ] 页面使用 `PageHeader` 组件，包含面包屑
