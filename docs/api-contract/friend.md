---
module: friend_room
generated_from: docs/api-contract/generated/modules/friend_room.json
generated_hash: sha256-0125aa2b1cb9e69290f797c6660cf3a942786f02b70537ccb149589c7ee64dad
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Friend 模块契约

> 审查来源: `synapse-rust/src/web/routes/friend_room.rs`
> 对应 SDK 模块: `src/friend/index.ts`

## 本次复核结论

- SDK 主链路明确分层:
    - `GET /_matrix/client/v3/friends` 与 `GET /_matrix/client/v3/friends/search`
    - `POST /_matrix/client/v1/friends/request` 及其 `accept/reject/cancel`
    - 分组、详情、状态、备注统一走 `v1`
- 后端好友列表返回字段比 SDK `Friend` / `IFriendsResponse` 类型更丰富，文档以下文“稳定字段 + 实际扩展字段”方式说明。
- `sendFriendRequest()` 已使用正确请求字段 `message`，但 SDK 目前没有前置校验后端的 `message.len() <= 500` 规则。
- `sendFriendRequest()` 现已补上 `message.len() <= 500` 的前置校验。
- `FriendEvent.NotificationReceived` 仍是预留事件，当前源码中没有触发点；因此不再标记为“事件系统全部触发”。
- `getIncomingRequests()` 的 404 降级逻辑真实存在，会自动 fallback 到 `/friends/requests/incoming`。

## 路由版本

| 前缀                 | 真实后端用途                                     | SDK 当前主入口                  |
| -------------------- | ------------------------------------------------ | ------------------------------- |
| `/_matrix/client/v3` | 列表、发送请求别名、搜索、incoming/outgoing 别名 | `getFriends()`、`searchUsers()` |
| `/_matrix/client/v1` | 请求流转、详情、状态、备注、分组                 | 绝大多数 `FriendManager` 方法   |
| `/_matrix/client/r0` | 历史兼容别名                                     | SDK 不作为默认主路径            |

## 真实端点与 SDK 映射

### 好友与请求

