---
module: external_service
generated_from: docs/api-contract/generated/modules/external_service.json
generated_hash: sha256-e7d4681d4a36bff0153e298fb439394d89562a5c5828c6bc9e35955a78b060a7
ledger_schema: 1
last_reviewed: 2026-05-03
---

# External Service API 契约文档

> 后端代码: `synapse-rust/src/web/routes/external_service.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1`

## 一、模块概述

### 1.1 功能描述

External Service API 提供外部服务集成功能，包括 webhook 和服务管理。

### 1.2 路由前缀

- `/_synapse/admin/v1/external_services`
- `/_synapse/external/{service_type}/{service_id}/webhook`

### 1.3 认证要求

- 管理端点：`AdminUser`
- Webhook 端点：服务特定认证

## 二、端点详情

### 2.1 查询所有外部服务（Admin）

**路径**: `GET /_synapse/admin/v1/external_services`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface ExternalServicesResponse {
    services: Array<{
        id: string;
        type: string;
        url: string;
        enabled: boolean;
    }>;
}
```

### 2.2 创建外部服务（Admin）

**路径**: `POST /_synapse/admin/v1/external_services`  
**认证**: `AdminUser`

**请求体**:

```json
{
    "type": "trendradar",
    "url": "https://...",
    "config": {}
}
```

**响应**: `201 Created`

```json
{
    "id": "service_id"
}
```

### 2.3 更新外部服务（Admin）

**路径**: `PUT /_synapse/admin/v1/external_services/{service_id}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.4 删除外部服务（Admin）

**路径**: `DELETE /_synapse/admin/v1/external_services/{service_id}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.5 Webhook 端点

**路径**: `POST /_synapse/external/{service_type}/{service_id}/webhook`  
**认证**: 服务特定  
**挂载版本**: 动态

**支持的服务类型**:

- `trendradar`
- `openclaw`
- 通用 `webhook`

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 5
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
