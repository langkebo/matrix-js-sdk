---
module: burn_after_read
generated_from: docs/api-contract/generated/modules/burn_after_read.json
generated_hash: sha256-3e0f8eff483c0741865e33ff0fb79c0ac470ca3bf10e99584416f16299bb7ba8
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Burn After Read API 契约文档

> 后端代码: `synapse-rust/src/web/routes/burn_after_read.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1`

## 一、模块概述

### 1.1 功能描述

Burn After Read API 提供阅后即焚功能，消息在阅读后自动删除。

### 1.2 路由前缀

- `/_matrix/client/v1/rooms/{room_id}/burn`
- `/_matrix/client/v1/user/burn/*`

### 1.3 认证要求

- 所有端点需要 `AuthenticatedUser`

## 二、端点详情

### 2.1 设置房间阅后即焚

**路径**: `PUT /_matrix/client/v1/rooms/{room_id}/burn`  
**认证**: `AuthenticatedUser` + 房间成员

**请求体**:

```json
{
    "enabled": true,
    "timeout_ms": 60000
}
```

**响应**: `200 OK`

### 2.2 查询房间阅后即焚状态

**路径**: `GET /_matrix/client/v1/rooms/{room_id}/burn`  
**认证**: `AuthenticatedUser` + 房间成员

**响应**: `200 OK`

```typescript
interface BurnConfig {
    enabled: boolean;
    timeout_ms: number;
}
```

### 2.3 查询待焚毁消息

**路径**: `GET /_matrix/client/v1/rooms/{room_id}/burn/pending`  
**认证**: `AuthenticatedUser` + 房间成员

**响应**: `200 OK`

```typescript
interface PendingBurnResponse {
    events: Array<{
        event_id: string;
        burn_at: number;
    }>;
}
```

### 2.4 手动焚毁消息

**路径**: `POST /_matrix/client/v1/rooms/{room_id}/burn/{event_id}`  
**认证**: `AuthenticatedUser` + 房间成员

**响应**: `200 OK`

### 2.5 用户阅后即焚配置

**路径**: `PUT /_matrix/client/v1/user/burn/config`  
**认证**: `AuthenticatedUser`

**请求体**:

```json
{
    "default_enabled": false,
    "default_timeout_ms": 30000
}
```

**响应**: `200 OK`

### 2.6 用户阅后即焚统计

**路径**: `GET /_matrix/client/v1/user/burn/stats`  
**认证**: `AuthenticatedUser`

**响应**: `200 OK`

```typescript
interface BurnStats {
    total_burned: number;
    rooms_with_burn: number;
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 6
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
