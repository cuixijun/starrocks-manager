-- ============================================================
-- StarRocks Manager 专用账号最小权限授权脚本
-- ============================================================
-- 用法:
--   1. 先用 root 创建专用用户:
--      CREATE USER 'sr_manager'@'%' IDENTIFIED BY '<密码>';
--   2. 执行本脚本:
--      mysql -h <FE_HOST> -P <FE_PORT> -u root -p < grant-privileges.sql
--   3. 在 StarRocks Manager 中使用 sr_manager 账号连接集群
--
-- 参考: https://docs.starrocks.io/docs/sql-reference/sql-statements/account-management/GRANT/
-- ============================================================

-- ★ 修改此处为实际用户名
-- CREATE USER 'sr_manager'@'%' IDENTIFIED BY 'YourSecurePassword';

-- ============================================================
-- 一、SYSTEM 级权限
-- ============================================================
-- OPERATE:      SHOW PROCESSLIST, KILL <query_id>, SET [GLOBAL] variables
-- NODE:          ALTER SYSTEM ADD/DROP/DECOMMISSION 节点 → 不可直接授权，需 cluster_admin 角色
-- CREATE RESOURCE GROUP: 创建资源组
-- CREATE EXTERNAL CATALOG: 创建外表 Catalog
GRANT OPERATE ON SYSTEM TO USER 'sr_manager'@'%';
GRANT CREATE RESOURCE GROUP ON SYSTEM TO USER 'sr_manager'@'%';
GRANT CREATE EXTERNAL CATALOG ON SYSTEM TO USER 'sr_manager'@'%';

-- ============================================================
-- 二、NODE 级权限 (SHOW FRONTENDS/BACKENDS/COMPUTE NODES/BROKER)
-- ============================================================
-- 需要 SYSTEM 级 OPERATE 或 NODE 权限
-- OPERATE 已在上方授权，可覆盖节点相关 SHOW 命令

-- ============================================================
-- 三、CATALOG 级权限
-- ============================================================
-- SHOW CATALOGS: 需要任意 CATALOG 上的 USAGE
-- SHOW CREATE CATALOG: 需要对应 CATALOG 的 USAGE
-- DROP CATALOG: 需要对应 CATALOG 的 DROP
GRANT USAGE ON ALL CATALOGS TO USER 'sr_manager'@'%';
GRANT DROP ON ALL CATALOGS TO USER 'sr_manager'@'%';

-- Internal Catalog (default_catalog): 需要 CREATE DATABASE 权限
GRANT CREATE DATABASE ON CATALOG default_catalog TO USER 'sr_manager'@'%';

-- ============================================================
-- 四、DATABASE 级权限
-- ============================================================
-- SHOW DATABASES: 需要 DATABASE 上的任意权限
-- DROP DATABASE: 需要 DATABASE 上的 DROP
-- ALTER DATABASE: 需要 DATABASE 上的 ALTER
-- CREATE MATERIALIZED VIEW: 需要 DATABASE 上的 CREATE MATERIALIZED VIEW
GRANT ALTER, DROP, CREATE TABLE, CREATE VIEW, CREATE FUNCTION, CREATE MATERIALIZED VIEW
  ON ALL DATABASES TO USER 'sr_manager'@'%';

-- ============================================================
-- 五、TABLE 级权限
-- ============================================================
-- SELECT: 查询数据预览、information_schema 查询
-- SHOW CREATE TABLE / SHOW PARTITIONS: 需要 TABLE 上的任意权限
GRANT SELECT ON ALL TABLES IN ALL DATABASES TO USER 'sr_manager'@'%';

-- ============================================================
-- 六、VIEW 级权限
-- ============================================================
-- SHOW FULL TABLES WHERE Table_type = 'VIEW': 需要 VIEW 上的权限
GRANT SELECT ON ALL VIEWS IN ALL DATABASES TO USER 'sr_manager'@'%';

