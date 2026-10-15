---
module: external_service
generated_from: docs/api-contract/generated/modules/external_service.json
generated_hash: sha256-d0907ce6ac76d28012cf96b2176c9f2dfd44b0de6638e6545ca3fad15236c260
ledger_schema: 4
last_reviewed: 2026-05-03
---

# External Service API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/external_service.rs`  
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1`

## 一、模块概述

### 1.1 功能描述

External Service API 提供外部服务集成功能，包括 webhook 和服务管理。

### 1.2 路由前缀

- 管理端点：`/_synapse/admin/v1/external_services`
- 通用 Webhook：`/_synapse/external/webhook/{service_id}`
- 服务专属 Webhook：`/_synapse/external/{service_type}/{service_id}/webhook`
  —— 后端正**下线**该族：`openclaw` 已删、`trendradar` 待删，SDK 侧对应封装已一并移除

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

**支持的服务类型**（2026-10-15 校核）:

- 通用 `webhook` —— `POST /_synapse/external/webhook/{service_id}`，后端仍注册
- `trendradar` —— **后端待下线**（`external_service.rs:433` 仍在注册）；SDK 封装
  `triggerTrendradarWebhook()` 已于 2026-10-15 移除，见 `CHANGELOG.md` 的 BREAKING 条目
- ~~`openclaw`~~ —— **后端已删除**（全仓已无痕迹）；SDK 封装 `triggerOpenclawWebhook()` 同步移除

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **后端端点数**: 12（`docs/api-contract/generated/modules/external_service.json` 的 `entry_count`）
- **SDK 封装**: 逐条见 `src/external-service/__generated__/route-table.ts`
- **本次移除**: `triggerOpenclawWebhook()`（后端已删）/ `triggerTrendradarWebhook()`（后端待删）

> ⚠️ **订正说明（2026-10-15）**：本节原先写「总端点数 **5** / 已封装 **0** / 覆盖率 **0%**」，
> 两组数字都对不上事实 —— 既不是 ledger 的端点数（12），也不是 SDK 的实际封装数。
> 该值是**从未填写的占位**，且「0 已封装」会让人误以为 SDK 完全没封装外部服务（实际管理面 CRUD
> 与通用 webhook 都已封装）。
> 故**不再在本页维护一个手工覆盖率数字**，改指向上面两个生成物；
> 逐模块「已封装路由数」的可复算口径见 `scripts/audit/route-wrapper-coverage.mjs`
> （诊断用，当前只给**下限**，**不得作判据**）。

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
