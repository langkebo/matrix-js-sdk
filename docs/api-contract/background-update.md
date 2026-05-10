---
module: background_update
generated_from: docs/api-contract/generated/modules/background_update.json
generated_hash: sha256-a3e7dcb679f07e4b76daac36ae10e369ab6a26b28c52ad67697ad8cf3e6bde92
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Background Update API 契约文档

> 后端代码: `synapse-rust/src/web/routes/background_update.rs`  
> 装配入口: `synapse-rust/src/web/routes/admin/mod.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1` (Admin)

## 一、模块概述

### 1.1 功能描述

Background Update API 提供后台更新任务管理功能，用于数据库迁移和维护任务。

### 1.2 路由前缀

- `/_synapse/admin/v1/background_updates`

### 1.3 认证要求

- 所有端点需要 `AdminUser`

## 二、端点详情

### 2.1 查询所有后台更新

**路径**: `GET /_synapse/admin/v1/background_updates`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface BackgroundUpdatesResponse {
    updates: Array<{
        name: string;
        status: string;
        progress: number;
        started_ts?: number;
    }>;
}
```

### 2.2 查询更新数量

**路径**: `GET /_synapse/admin/v1/background_updates/count`  
**认证**: `AdminUser`

**响应**: `200 OK`

```json
{
    "count": 5
}
```

### 2.3 查询待处理更新

**路径**: `GET /_synapse/admin/v1/background_updates/pending`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface PendingUpdates {
    pending: string[];
}
```

### 2.4 查询运行中更新

**路径**: `GET /_synapse/admin/v1/background_updates/running`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface RunningUpdates {
    running: Array<{
        name: string;
        progress: number;
        started_ts: number;
    }>;
}
```

### 2.5 获取下一个更新

**路径**: `GET /_synapse/admin/v1/background_updates/next`  
**认证**: `AdminUser`

**响应**: `200 OK`

```json
{
    "name": "update_name"
}
```

### 2.6 查询更新状态

**路径**: `GET /_synapse/admin/v1/background_updates/status`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface UpdateStatus {
    enabled: boolean;
    current_updates: number;
    total_duration_ms: number;
}
```

### 2.7 重试失败更新

**路径**: `POST /_synapse/admin/v1/background_updates/retry_failed`  
**认证**: `AdminUser`

**响应**: `200 OK`

```json
{
    "retried": 3
}
```

### 2.8 清理锁

**路径**: `POST /_synapse/admin/v1/background_updates/cleanup_locks`  
**认证**: `AdminUser`

**响应**: `200 OK`

```json
{}
```

### 2.9 查询任务详情

**路径**: `GET /_synapse/admin/v1/background_updates/{job_name}`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface JobDetail {
    name: string;
    status: string;
    progress: number;
    started_ts?: number;
    completed_ts?: number;
    error?: string;
}
```

### 2.10 查询统计信息

**路径**: `GET /_synapse/admin/v1/background_updates/stats`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface UpdateStats {
    total_updates: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 10
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