| 方法     | 路径                                                       | 后端行为               | SDK 主入口                                         |
| -------- | ---------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| `GET`    | `/_matrix/client/v3/friends`                               | 好友列表正式入口       | `FriendManager.getFriends()`                       |
| `POST`   | `/_matrix/client/v3/friends`                               | 发送好友请求的兼容别名 | SDK 不默认使用                                     |
| `GET`    | `/_matrix/client/v1/friends`                               | 列表兼容别名           | SDK 不默认使用                                     |
| `POST`   | `/_matrix/client/v1/friends`                               | 发送请求兼容别名       | SDK 不默认使用                                     |
| `GET`    | `/_matrix/client/r0/friendships`                           | 历史列表别名           | SDK 不默认使用                                     |
| `POST`   | `/_matrix/client/r0/friendships`                           | 历史发送别名           | SDK 不默认使用                                     |
| `POST`   | `/_matrix/client/v1/friends/request`                       | 发送好友请求           | `sendFriendRequest()` / `addFriend()`              |
| `GET`    | `/_matrix/client/v1/friends/request/received`              | 正式 incoming 请求入口 | `getIncomingRequests()`                            |
| `POST`   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/accept` | 接受请求               | `acceptFriendRequest()`                            |
| `POST`   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/reject` | 拒绝请求               | `rejectFriendRequest()` / `declineFriendRequest()` |
| `POST`   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/cancel` | 取消请求               | `cancelFriendRequest()`                            |
| `GET`    | `/_matrix/client/{v1,r0,v3}/friends/requests/incoming`     | incoming 兼容别名      | `getIncomingRequests()` 在 404 时 fallback         |
| `GET`    | `/_matrix/client/{v1,r0,v3}/friends/requests/outgoing`     | outgoing 请求          | `getOutgoingRequests()`                            |
| `GET`    | `/_matrix/client/{r0,v1,v3}/friends/search`                | 搜索用户目录           | `searchUsers()`                                    |
| `GET`    | `/_matrix/client/{v1,r0}/friends/check/{user_id}`          | 检查好友关系           | `checkFriendship()`                                |
| `GET`    | `/_matrix/client/{v1,r0}/friends/suggestions`              | 好友建议               | `getFriendSuggestions()`                           |
| `DELETE` | `/_matrix/client/{v1,r0}/friends/{user_id}`                | 删除好友               | `removeFriend()`                                   |
| `PUT`    | `/_matrix/client/{v1,r0}/friends/{user_id}/note`           | 更新备注               | `updateFriendNote()`                               |
| `GET`    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 获取好友状态           | `getFriendStatus()`                                |
| `PUT`    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 更新好友状态           | `updateFriendStatus()`                             |
| `GET`    | `/_matrix/client/{v1,r0}/friends/{user_id}/info`           | 获取好友详情           | `getFriendInfo()`                                  |
| `PUT`    | `/_matrix/client/{v1,r0}/friends/{user_id}/displayname`    | 设置好友显示名         | `setFriendDisplayName()`                           |

### 好友分组

| 方法         | 路径                                                                 | SDK 主入口                                  |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| `GET / POST` | `/_matrix/client/{v1,r0}/friends/groups`                             | `getFriendGroups()` / `createFriendGroup()` |
| `DELETE`     | `/_matrix/client/{v1,r0}/friends/groups/{group_id}`                  | `deleteFriendGroup()`                       |
| `PUT`        | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/name`             | `renameFriendGroup()`                       |
| `POST`       | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/add/{user_id}`    | `addToFriendGroup()`                        |
| `DELETE`     | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/remove/{user_id}` | `removeFromFriendGroup()`                   |
| `GET`        | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/friends`          | `getFriendsInGroup()`                       |
| `GET`        | `/_matrix/client/{v1,r0}/friends/{user_id}/groups`                   | `getGroupsForUser()`                        |

## 参数与返回值对齐

### 发送请求

- 后端请求体来自 `AddFriendRequest`:
    - `user_id`
    - `message?`
- SDK `sendFriendRequest(userId, reason?)` 发送的 body 为:

```json
{
    "user_id": "@target:example.com",
    "message": "optional reason"
}
```

- 参数名与后端一致，且 `message` 长度规则现已对齐:
    - 后端 `friend_room_service.rs` 限制 `message` 长度 `<= 500`
    - SDK 当前已补齐同样的前置校验

### 好友列表

- 后端 `GET /friends` 实际返回:
    - `friends`
    - `items`
    - `total`
    - `limit`
    - `offset`
    - `next_offset`
    - `room_id`
    - `version`
    - `cached`
    - `generated_ts`
- SDK `getFriends()`:
    - 主体只返回 `response.friends || []`
    - 会额外缓存 `room_id`
    - `IFriendsResponse` 当前类型仅显式声明 `friends?`、`total?`、`room_id?`
- 好友条目字段也存在类型漂移:
    - 后端条目使用 `displayname`
    - SDK `Friend` 接口现同时保留 `displayname?` 与归一化后的 `display_name?`
    - 后端还会带 `username`、`presence`、`online`、`last_active_ts`、`last_seen_ts`、`added_ts`、`dm_room_*`

### 请求列表

- 后端 incoming/outgoing 项稳定字段:
    - `user_id`
    - `message`
    - `timestamp`
    - `status`
- SDK `FriendRequest` 额外保留了本地字段:
    - `reason?`
    - `direction?`
    - `request_id?`
- `getIncomingRequests()` / `getOutgoingRequests()` 现会保留原始 `message`，同时补一份归一化 `reason`

### 搜索

- `searchUsers()` 对齐后端查询参数:
    - `q`
    - `mode?: "fuzzy" | "exact"`
    - `limit?`
- 后端稳定返回:
    - `results`
    - `count`
    - `mode`
    - `limited`
    - `retry_after_seconds`
- `results[]` 字段与 SDK `FriendSearchResult` 基本一致，使用 `displayname` 而不是 `display_name`

### 状态、详情与分组

- `getFriendStatus()`:
    - 后端返回整个对象，至少包含 `user_id` 与 `status`
    - 非好友时后端返回 `{ user_id, status: "none", is_friend: false }`
    - SDK 现提供 `getFriendStatusInfo()` 返回完整对象，原 `getFriendStatus()` 继续保留为仅返回 `status` 的兼容 helper
- `getFriendInfo()`:
    - 后端直接返回详情对象
    - `throwOnError = false` 时，SDK 对 `404` 返回 `null`
- `createFriendGroup()`:
    - 后端返回完整 group 对象
    - SDK 仅向调用方返回 `groupId`

## 校验规则

| 端点                            | 字段          | 后端规则                               | SDK 前置校验 |
| ------------------------------- | ------------- | -------------------------------------- | ------------ |
| `POST /friends/request`         | `user_id`     | Matrix ID 格式校验 + 禁止加自己        | 已对齐       |
| `POST /friends/request`         | `message`     | 可选，`len <= 500`                     | 已对齐       |
| `PUT /friends/{id}/note`        | `note`        | `len <= 1000`                          | 已对齐       |
| `PUT /friends/{id}/status`      | `status`      | `favorite / normal / blocked / hidden` | 已对齐       |
| `PUT /friends/{id}/displayname` | `displayname` | `1 <= len <= 256`                      | 已对齐       |
| `POST /friends/groups`          | `name`        | `1 <= len <= 50`                       | 已对齐       |
| `PUT /friends/groups/{id}/name` | `name`        | `1 <= len <= 50`                       | 已对齐       |
| `GET /friends/search`           | `q`           | `trim` 后不能为空                      | 已对齐       |

## 错误语义

| 场景                  | 后端典型返回 | SDK 语义                                                            |
| --------------------- | ------------ | ------------------------------------------------------------------- |
| 未认证                | `401`        | 统一归一化为鉴权类错误                                              |
| 请求目标不存在        | `404`        | `getFriendInfo(false)` 会返回 `null`                                |
| 重复请求 / 已是好友   | `409`        | `sendFriendRequest()` 直接抛错                                      |
| 搜索限流              | `429`        | `searchUsers()` 抛标准 API 错误，响应中可能带 `retry_after_seconds` |
| incoming 历史别名缺失 | `404`        | `getIncomingRequests()` 自动降级到 `/friends/requests/incoming`     |

## 事件系统

| 事件                   | 触发方法                                           | 当前状态         |
| ---------------------- | -------------------------------------------------- | ---------------- |
| `Invited`              | `sendFriendRequest()` / `addFriend()`              | 已触发           |
| `Accepted`             | `acceptFriendRequest()`                            | 已触发           |
| `Rejected`             | `rejectFriendRequest()` / `declineFriendRequest()` | 已触发           |
| `Cancelled`            | `cancelFriendRequest()`                            | 已触发           |
| `Removed`              | `removeFriend()`                                   | 已触发           |
| `RequestReceived`      | `getIncomingRequests()`                            | 已触发           |
| `ListUpdated`          | `acceptFriendRequest()` / `removeFriend()`         | 已触发           |
| `SyncComplete`         | `sync()`                                           | 已触发           |
| `FriendAdded`          | `acceptFriendRequest()`                            | 已触发           |
| `FriendRemoved`        | `removeFriend()`                                   | 已触发           |
| `FriendUpdated`        | `updateFriendNote()` / `updateFriendStatus()`      | 已触发           |
| `RequestSent`          | `sendFriendRequest()` / `addFriend()`              | 已触发           |
| `RequestAccepted`      | `acceptFriendRequest()`                            | 已触发           |
| `RequestRejected`      | `rejectFriendRequest()` / `declineFriendRequest()` | 已触发           |
| `RequestCancelled`     | `cancelFriendRequest()`                            | 已触发           |
| `NotificationReceived` | 无                                                 | 预留，当前未触发 |

## 当前对齐结论

- SDK 已覆盖好友模块全部核心语义端点，但并非所有后端别名都作为默认路径暴露。
- 请求字段名整体对齐，最主要的剩余差异是 `sendFriendRequest()` 未做 `message <= 500` 的前置校验。
- 请求字段名整体已对齐，`sendFriendRequest()` 已补齐 `message <= 500` 的前置校验。
- 返回值层面存在两类真实漂移:
    - 列表/详情字段比 SDK 类型更丰富
    - 部分字段命名存在 `displayname` 与 `display_name` 的不一致
- 事件系统已更新为“已触发事件 + 预留事件”口径，不再错误标记为全量触发。
