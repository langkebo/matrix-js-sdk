---
module: reactions
generated_from: docs/api-contract/generated/modules/reactions.json
generated_hash: sha256-e8b3f60fd5be2ce1263a5067bdce2d4f26b9241954f76d7e20d818e720bb52fe
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Reactions API 契约文档

> 后端代码: `synapse-rust/src/web/routes/reactions.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `r0`, `v3`

## 一、模块概述

### 1.1 功能描述

Reactions API 提供消息反应（emoji 表情回应）功能，是 Relations API 的特化实现。

### 1.2 路由前缀

- `/_matrix/client/{r0,v3}/rooms/{room_id}/send/m.reaction/{txn_id}`

### 1.3 认证要求

- 需要 `AuthenticatedUser`
- 需要房间成员权限

## 二、端点详情

### 2.1 发送反应

**路径**: `PUT /_matrix/client/{r0,v3}/rooms/{room_id}/send/m.reaction/{txn_id}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `r0`, `v3`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间 ID |
| `txn_id` | string | 事务 ID（客户端生成） |

**请求体**:

```json
{
    "m.relates_to": {
        "rel_type": "m.annotation",
        "event_id": "$target_event_id",
        "key": "👍"
    }
}
```

**响应**: `200 OK`

```json
{
    "event_id": "$reaction_event_id"
}
```

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                        | SDK 方法                   | 状态      |
| ------------------------------- | -------------------------- | --------- |
| `PUT /send/m.reaction/{txn_id}` | `MatrixClient.sendEvent()` | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 1
- **已封装**: 1
- **覆盖率**: 100%

### 3.3 已知差异

- SDK 通过通用 `sendEvent()` 方法发送反应
- 无专用的 `sendReaction()` 方法

## 四、常见错误码

| 状态码 | 错误码            | 说明                 |
| ------ | ----------------- | -------------------- |
| 400    | `M_INVALID_PARAM` | 参数无效             |
| 401    | `M_UNAUTHORIZED`  | 未认证               |
| 403    | `M_FORBIDDEN`     | 非房间成员           |
| 404    | `M_NOT_FOUND`     | 目标事件或房间不存在 |

## 五、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