-- ============================================================
-- 七、MATERIALIZED VIEW 级权限
-- ============================================================
-- SHOW CREATE MATERIALIZED VIEW: 需要 MV 上的任意权限
-- REFRESH MATERIALIZED VIEW: 需要 REFRESH 权限
-- ALTER MATERIALIZED VIEW (ACTIVE/INACTIVE, 刷新策略, resource_group): 需要 ALTER
-- DROP MATERIALIZED VIEW: 需要 DROP 权限
GRANT SELECT, ALTER, REFRESH, DROP
  ON ALL MATERIALIZED VIEWS IN ALL DATABASES TO USER 'sr_manager'@'%';

-- ============================================================
-- 八、RESOURCE GROUP 级权限
-- ============================================================
-- SHOW RESOURCE GROUPS ALL: 需要任意 RESOURCE GROUP 权限
-- ALTER RESOURCE GROUP (修改属性/分配器): 需要 ALTER
-- DROP RESOURCE GROUP: 需要 DROP
GRANT ALTER, DROP ON ALL RESOURCE GROUPS TO USER 'sr_manager'@'%';

-- ============================================================
-- 九、用户与角色管理 (DCL) + 节点管理
-- ============================================================
-- CREATE USER / DROP USER: 需要 SYSTEM 级的 user_admin 内置角色
-- CREATE ROLE / DROP ROLE: 需要 SYSTEM 级的 user_admin 内置角色
-- GRANT / REVOKE: 需要 user_admin 内置角色
-- SHOW USERS / SHOW ROLES / SHOW GRANTS / SHOW ALL GRANTS: 需要 user_admin
-- ALTER SYSTEM ADD/DROP/DECOMMISSION 节点: 需要 cluster_admin 内置角色 (NODE 不可直接授权)
GRANT user_admin TO USER 'sr_manager'@'%';
GRANT cluster_admin TO USER 'sr_manager'@'%';
-- ★ 激活角色 (否则角色权限不会自动生效)
SET DEFAULT ROLE user_admin, cluster_admin TO 'sr_manager'@'%';

-- ============================================================
-- 十、ROUTINE LOAD 管理
-- ============================================================
-- information_schema.routine_load_jobs: 需要 SELECT 权限 (已在第五节授予)
-- PAUSE/RESUME/STOP ROUTINE LOAD: 需要对应数据库表上的权限或 OPERATE
-- OPERATE 已在第一节授权

-- ============================================================
-- 十一、BROKER LOAD 管理
-- ============================================================
-- information_schema.loads: 需要 SELECT 权限 (已在第五节授予)
-- CANCEL LOAD: 需要 OPERATE 权限 (已在第一节授权)

-- ============================================================
-- 十二、PIPE 管理
-- ============================================================
-- information_schema.pipes: 需要 SELECT 权限 (已在第五节授予)
-- ALTER PIPE SUSPEND/RESUME: 需要 OPERATE 权限 (已在第一节授权)
-- DROP PIPE: 需要 OPERATE 权限 (已在第一节授权)

-- ============================================================
-- 十三、TASK 管理
-- ============================================================
-- information_schema.tasks / task_runs: 需要 SELECT 权限 (已在第五节授予)
-- SUBMIT TASK / DROP TASK: 需要 OPERATE 权限 (已在第一节授权)

-- ============================================================
-- 十四、SHOW VARIABLES (全局/会话)
-- ============================================================
-- SHOW [GLOBAL] VARIABLES: 任意用户均可执行，无需额外权限
-- SET [GLOBAL] variable: 需要 OPERATE 权限 (已在第一节授权)

-- ============================================================
-- 十五、SHOW FUNCTIONS
-- ============================================================
-- SHOW [GLOBAL] FUNCTIONS: 需要 DATABASE 上的任意权限 (已在第四节授予)

-- ============================================================
-- 十六、SQL 查询编辑器 (任意 SQL)
-- ============================================================
-- 查询编辑器允许用户执行任意 SQL
-- 已授予的 SELECT 覆盖读操作
-- 如需写操作支持，取消下方注释:
-- GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN ALL DATABASES TO USER 'sr_manager'@'%';

-- ============================================================
-- 验证授权结果
-- ============================================================
SHOW GRANTS FOR 'sr_manager'@'%';
