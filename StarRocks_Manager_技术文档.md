# StarRocks Manager — 技术文档

## 一、整体介绍

**StarRocks Manager** 是一款专为 StarRocks 分布式数据库设计的 Web 管理工具，提供集群监控、元数据浏览、SQL 查询、RBAC 权限管理、数据导入管理等全方位功能。

该工具同时支持 **存算分离** 与 **存算一体** 两种 StarRocks 部署架构，通过直连 StarRocks FE 的 MySQL 协议端口（默认 9030），为 DBA 和开发人员提供直观的可视化管理界面。

### 核心价值

- **一站式管理**：覆盖从集群监控到数据导入的全链路管理需求
- **安全可控**：完整的 RBAC 权限管理，支持系统/DDL/DML/函数/Catalog 多维度权限分类
- **高效运维**：实时集群状态监控，支持查询终止、连接管理等运维操作
- **多连接管理**：支持保存多个 StarRocks 实例连接，一键切换
- **深色/浅色主题**：支持明暗双主题切换，适配不同使用场景

---

## 二、技术架构

### 2.1 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **框架** | Next.js | 16.1.6 | App Router + API Routes，全栈框架 |
| **UI** | React | 19.2.3 | 前端组件库 |
| **语言** | TypeScript | 5.x | 类型安全 |
| **StarRocks 连接** | mysql2/promise | 3.19.x | 通过 MySQL 协议连接 StarRocks FE |
| **本地存储** | better-sqlite3 | 12.6.x | 连接配置、元数据缓存 |
| **图标** | lucide-react | 0.577.x | 矢量图标 |
| **图表** | recharts | 3.8.x | 数据可视化 |
| **样式** | Vanilla CSS | - | 自定义 CSS 变量设计系统 |

### 2.2 系统架构图

```
┌─────────────────────────────────────────────────┐
│                   浏览器 (React 19)              │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┐    │
│  │仪表盘│数据库│SQL   │权限  │导入  │资源组│    │
│  │      │浏览器│查询器│管理  │管理  │管理  │    │
│  └──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴──┬───┘    │
│     │      │      │      │      │      │         │
│     └──────┴──────┴──┬───┴──────┴──────┘         │
│                      │                            │
│              sessionStorage (会话)                │
└──────────────────────┬────────────────────────────┘
                       │ HTTP (fetch)
┌──────────────────────┴────────────────────────────┐
│              Next.js API Routes (26个)             │
│  ┌────────────────────────────────────────────┐   │
│  │ /api/connect    /api/cluster    /api/query  │   │
│  │ /api/databases  /api/roles      /api/grants │   │
│  │ /api/catalogs   /api/nodes      /api/users  │   │
│  │ /api/pipes      /api/tasks      /api/...    │   │
│  └────────┬───────────────────┬────────────────┘   │
│           │                   │                     │
│  ┌────────┴────────┐  ┌──────┴──────────┐          │
│  │  mysql2 连接池   │  │ better-sqlite3  │          │
│  │  (StarRocks)    │  │ (本地缓存)       │          │
│  └────────┬────────┘  └──────┬──────────┘          │
└───────────┼──────────────────┼──────────────────────┘
            │                  │
   ┌────────┴────────┐  ┌─────┴──────┐
   │  StarRocks FE   │  │  SQLite DB │
   │  (MySQL 9030)   │  │  (本地文件) │
   └─────────────────┘  └────────────┘
```

### 2.3 双数据库架构

**StarRocks (mysql2)**：通过连接池与 StarRocks FE 通信，执行 SQL 查询和管理操作。支持：
- 会话级连接池管理 (`connectionLimit: 5`)
- 自动重连机制（连接断开时自动从本地 DB 恢复连接参数）
- Keep-alive 保活 (`keepAliveInitialDelay: 30s`)

**SQLite (better-sqlite3)**：本地持久化存储，包含 13 张缓存表：
- `connections` — 保存的连接配置
- `settings` — 应用设置
- `db_metadata_cache` — 数据库/表/视图/MV 计数缓存
- `users_cache / roles_cache / resource_groups_cache` — JSON Blob 缓存
- `catalogs_cache / functions_cache / variables_cache` — 元数据缓存
- `materialized_views_cache / broker_load_cache / routine_load_cache` — 导入任务缓存
- `pipes_cache / tasks_cache / nodes_cache` — 其他缓存

### 2.4 目录结构

