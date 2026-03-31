---
name: audit-logging
description: 审计日志记录规范。所有变更类操作（API 增删改、后台任务执行）必须记录审计日志，确保操作可追溯。
---

# Audit Logging — 审计日志记录规范

> **核心原则：** 任何对系统状态产生变更的操作（用户触发的 API、后台定时任务），都**必须**记录审计日志。  
> **核心文件：**  
> - `src/lib/local-db.ts` — `recordAuditLog()` 函数 & `RecordAuditParams` 接口  
> - `audit_logs` 表 — 审计记录存储

---

## 1. 必须记录审计日志的场景

| 场景 | 触发源 | 示例 |
|------|--------|------|
| **API 变更操作** | 用户通过前端触发的 POST/PUT/DELETE | 创建集群、删除用户、执行SQL、手动同步血缘 |
| **后台定时任务** | 服务端 singleton 定时器自动触发 | 血缘定时采集、定时健康检查 |
| **配置变更** | 用户修改系统配置 | 审计级别变更、调度频率修改 |
| **认证事件** | 登录/登出 | 用户登录成功/失败 |

> [!CAUTION]
> **GET/读取操作不需要记录审计日志**。只有对数据或状态产生变更的操作才需要。

---

## 2. 审计日志 API

### 2.1 函数签名

```typescript
import { recordAuditLog } from '@/lib/local-db';

await recordAuditLog({
  userId: number | null,       // 用户 ID，系统任务传 null
  username: string,            // 用户名，系统任务传 'system'
  action: string,              // 操作标识（见下方命名规范）
  category: string,            // 分类（功能模块名）
  level: 'basic' | 'standard' | 'full',  // 审计级别
  target?: string,             // 操作目标描述
  detail?: string | object,    // 详细信息（对象会自动 JSON.stringify）
  ipAddress?: string,          // 客户端 IP
});
```

### 2.2 action 命名规范

格式：`{模块}.{操作}`

| 模块 | action 示例 | 说明 |
|------|-------------|------|
| cluster | `cluster.create` / `cluster.update` / `cluster.delete` | 集群管理 |
| user | `user.create` / `user.update` / `user.delete` | 用户管理 |
| auth | `auth.login` / `auth.login_failed` / `auth.logout` | 认证 |
| query | `query.execute` | SQL 执行 |
| grant | `grant.update` | 权限授予 |
| lineage | `lineage.sync` / `lineage.auto_sync` / `lineage.schedule` | 血缘管理 |
| config | `config.update` | 系统配置 |

### 2.3 审计级别选择

| 级别 | 说明 | 使用场景 |
|------|------|----------|
| `basic` | 基础审计 | 高影响操作：集群增删改、用户管理、权限变更 |
| `standard` | 标准审计 | 常规变更操作：SQL 执行、血缘同步、配置修改 |
| `full` | 完整审计 | 低影响/高频操作：只在 full 级别下记录 |

---

## 3. 使用模板

### 3.1 API 路由中的审计（用户触发）

```typescript
import { requireAuth } from '@/lib/auth';
import { recordAuditLog } from '@/lib/local-db';

export async function POST(request: NextRequest) {
  const { user } = await requireAuth(request);
  
  // ... 执行业务逻辑 ...
  
  // 审计日志
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
           || request.headers.get('x-real-ip') || '';
  await recordAuditLog({
    userId: user.id,
    username: user.username,
    action: 'module.action',
    category: 'module',
    level: 'standard',
    target: '操作目标描述',
    detail: { /* 关键上下文 */ },
    ipAddress: ip,
  });
}
```

### 3.2 后台任务中的审计（系统触发）

```typescript
import { recordAuditLog } from '@/lib/local-db';

async function runScheduledTask(): Promise<void> {
  try {
    // ... 执行任务 ...
    
    await recordAuditLog({
      userId: null,
      username: 'system',
      action: 'module.auto_action',
      category: 'module',
      level: 'standard',
      target: '操作目标',
      detail: {
        trigger: 'scheduled',
        // ... 任务结果 ...
      },
    });
  } catch (err) {
    // 失败也要审计
    await recordAuditLog({
      userId: null,
      username: 'system',
      action: 'module.auto_action',
      category: 'module',
      level: 'standard',
      target: '操作目标',
      detail: {
        trigger: 'scheduled',
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
```

---

## 4. Checklist（新增变更操作时必须检查）

- [ ] API POST/PUT/DELETE 是否调用了 `recordAuditLog()`
- [ ] action 命名是否遵循 `{模块}.{操作}` 格式
- [ ] 后台定时任务的成功/失败是否都有审计记录
- [ ] userId 是否正确（用户操作传 `user.id`，系统任务传 `null`）
- [ ] username 是否正确（用户操作传 `user.username`，系统任务传 `'system'`）
- [ ] detail 中是否包含了足够的上下文信息用于事后追溯
- [ ] level 选择是否合理（参考 2.3 表格）

---

## 5. ⚠ 常见遗漏

1. **后台定时任务**：新增 singleton 服务（如 `lineage-scheduler.ts`、`health-monitor.ts`）中的自动执行逻辑，容易忘记审计
2. **批量操作**：一次请求影响多条数据时，至少记录一条汇总审计
3. **失败场景**：操作失败也应记录审计，`detail` 中带上 `status: 'FAILED'` 和错误信息
4. **配置变更**：用户修改调度频率、审计级别等系统配置时，必须审计新旧值
