#!/bin/bash
# StarRocks Manager — 构建 & 推送 Docker 镜像 (MySQL Only)
# 用法: ./scripts/deploy.sh
#
# 前置条件:
#   1. 项目根目录存在 .env (包含 MySQL 连接配置)
#   2. MySQL 数据库已手动初始化 (执行 db/migrations/001_init_mysql.sql)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ---- 检查 .env ----
if [ ! -f ".env" ]; then
  echo "❌ 错误: 未找到 .env 文件"
  echo "   请先从 .env.example 复制并配置数据库连接信息:"
  echo "   cp .env.example .env"
  exit 1
fi

# ---- 加载环境变量 ----
set -a
source .env
set +a

echo "✅ 已加载 .env 配置"
echo "   MySQL: ${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}"
echo ""

# ---- 从 .env 生成 config.yaml ----
echo "📝 生成 config.yaml..."

cat > config.yaml <<YAML
# 自动生成 — 由 deploy.sh 从 .env 构建，请勿手动编辑
server:
  port: 3000
  node_env: production

database:
  type: mysql
  mysql:
    host: "${MYSQL_HOST}"
    port: ${MYSQL_PORT}
    user: "${MYSQL_USER}"
    password: "${MYSQL_PASSWORD}"
    database: "${MYSQL_DATABASE}"

admin:
  password: "${ADMIN_PASSWORD:-Admin@2024}"

health_check:
  interval: 300

log:
  level: info
  dir: ./logs
YAML

echo "   ✅ config.yaml 已生成"
echo ""

# ---- 配置 ----
if [ -z "${DOCKER_REGISTRY}" ]; then
  echo "❌ 错误: .env 中未配置 DOCKER_REGISTRY"
  echo "   请在 .env 中添加: DOCKER_REGISTRY=your-registry.example.com/namespace"
  rm -f config.yaml
  exit 1
fi
REGISTRY="${DOCKER_REGISTRY}"
IMAGE_NAME="starrocks-manager"
TAG=$(date +%Y%m%d-%H%M%S)

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}"

echo "============================================"
echo "  StarRocks Manager — Docker 部署"
echo "============================================"
echo "  镜像: ${FULL_IMAGE}:${TAG}"
echo "============================================"
echo ""

# ---- 构建 ----
echo "📦 构建 Docker 镜像..."
docker build --platform linux/amd64 -t "${FULL_IMAGE}:${TAG}" .

echo ""
echo "✅ 构建完成"
echo ""

# ---- 推送 ----
echo "🚀 推送镜像到仓库..."
docker push "${FULL_IMAGE}:${TAG}"
# docker push "${FULL_IMAGE}:latest"

# ---- 清理生成的 config.yaml ----
rm -f config.yaml
echo "🧹 已清理 config.yaml"

echo ""
echo "============================================"
echo "  ✅ 部署完成"
echo "============================================"
echo "  镜像: ${FULL_IMAGE}:${TAG}"
echo ""
echo "  ⚠ 首次部署请手动初始化 MySQL:"
echo "    mysql -h ${MYSQL_HOST} -P ${MYSQL_PORT} -u ${MYSQL_USER} -p ${MYSQL_DATABASE} < db/migrations/001_init_mysql.sql"
echo ""
echo "  K8s 快速更新:"
echo "  kubectl set image deployment/starrocks-manager \\"
echo "    starrocks-manager=${FULL_IMAGE}:${TAG}"
echo "============================================"