```
starrocks-tools/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 登录/连接页面
│   │   ├── layout.tsx            # 全局布局 + ThemeProvider
│   │   ├── globals.css           # 29KB 完整设计系统
│   │   ├── api/                  # 26 个 API 路由
│   │   │   ├── connect/          # 连接/测试
│   │   │   ├── cluster/          # 集群状态
│   │   │   ├── databases/        # 数据库浏览
│   │   │   ├── roles/            # 角色 CRUD
│   │   │   ├── grants/           # 权限授予
│   │   │   └── ...
│   │   └── (authenticated)/      # 需认证的页面路由
│   │       ├── dashboard/        # 仪表盘
│   │       ├── databases/        # 数据库浏览（含子页面）
│   │       ├── query/            # SQL 查询器
│   │       ├── roles/            # 角色管理
│   │       ├── users/            # 用户管理
│   │       ├── catalogs/         # Catalog 管理
│   │       ├── resource-groups/  # 资源组管理
│   │       ├── routine-load/     # Routine Load
│   │       ├── broker-load/      # Broker Load
│   │       ├── pipes/            # Pipes 管理
│   │       ├── tasks/            # 任务管理
│   │       ├── nodes/            # 节点管理
│   │       ├── functions/        # 函数管理
│   │       ├── materialized-views/ # 物化视图
│   │       ├── privileges/       # 权限管理
│   │       └── variables/        # 变量管理
│   ├── components/
│   │   ├── SqlHighlighter.tsx    # SQL 语法高亮 + 格式化（806行）
│   │   ├── PrivilegeDetailModal.tsx # 权限详情弹窗
│   │   ├── Sidebar.tsx           # 侧边栏导航
│   │   ├── ThemeProvider.tsx     # 深色/浅色主题
│   │   └── ui/                   # 通用 UI 组件
│   │       ├── DataTable.tsx     # 数据表格
│   │       ├── Modal.tsx         # 弹窗
│   │       ├── Pagination.tsx    # 分页 (via PageHeader)
│   │       ├── SearchToolbar.tsx # 搜索工具栏
│   │       └── StatusBadge.tsx   # 状态徽章
│   ├── hooks/
│   │   ├── useSession.ts         # 会话管理
│   │   ├── useDataFetch.ts       # 数据获取
│   │   └── usePagination.ts      # 分页逻辑
│   ├── lib/
│   │   ├── db.ts                 # StarRocks 连接池管理
│   │   ├── local-db.ts           # SQLite 本地存储
│   │   └── utils.ts              # 工具函数
│   └── utils/
│       └── grantClassifier.ts    # 权限分类器
└── data/
    └── starrocks-tools.db        # SQLite 数据库文件
```

---

## 三、功能特性

### 3.1 连接管理
- 支持保存/加载/删除多个 StarRocks 连接配置
- 连接测试（显示 StarRocks 版本号）
- 密码可见性切换
- 最近使用排序

### 3.2 仪表盘（Dashboard）
- **集群概览**：FE/BE/CN 节点总数、在线离线状态
- **节点详情表格**：Frontend、Backend、Compute 节点各自的详细信息
- **实时查询监控**：活跃查询列表，支持终止查询（KILL QUERY）
- **自动刷新**：每 15 秒自动刷新集群状态

### 3.3 SQL 查询器
- SQL 编辑器（支持 Ctrl+Enter 快捷执行）
- 查询结果表格展示
- 查询历史记录（最近 50 条）
- CSV 导出功能
- 执行耗时显示

### 3.4 数据库浏览
- 多层级浏览：数据库 → 表 → 列/索引/分区
- 表/视图/物化视图计数
- 元数据缓存，快速加载

### 3.5 RBAC 权限管理
- **用户管理**：创建/删除用户、修改密码、角色分配
- **角色管理**：创建/删除角色、授予/撤销角色、查看权限详情
- **权限详情弹窗**：按分类（系统/DDL/DML/函数/Catalog）分组展示
- **权限分类器**（grantClassifier）：将 GRANT 语句解析为结构化的分类数据
- **多 Catalog 支持**：正确处理 default_catalog 与外部 Catalog（如 hive_catalog）的权限

### 3.6 资源组管理
- 显示资源组配置（CPU/内存/并发限制等）
- 粘性列（首列固定 + 操作列固定）

### 3.7 数据导入管理
- **Routine Load**：Kafka 流式导入任务管理
- **Broker Load**：批量导入任务管理
- **Pipes**：Pipe 导入管理
- **任务管理**：ETL 任务查看

### 3.8 其他管理功能
- **Catalog 管理**：内部/外部 Catalog 浏览
- **物化视图管理**：MV 列表 + 详情（含 SQL 定义高亮展示）
- **节点管理**：FE/BE/CN 节点详情
- **函数管理**：UDF 管理
- **变量管理**：系统变量查看

---

## 四、亮点功能

### 4.1 自定义 SQL 语法高亮 & 格式化器
独立实现的 SQL 语法高亮组件（806 行代码），无外部依赖：
- **Catppuccin Mocha 配色方案**：关键字紫色、字符串绿色、数字橙色、注释灰色
- **智能 SQL 格式化**：识别 CREATE/SELECT/JOIN/PROPERTIES 等语句结构，自动缩进和换行
- **行号显示**：粘性行号栏
- **一键复制/美化切换**：浮动工具栏

### 4.2 权限分类系统（Grant Classifier）
将 StarRocks 的 GRANT 语句解析为 6 大分类，结合色彩编码展示：
- 🟣 系统权限（OPERATE, NODE）
- 🟡 DDL 权限（CREATE, ALTER, DROP）
- 🟢 DML 权限（SELECT, INSERT, UPDATE）
- 🔵 函数权限（FUNCTION）
- 🔷 Catalog 权限（USAGE）
- ⚪ 其他权限

### 4.3 双数据库 + 智能缓存架构
- 首次加载从 StarRocks 拉取数据并缓存到 SQLite
- 后续访问优先从缓存读取，显示「CACHE」标签和缓存时间
- 支持强制刷新（bypass cache）
- 自动连接重建：连接断开后从本地 DB 恢复连接参数并重建连接池

### 4.4 深色/浅色主题系统
- 基于 CSS 变量的完整设计系统（29KB globals.css）
- ThemeProvider 组件管理主题状态
- 一键切换，覆盖所有页面和组件
