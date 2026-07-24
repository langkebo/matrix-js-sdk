---
module: app_service
generated_from: docs/api-contract/generated/modules/app_service.json
generated_hash: sha256-0e5d047b5bf1ec55953c2402acb8e074c524ca5b986ed1690c5e55742ab67d19
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Application Service API 契约文档

> 后端代码: `synapse-rust/src/web/routes/app_service.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1`

## 一、模块概述

### 1.1 功能描述

Application Service API 提供应用服务（AS）集成功能，用于桥接和机器人。

### 1.2 路由前缀

- `/_matrix/client/v1/user/{user_id}/appservice`
- `/_matrix/app/v1/*`
- `/_synapse/admin/v1/appservices`

### 1.3 认证要求

- 客户端端点：`AuthenticatedUser`
- AS 端点：AS token
- 管理端点：`AdminUser`

## 二、端点详情

### 2.1 AS Ping

**路径**: `POST /_matrix/app/v1/ping`  
**认证**: AS token

**响应**: `200 OK`

```json
{}
```

### 2.2 AS 事务

**路径**: `PUT /_matrix/app/v1/transactions/{as_id}/{txn_id}`  
**认证**: AS token

**请求体**:

```json
{
    "events": []
}
```

**响应**: `200 OK`

```json
{}
```

### 2.3 查询 AS 用户

**路径**: `GET /_matrix/app/v1/users/{user_id}`  
**认证**: AS token

**响应**: `200 OK`

```typescript
interface ASUser {
    user_id: string;
    displayname?: string;
    avatar_url?: string;
}
```

### 2.4 查询 AS 房间

**路径**: `GET /_matrix/app/v1/rooms/{alias}`  
**认证**: AS token

**响应**: `200 OK`

```typescript
interface ASRoom {
    room_id: string;
    alias: string;
}
```

### 2.5 管理 AS（Admin）

**路径**: `GET /_synapse/admin/v1/appservices`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface AppServicesResponse {
    appservices: Array<{
        id: string;
        url: string;
        sender_localpart: string;
        namespaces: object;
    }>;
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 5
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
