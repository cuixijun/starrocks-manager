# StarRocks Manager

一站式 StarRocks 集群管理平台，提供可视化的集群监控、数据库浏览、任务管理和权限管控能力。

## 功能概览

| 模块 | 功能 |
|------|------|
| **仪表盘** | 集群节点状态总览（FE/BE/CN/Broker）、活跃查询监控 |
| **数据管理** | 数据库浏览、Catalog 管理、物化视图管理、SQL 查询编辑器 |
| **任务管理** | Routine Load、Broker Load、Pipes、Submit Task、Task Runs |
| **权限管理** | 用户管理、角色管理、权限分配、资源组管理 |
| **集群管理** | 多集群注册与切换、实时健康监测、节点详情 |
| **系统管理** | 系统变量查看、Functions 浏览、系统用户管理 |

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                   前端 (React 19)                │
│  Next.js 16 App Router · Recharts · Lucide Icons │
└─────────────────┬───────────────────────────────┘
                  │ API Routes
┌─────────────────▼───────────────────────────────┐
│               服务端 (Node.js)                    │
│  Next.js API Routes · mysql2 连接池               │
│  HealthMonitor 单例 · bcryptjs 认证               │
└──────┬──────────────────────────────┬────────────┘
       │                              │
┌──────▼──────────┐        ┌──────────▼────────────┐
│  本地元数据库     │        │  StarRocks 集群        │
│  SQLite/MySQL    │        │  (mysql2 连接池)        │
│  (配置/缓存/会话) │        │  (数据查询/管理操作)     │
└─────────────────┘        └───────────────────────┘
```

### 技术栈

- **前端**: React 19 + Next.js 16 (App Router) + Recharts + Lucide Icons
- **后端**: Next.js API Routes (Node.js)
- **StarRocks 连接**: mysql2 连接池
- **本地存储**: SQLite (better-sqlite3) / MySQL (可配置)
- **认证**: bcryptjs 密码哈希 + Session Token
- **健康监测**: 服务端单例定时器 (间隔可配置)
- **配置管理**: YAML 格式配置文件

## 安装部署

### 环境要求

- **Node.js** ≥ 20
- **npm** ≥ 10
- **SQLite3** (默认模式，系统通常自带)
- **MySQL** (生产部署推荐，用于元数据持久化)

### 开发环境

```bash
# 克隆项目
git clone <repository-url>
cd starrocks-manager

# 安装依赖
npm install

# 创建配置文件 (可选，使用默认配置可跳过)
cp config.example.yaml config.yaml

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000/starrocks-manager ，默认管理员账号：`admin` / `Admin@2024`

### 生产环境部署（Docker / K8s）

> 生产环境使用 MySQL 作为元数据库，应用访问前缀为 `/starrocks-manager`，配合 K8s Ingress 路径路由使用。

#### 前置条件

1. Docker Desktop 已安装并运行
2. 已准备好 MySQL 数据库实例
3. 已手动执行数据库初始化脚本：
   ```bash
   mysql -h <HOST> -P <PORT> -u <USER> -p <DATABASE> < db/migrations/001_init_mysql.sql
   ```

#### 1. 配置环境变量

```bash
# 从模板创建 .env 文件
cp .env.example .env
```

编辑 `.env` 填入实际的 MySQL 连接信息：

```env
DB_TYPE=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=starrocks_manager
ADMIN_PASSWORD=Admin@2024
```

#### 2. 一键构建 & 推送

```bash
./scripts/deploy.sh
```

`deploy.sh` 会自动完成以下步骤：
1. 读取 `.env` 环境变量
2. 生成 `config.yaml`（MySQL 模式）并打入镜像
3. 使用 `docker build --platform linux/amd64` 构建镜像
4. 推送到镜像仓库
5. 清理临时生成的 `config.yaml`

镜像地址: `<REGISTRY>/<NAMESPACE>/starrocks-manager:<YYYYMMDD>`

#### 3. 本地测试

```bash
docker run -d --name starrocks-manager \
  -p 3000:3000 \
  <REGISTRY>/<NAMESPACE>/starrocks-manager:latest
```

访问 http://localhost:3000/starrocks-manager

> **提示**: 生产镜像中 `config.yaml` 已内置 MySQL 连接信息，无需额外挂载。如需覆盖配置，可通过 `-v` 挂载自定义 `config.yaml`。

#### 4. K8s 部署

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: starrocks-manager
spec:
  replicas: 1
  selector:
    matchLabels:
      app: starrocks-manager
  template:
    metadata:
      labels:
        app: starrocks-manager
    spec:
      containers:
      - name: starrocks-manager
        image: <REGISTRY>/<NAMESPACE>/starrocks-manager:latest
        ports:
        - containerPort: 3000
        volumeMounts:
        - name: data
          mountPath: /app/data
        livenessProbe:
          httpGet:
            path: /starrocks-manager/api/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
      volumes:
      - name: data
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: starrocks-manager
spec:
  selector:
    app: starrocks-manager
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: starrocks-manager
spec:
  rules:
  - http:
      paths:
      - path: /starrocks-manager
        pathType: Prefix
        backend:
          service:
            name: starrocks-manager
            port:
              number: 80
