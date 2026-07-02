---
module: dm
generated_from: docs/api-contract/generated/modules/dm.json
generated_hash: sha256-69da076cde1c2a3f39aa5caa16cc7411948dfa0ebb4efed973c18c165e937926
ledger_schema: 1
last_reviewed: 2026-05-11
---

# DM 模块契约

> 审查来源: `synapse-rust/src/web/routes/dm.rs`
> 对应 SDK 模块: `src/dm/index.ts`

## 本次复核结论

- `DirectMessageManager` 是混合型 manager，不只是后端 HTTP wrapper:
  - 一部分功能走本地 `m.direct` account data
  - 一部分功能走 room scan fallback
  - 一部分功能才走 `dm.rs` 提供的专用 HTTP 路由
- `GET /rooms/{room_id}/dm` 的真实返回字段是 `{ "room_id": "...", "m.direct": true }`，不是 `is_dm`。
- `updateDirectRoom()` 现在既支持原有 `{ users }` 写法，也支持后端原始 `{ content }` 写法，并返回完整响应。
- `createDmRoom()` 仍保留“返回 `room_id` 字符串”的兼容 helper；若需要后端原始响应，可使用 `createDmRoomDetailed()`。
- `createDmRoomDetailed()` / `createDmRoom()` 现已支持 `invite[]`、`visibility`。

## 三层能力边界

| 能力层 | 具体方法 | 是否属于后端 HTTP 契约 |
| --- | --- | --- |
| 本地 `m.direct` 读写 | `getDirectRoomsByUser()`、`setDmRoom()`、`removeDmRoom()` | 否 |
| room scan / 本地推断 | `getDMRoomsFromRoomScan()`、`checkRoomIsDm()`、`getDmPartner()` | 否 |
| 专用后端 DM API | `createDmRoomDetailed()`、`createDmRoom()`、`getDirectRoomsFromServer()`、`updateDirectRoom()`、`isDmRoomFromServer()`、`getDmPartnerFromServer()` | 是 |

## 真实后端路由

| 方法 | 路径 | 说明 | SDK 主入口 |
| --- | --- | --- | --- |
| `POST` | `/_matrix/client/r0/create_dm` | 创建私聊房间兼容前缀 | SDK 默认走 `v3` |
| `POST` | `/_matrix/client/v3/create_dm` | 创建私聊房间 | `createDmRoom()` |
| `GET` | `/_matrix/client/r0/direct` | 获取 `m.direct` 映射兼容前缀 | SDK 默认走 `v3` |
| `PUT` | `/_matrix/client/r0/direct/{room_id}` | 更新 direct map 兼容前缀 | SDK 默认走 `v3` |
| `GET` | `/_matrix/client/v3/direct` | 获取当前用户 direct map | `getDirectRoomsFromServer()` |
| `PUT` | `/_matrix/client/v3/direct/{room_id}` | 更新某房间的 direct map | `updateDirectRoom()` |
| `GET` | `/_matrix/client/v3/rooms/{room_id}/dm` | 判断房间是否为 DM | `isDmRoomFromServer()` |
| `GET` | `/_matrix/client/v3/rooms/{room_id}/dm/partner` | 获取 DM 对端资料 | `getDmPartnerFromServer()` |

## 参数与返回值对齐

### `POST /create_dm`

- 后端请求体支持:
  - `user_id?`
  - `invite?`
  - `is_direct?`
  - `name?`
  - `topic?`
  - `visibility?`
- `DirectMessageManager.createDmRoomDetailed(userId, options?)` / `createDmRoom(userId, options?)` 当前发送:

```json
{
  "user_id": "@user:example.com",
  "invite": ["@user:example.com", "@other:example.com"],
  "is_direct": true,
  "name": "optional",
  "topic": "optional",
  "visibility": "private"
}
```

- 因此:
  - `user_id`、`invite[]`、`is_direct`、`name`、`topic`、`visibility` 已对齐
  - `createDmRoomDetailed()` 返回后端原始 `{ room_id }`
  - `createDmRoom()` 在其上层继续返回 `room_id: string`

### `GET /direct`

- 后端稳定返回:

```json
{
  "rooms": {
    "@alice:example.com": ["!room:example.com"]
  }
}
```

