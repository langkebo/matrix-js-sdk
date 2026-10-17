---
module: reactions
generated_from: docs/api-contract/generated/modules/reactions.json
generated_hash: sha256-d0b9b38e537f196ad411455be54385fc49a683b16ef43ffc4e19bf522f3bc05b
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Reactions API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/reactions.rs`  
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v3`

## 一、模块概述

### 1.1 功能描述

Reactions API 提供消息反应（emoji 表情回应）功能，是 Relations API 的特化实现。

### 1.2 路由前缀

- `/_matrix/client/v3/rooms/{room_id}/send/m.reaction/{txn_id}`

### 1.3 认证要求

- 需要 `AuthenticatedUser`
- 需要房间成员权限

## 二、端点详情

### 2.1 发送反应

**路径**: `PUT /_matrix/client/v3/rooms/{room_id}/send/m.reaction/{txn_id}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v3`

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

| 后端端点                                                          | SDK 方法                   | 状态      |
| ----------------------------------------------------------------- | -------------------------- | --------- |
| `PUT /_matrix/client/v3/rooms/{room_id}/send/m.reaction/{txn_id}` | `MatrixClient.sendEvent()` | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 1
- **已封装**: 1
- **覆盖率**: 100%

### 3.3 已知差异

- SDK 通过通用 `sendEvent()` 方法发送反应
- 无专用的 `sendReaction()` 方法

## 四、常见错误码

| 状态码 | 错误码           | 说明                                                |
| ------ | ---------------- | --------------------------------------------------- |
| 400    | `M_BAD_JSON`     | 缺失 `m.relates_to` 或 `rel_type` 非 `m.annotation` |
| 401    | `M_UNAUTHORIZED` | 未认证                                              |
| 403    | `M_FORBIDDEN`    | 非房间成员                                          |
| 404    | `M_NOT_FOUND`    | 目标事件或房间不存在                                |

## 五、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |

## 实现口径补充（2026-10-17 后端契约回灌）

### 挂载版本

- 该路由只挂在 `v3`；`r0` 前缀没有对应路由，调用 `r0` 会返回 404。

### 请求体与校验

- 必须携带 `m.relates_to`，其中 `rel_type` 必须为 `m.annotation`、`event_id` 指向目标事件；缺失 `m.relates_to` 或 `rel_type` 不符均返回 400 `M_BAD_JSON`。
- 后端同时接受 `m.relates_to` 与不带点号的 `relates_to` 两种键名（兼容旧客户端），两者同时存在时以标准键 `m.relates_to` 为准。

### `key` 的回退顺序

- 反应内容按 `key` → `body` → `👍` 依次取值：先读 `m.relates_to.key`，缺失时读顶层 `body`，两者都没有则落为 `👍`。
- 因此 SDK 未显式传 `key` 时，服务端不会报错，而是写入默认表情。

### 权限与错误

- 调用方不是房间成员返回 403 `M_FORBIDDEN`；房间存在但用户无权限时同样是 403，不是 404。
- 目标事件或房间不存在返回 404 `M_NOT_FOUND`。
- 发送路径使用 `(user, device, txn_id, event_type)` 作为幂等键，重试时需保持 `txn_id` 与 `event_type` 不变，否则会产生重复反应事件。

### 撤回反应

- 撤回一条 reaction 不是删除接口，而是对反应事件本身执行 redact：`PUT|POST /_matrix/client/v3/rooms/{room_id}/redact/{event_id}/{txn_id}`（`txn_id` 必填）。
- 撤回后目标消息的聚合计数随之减少，聚合结果以 Relations API 的 `m.annotation` 聚合为准。
