---
module: ephemeral
generated_from: docs/api-contract/generated/modules/ephemeral.json
generated_hash: sha256-3d9089ffd1f66bc1aec7e0c84b9f0adfdf19408ce8078281c4ea0d7533a51472
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Ephemeral Events API 契约文档

> 后端代码: `synapse-rust/src/web/routes/ephemeral.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v3`

## 一、模块概述

### 1.1 功能描述

Ephemeral Events API 提供临时事件查询功能，用于获取不持久化的房间事件（如输入状态、已读回执）。

### 1.2 路由前缀

- `/_matrix/client/v3/rooms/{room_id}/ephemeral`

### 1.3 认证要求

- 需要 `AuthenticatedUser` + 房间成员权限

## 二、端点详情

### 2.1 查询房间临时事件

**路径**: `GET /_matrix/client/v3/rooms/{room_id}/ephemeral`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v3`

**响应**: `200 OK`

```typescript
interface EphemeralEventsResponse {
    events: Array<{
        type: string;
        content: Record<string, unknown>;
    }>;
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 1
- **已封装**: 0
- **覆盖率**: 0%

### 3.2 已知差异

- SDK 通过 `/sync` 的 ephemeral 字段获取临时事件
- 无直接查询临时事件的方法

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