- SDK `getDirectRoomsFromServer()` 只返回 `response.rooms || {}`
- 本地 `getDirectRoomsByUser()` 读取的是 account data 中的 `m.direct`，不是此 HTTP 端点

### `PUT /direct/{room_id}`

- 后端 `update_dm_room()` 支持两种 body:
  - `{ "users": ["@alice:example.com"] }`
  - `{ "content": { ... } }`
- SDK `updateDirectRoom()` 当前支持两种调用:
  - `updateDirectRoom(roomId, userIds)`
  - `updateDirectRoom(roomId, { userIds })`
  - `updateDirectRoom(roomId, { content })`
- `users` 写法示例:

```json
{
  "users": ["@alice:example.com"]
}
```

- 后端成功响应包含:
  - `room_id`
  - `users`
  - `direct_map`
  - `updated_ts`
- SDK 现在返回同样结构的 `UpdateDirectRoomResponse`
- `users` 写法会对每个用户 ID 做 Matrix ID 校验；`content` 写法透传给后端

### `GET /rooms/{room_id}/dm`

- 后端真实行为:
  - 是 DM: 返回 `{ "room_id": "!room:example.com", "m.direct": true }`
  - 非 DM: 返回 `404 M_NOT_FOUND`
- SDK `isDmRoomFromServer()` 读取 `response["m.direct"] ?? false`
- `throwOnError = false` 时，SDK 会把 `404` 归一为 `false`

### `GET /rooms/{room_id}/dm/partner`

- 后端稳定返回:
  - `room_id`
  - `user_id`
  - `display_name`
  - `avatar_url`
- SDK `DmPartnerResponse` 当前声明为:
  - `room_id`
  - `user_id`
  - `display_name`
  - `avatar_url`
- `throwOnError = false` 时，SDK 在 `404` 返回 `null`

## SDK 其他 DM 能力

### `createDm()`

- `createDm()` 不调用后端 `create_dm` 路由，而是:
  - 走 `client.createRoom(...)`
  - 之后本地调用 `setDmRoom()` 更新 `m.direct`
- 这属于客户端侧组合封装，不应与 `createDmRoom()` 混淆

### `getDMRooms()`

- 先读取本地 `m.direct`
- 若映射为空，再回退到扫描本地房间成员关系
- 这不是后端 DM 专用 HTTP 契约的一部分

## 错误语义

| 场景 | 后端典型返回 | SDK 语义 |
| --- | --- | --- |
| 未认证 | `401` | 统一归一化为鉴权类错误 |
| `room_id` 非 DM | `404 M_NOT_FOUND` | `isDmRoomFromServer(false)` 返回 `false` |
| 对端不存在 | `404 M_NOT_FOUND` | `getDmPartnerFromServer(false)` 返回 `null` |
| `users` / `content` 结构非法 | `400 Bad Request` | `updateDirectRoom()` 抛标准 API 错误 |
| `users` 中用户 ID 非法 | 本地校验失败 | `updateDirectRoom()` 抛 `InvalidParamError` |

## 事件系统

| 事件 | 触发方法 | 说明 |
| --- | --- | --- |
| `DMCreated` | `createDm()`、`createDmRoom()` | 本地创建与专用 API 创建都会触发 |
| `DMLeft` | `leaveDm()` | 离开房间后触发 |
| `DMUpdated` | `setDmRoom()`、`removeDmRoom()`、`updateDirectRoom()` | 只表示本地缓存 / direct map 已更新 |
| `ListUpdated` | `createDm()`、`createDmRoom()`、`leaveDm()`、`setDmRoom()`、`removeDmRoom()`、`updateDirectRoom()` | 列表重新计算信号 |

## 当前对齐结论

- DM 文档已明确区分“本地 `m.direct` 行为”和“后端 DM HTTP 契约”，避免把整个 `DirectMessageManager` 误写成纯后端封装。
- `createDmRoomDetailed()` 已暴露后端原始 `{ room_id }` 响应；`createDmRoom()` 继续保留 `string` helper。
- `createDmRoom()` / `createDmRoomDetailed()` 已扩展，支持 `invite[]` 与 `visibility`。
- `updateDirectRoom()` 已扩展，返回后端完整响应。
- `rooms/{room_id}/dm` 的返回字段口径已修正为 `"m.direct"`。
- `updateDirectRoom()` 已同时支持 `{ users }` 和 `{ content }` 两种写法。
