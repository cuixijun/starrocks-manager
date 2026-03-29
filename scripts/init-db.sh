#!/bin/bash
# StarRocks Manager — 数据库初始化脚本
# 用法: ./scripts/init-db.sh [--force]
# --force: 删除已有数据库并重新初始化
#
# 此脚本负责：
#   1. 确保数据库/目录存在
#   2. 调用 Flyway 风格迁移引擎执行所有待执行迁移
#   3. 自动创建管理员账号

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 检查配置
if [ ! -f "config.yaml" ] && [ ! -f "config.yml" ]; then
  if [ -f "config.example.yaml" ]; then
    cp config.example.yaml config.yaml
    echo "已从 config.example.yaml 创建 config.yaml"
  else
    echo "错误: 未找到配置文件"
    exit 1
  fi
fi

# 读取数据库类型
DB_TYPE=$(node -e "
  const yaml = require('js-yaml');
  const fs = require('fs');
  const cfg = yaml.load(fs.readFileSync('config.yaml', 'utf8'));
  console.log(cfg.database?.type || 'sqlite');
")

echo "数据库类型: $DB_TYPE"

if [ "$DB_TYPE" = "sqlite" ]; then
  DB_PATH=$(node -e "
    const yaml = require('js-yaml');
    const fs = require('fs');
    const path = require('path');
    const cfg = yaml.load(fs.readFileSync('config.yaml', 'utf8'));
    const p = cfg.database?.sqlite?.path || './data/starrocks-manager.db';
    console.log(path.isAbsolute(p) ? p : path.join(process.cwd(), p));
  ")

  if [ "$1" = "--force" ] && [ -f "$DB_PATH" ]; then
    echo "删除已有数据库: $DB_PATH"
    rm -f "$DB_PATH"
  fi

  echo "初始化 SQLite 数据库: $DB_PATH"
  mkdir -p "$(dirname "$DB_PATH")"

elif [ "$DB_TYPE" = "mysql" ]; then
  echo "初始化 MySQL 数据库..."

  MYSQL_HOST=$(node -e "const y=require('js-yaml'),f=require('fs');const c=y.load(f.readFileSync('config.yaml','utf8'));console.log(c.database?.mysql?.host||'127.0.0.1')")
  MYSQL_PORT=$(node -e "const y=require('js-yaml'),f=require('fs');const c=y.load(f.readFileSync('config.yaml','utf8'));console.log(c.database?.mysql?.port||3306)")
  MYSQL_USER=$(node -e "const y=require('js-yaml'),f=require('fs');const c=y.load(f.readFileSync('config.yaml','utf8'));console.log(c.database?.mysql?.user||'root')")
  MYSQL_PWD=$(node -e "const y=require('js-yaml'),f=require('fs');const c=y.load(f.readFileSync('config.yaml','utf8'));console.log(c.database?.mysql?.password||'')")
  MYSQL_DB=$(node -e "const y=require('js-yaml'),f=require('fs');const c=y.load(f.readFileSync('config.yaml','utf8'));console.log(c.database?.mysql?.database||'starrocks_manager')")

  # 创建数据库（如果不存在）
  mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" ${MYSQL_PWD:+-p"$MYSQL_PWD"} -e "CREATE DATABASE IF NOT EXISTS \`$MYSQL_DB\` DEFAULT CHARACTER SET utf8mb4;"
  echo "✅ 数据库 $MYSQL_DB 已就绪"
fi

# 执行 Flyway 风格迁移
echo ""
echo "执行数据库迁移..."
node -e "
  // 加载配置并运行迁移
  const { getDb } = require('./src/lib/db-adapter');
  const { runMigrations } = require('./src/lib/migrator');
  const { config } = require('./src/lib/config');
  const bcrypt = require('bcryptjs');

  (async () => {
    const db = await getDb();
    await runMigrations(db);

    // 创建初始管理员
    const admin = await db.get('SELECT id FROM sys_users WHERE username = ?', ['admin']);
    if (!admin) {
      const hash = bcrypt.hashSync(config.admin?.password || 'Admin@2024', 10);
      await db.run(
        'INSERT INTO sys_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
        ['admin', hash, '管理员', 'admin']
      );
      console.log('✅ 管理员账号初始化完成');
    } else {
      console.log('✅ 管理员账号已存在，跳过');
    }

    console.log('');
    console.log('初始化完成！可以使用 ./scripts/start.sh 启动服务');
    process.exit(0);
  })().catch(err => {
    console.error('❌ 初始化失败:', err.message);
    process.exit(1);
  });
"