EOF
```

> **提示**: 如需覆盖镜像内置的 `config.yaml`，创建 ConfigMap 并挂载到 `/app/config.yaml`。

#### 5. 更新版本

```bash
# 构建并推送新版
./scripts/deploy.sh

# 更新 K8s 部署
kubectl set image deployment/starrocks-manager \
  starrocks-manager=<REGISTRY>/<NAMESPACE>/starrocks-manager:$(date +%Y%m%d)
```

---

### 离线部署（内网服务器）

> 适用于无法访问互联网的内网 Linux 服务器。在有网络的 Mac 开发机上打包，传输到服务器后一键安装。

#### 前置条件

- **开发机**: Docker Desktop 已安装、`.env` 已配置
- **服务器**: Linux x86_64 (CentOS/Ubuntu 等)、MySQL 实例已就绪

#### 1. 打包离线安装包（Mac 上执行）

```bash
# 配置 .env（如尚未配置）
cp .env.example .env && vi .env

# 一键打包（Docker 构建 + Node.js 下载 + 打 tar.gz）
./scripts/pack-offline.sh
```

输出: `/tmp/starrocks-manager-offline-YYYYMMDD.tar.gz`

#### 2. 传输到服务器

```bash
scp /tmp/starrocks-manager-offline-YYYYMMDD.tar.gz user@server:/tmp/
```

#### 3. 安装（服务器上执行）

```bash
cd /tmp
tar -xzf starrocks-manager-offline-YYYYMMDD.tar.gz
cd starrocks-manager-offline-YYYYMMDD
sudo bash install.sh
```

安装脚本会自动完成:
- 安装 Node.js 到 `/opt/starrocks-manager/node`
- 部署应用到 `/opt/starrocks-manager/app`
- 创建专用系统用户 `starrocks-manager`
- 生成 `start.sh` / `stop.sh` / `restart.sh` 管理脚本
- 启动服务

#### 4. 初始化数据库（首次部署）

```bash
mysql -h <HOST> -P <PORT> -u <USER> -p <DB> < /opt/starrocks-manager/db/migrations/001_init_mysql.sql
```

#### 5. 管理服务

```bash
/opt/starrocks-manager/start.sh      # 启动
/opt/starrocks-manager/stop.sh       # 停止
/opt/starrocks-manager/restart.sh    # 重启

# 查看日志
tail -f /opt/starrocks-manager/app/logs/stdout.log
```

#### 6. 版本更新

```bash
# Mac 上重新打包
./scripts/pack-offline.sh

# 传输并重新安装（install.sh 会自动停止旧版本）
scp /tmp/starrocks-manager-offline-YYYYMMDD.tar.gz user@server:/tmp/
ssh user@server 'cd /tmp && tar -xzf starrocks-manager-offline-*.tar.gz && cd starrocks-manager-offline-* && sudo bash install.sh'
```

---

### 配置说明

配置文件 `config.yaml`（从 `config.example.yaml` 复制）：

```yaml
server:
  port: 3000                     # 服务端口
  node_env: production           # development | production

database:
  type: sqlite                   # sqlite | mysql
  sqlite:                        # type=sqlite 时生效
    path: ./data/starrocks-manager.db
  mysql:                         # type=mysql 时生效
    host: 127.0.0.1
    port: 3306
    user: root
    password: ""
    database: starrocks_manager

admin:
  password: Admin@2024           # 初始管理员密码（首次启动自动创建）

health_check:
  interval: 300                  # 集群健康检测间隔（秒）

log:
  level: info                    # debug | info | warn | error
  dir: ./logs                    # 日志文件目录（为空则仅输出到控制台）
```

> **Docker / 离线部署说明**: `deploy.sh` 和 `pack-offline.sh` 都会从 `.env` 自动生成 `config.yaml`，无需手动维护生产环境的配置文件。

## 项目结构

```
├── .env.example              # Docker/离线部署环境变量模板
├── config.example.yaml       # 配置模板
├── Dockerfile                # Docker 多阶段构建
├── db/migrations/            # 数据库建表 SQL
│   ├── 001_init_sqlite.sql
│   └── 001_init_mysql.sql
├── scripts/                  # 部署脚本
│   ├── deploy.sh             # Docker 构建 & 推送
│   ├── pack-offline.sh       # 离线部署打包（Mac 上执行）
│   ├── offline-install.sh    # 离线安装（服务器上执行）
│   ├── start.sh              # 开发环境启动
│   ├── stop.sh               # 开发环境停止
│   └── init-db.sh            # 数据库初始化
├── src/
│   ├── app/
│   │   ├── api/              # API 路由
│   │   └── (authenticated)/  # 页面路由
│   ├── components/           # React 组件
│   ├── hooks/                # 自定义 Hooks
│   └── lib/                  # 核心库
│       ├── config.ts         # YAML 配置管理
│       ├── db.ts             # StarRocks 连接池
│       ├── db-adapter.ts     # 数据库抽象层 (SQLite/MySQL)
│       ├── local-db.ts       # 本地元数据库 (SQLite 模式)
│       ├── health-monitor.ts # 集群健康监测单例
│       ├── logger.ts         # 日志模块
│       └── auth.ts           # 认证模块
└── package.json
```

## License

Private

