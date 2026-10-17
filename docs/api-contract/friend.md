---
module: friend_room
generated_from: docs/api-contract/generated/modules/friend_room.json
generated_hash: sha256-bdaedcde56a3c3391ac4412e4615102bb38c15de51446ec8c25e74f380798f2c
ledger_schema: 4
last_reviewed: 2026-05-11
---

# Friend 模块契约

> 审查来源: `synapse-rust/synapse-web/src/routes/friend_room.rs`
> 对应 SDK 模块: `src/friend/index.ts`

## 本次复核结论

- SDK 主链路实际全部收敛到 vendor 前缀:
    - `GET /_matrix/vendor/v1/friends` 与 `GET|POST /_matrix/vendor/v1/friends/search`
    - `POST /_matrix/vendor/v1/friends/request` 及其 `accept/reject/cancel`
    - 分组、详情、状态、备注、私信、建议均在同一 `/_matrix/vendor/v1/friends*` 前缀下
- 后端好友列表返回字段比 SDK `Friend` / `IFriendsResponse` 类型更丰富，文档以下文“稳定字段 + 实际扩展字段”方式说明。
- `sendFriendRequest()` 已使用正确请求字段 `message`，但 SDK 目前没有前置校验后端的 `message.len() <= 500` 规则。
- `sendFriendRequest()` 现已补上 `message.len() <= 500` 的前置校验。
- `FriendEvent.NotificationReceived` 仍是预留事件，当前源码中没有触发点；因此不再标记为“事件系统全部触发”。
- `getIncomingRequests()` 的 404 降级逻辑真实存在，会自动 fallback 到 `/friends/requests/incoming`。

## 路由版本

| 前缀                 | 真实后端用途                 | SDK 当前主入口            |
| -------------------- | ---------------------------- | ------------------------- |
| `/_matrix/vendor/v1` | 好友 28 条端点全部在此前缀下 | 全部 `FriendManager` 方法 |
| `/_matrix/client/v1` | `/friends*` 路由 0 条        | 无                        |
| `/_matrix/client/v3` | `/friends*` 路由 0 条        | 无                        |
| `/_matrix/client/r0` | `/friends*` 路由 0 条        | 无                        |

## 真实端点与 SDK 映射

### 好友与请求

| 方法     | 路径                                                       | 后端行为                 | SDK 主入口                                         |
| -------- | ---------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| `GET`    | `/_matrix/vendor/v1/friends`                               | 好友列表正式入口         | `FriendManager.getFriends()`                       |
| `POST`   | `/_matrix/vendor/v1/friends`                               | 发送好友请求的兼容别名   | SDK 不默认使用                                     |
| `GET`    | `/_matrix/vendor/v1/friends`                               | 列表兼容别名             | SDK 不默认使用                                     |
| `POST`   | `/_matrix/vendor/v1/friends`                               | 发送请求兼容别名         | SDK 不默认使用                                     |
| `POST`   | `/_matrix/vendor/v1/friends/request`                       | 发送好友请求             | `sendFriendRequest()` / `addFriend()`              |
| `GET`    | `/_matrix/vendor/v1/friends/requests/incoming`             | 收件箱请求的**规范路径** | `getIncomingRequests()`                            |
| `POST`   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/accept` | 接受请求                 | `acceptFriendRequest()`                            |
| `POST`   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/reject` | 拒绝请求                 | `rejectFriendRequest()` / `declineFriendRequest()` |
| `POST`   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/cancel` | 取消请求                 | `cancelFriendRequest()`                            |
| `GET`    | `/_matrix/client/{v1,r0,v3}/friends/requests/incoming`     | incoming 兼容别名        | `getIncomingRequests()` 在 404 时 fallback         |
| `GET`    | `/_matrix/client/{v1,r0,v3}/friends/requests/outgoing`     | outgoing 请求            | `getOutgoingRequests()`                            |
| `GET`    | `/_matrix/client/{r0,v1,v3}/friends/search`                | 搜索用户目录             | `searchUsers()`                                    |
| `GET`    | `/_matrix/client/{v1,r0,v3}/friends/check/{user_id}`       | 检查好友关系             | `checkFriendship()`                                |
| `GET`    | `/_matrix/client/{v1,r0}/friends/suggestions`              | 好友建议                 | `getFriendSuggestions()`                           |
| `DELETE` | `/_matrix/client/{v1,r0}/friends/{user_id}`                | 删除好友                 | `removeFriend()`                                   |
| `PUT`    | `/_matrix/client/{v1,r0}/friends/{user_id}/note`           | 更新备注                 | `updateFriendNote()`                               |
| `GET`    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 获取好友状态             | `getFriendStatus()`                                |
| `PUT`    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 更新好友状态             | `updateFriendStatus()`                             |
| `GET`    | `/_matrix/client/{v1,r0}/friends/{user_id}/info`           | 获取好友详情             | `getFriendInfo()`                                  |
| `PUT`    | `/_matrix/client/{v1,r0}/friends/{user_id}/displayname`    | 设置好友显示名           | `setFriendDisplayName()`                           |

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
    - `retry_after_ms`
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

| 场景                  | 后端典型返回     | SDK 语义                                                        |
| --------------------- | ---------------- | --------------------------------------------------------------- |
| 未认证                | `401`            | 统一归一化为鉴权类错误                                          |
| 请求目标不存在        | `404`            | `getFriendInfo(false)` 会返回 `null`                            |
| 重复请求 / 已是好友   | `400 M_BAD_JSON` | `sendFriendRequest()` 直接抛错                                  |
| 搜索限流              | `429`            | `searchUsers()` 抛标准 API 错误，响应中可能带 `retry_after_ms`  |
| incoming 历史别名缺失 | `404`            | `getIncomingRequests()` 自动降级到 `/friends/requests/incoming` |

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

## 结构化类型（codegen 源）

> 本节是 `scripts/sdk-contract-codegen.mjs` 的 DTO 提取源。这些接口是
> `src/friend/__generated__/dto.ts` 的单一权威，`src/friend/index.ts` 通过
> re-export 引用（ISSUE-2.1：此前 friend 契约 codegen 为空，纯靠人肉同步）。

```typescript
export interface Friend {
    user_id: string;
    reason?: string;
    since?: number;
    display_name?: string;
    displayname?: string;
    username?: string;
    avatar_url?: string;
    note?: string;
    presence?: string;
    online?: boolean;
    last_active_ts?: number;
    last_seen_ts?: number;
    added_ts?: number;
    status?: string;
    dm_room_id?: string;
    dm_room_active?: boolean;
    dm_room_state?: string;
    dm_room_updated_ts?: number;
    dm_room_affected_user_id?: string;
    dm_room_changed_by?: string;
    dm_room_reason?: string;
}

export interface FriendRequest {
    user_id: string;
    reason?: string;
    status: "pending" | "accepted" | "rejected" | "cancelled";
    timestamp?: number;
    display_name?: string;
    displayname?: string;
    avatar_url?: string;
    message?: string;
    direction?: "incoming" | "outgoing";
    request_id?: string;
}

export interface FriendStatusInfo {
    user_id: string;
    status: string;
    is_friend?: boolean;
    are_friends?: boolean;
}

export interface FriendshipCheckResponse {
    user_id: string;
    is_friend: boolean;
    are_friends: boolean;
}

export interface FriendSearchResult {
    user_id: string;
    username?: string;
    displayname?: string;
    avatar_url?: string;
    presence?: string;
    online?: boolean;
    last_active_ts?: number;
    last_seen_ts?: number;
    created_ts?: number;
    match_score?: number;
    match_type?: string;
}

export interface FriendSearchResponse {
    results?: FriendSearchResult[];
    count?: number;
    mode?: string;
    limited?: boolean;
    retry_after_ms?: number;
}

export interface FriendGroup {
    id: string;
    name: string;
    members: string[];
    created_at?: number;
    updated_ts?: number;
}

export interface IFriendsResponse {
    friends?: Friend[];
    items?: Friend[];
    total?: number;
    limit?: number;
    offset?: number;
    next_offset?: number;
    next_batch?: string;
    room_id?: string;
    version?: number;
    cached?: boolean;
    generated_ts?: number;
}
```

## 实现口径补充（2026-10-17 后端契约回灌）

### 列表分页与响应

- Keyset 分页：`from` 即上一页响应的 `next_batch`；`limit` 默认 `50`，clamp 到 `1..=200`；`sort_by` 默认 `alphabet`；`offset > 0` 且未提供 `from` 时返回 `400 M_BAD_JSON`（`Legacy offset pagination is no longer supported; use from cursor`）。
- 响应外层键为 `friends`；`next_batch: null` 表示已到底；`room_id` / `version` / `cached` 是内部实现字段，客户端不要依赖。
- `status` 是关系状态（`favorite | normal | blocked | hidden`），在线状态看 `presence` / `online`；好友条目还包含 `username`、`sort_letter`、`dm_room_id`、`dm_room_active`、`dm_room_state`。

### 请求流转

- 发送好友请求的请求体为 `{user_id, message?}`；成功响应形如 `{request_id:"42", status:"pending"}`，其中 `request_id` 是字符串。
- 加自己或重复请求返回 `400`；请求项包含 `displayname` / `avatar_url`。
- 路径参数是 `{user_id}`，不是 `{request_id}`；拒绝动作是 `reject`，不是 `decline`。
- `accept` 返回 `{room_id, status:"accepted"}`，并顺带创建私信房间。

### 搜索与建议

- 搜索同时接受 `q` 与 `query`；空白或缺失返回 `400`；搜索限流使用独立 429 预算。
- 搜索结果仅包含可见用户（共享房间过滤），条目带 `match_score` / `match_type`。
- 建议接口返回 `{suggestions: [...]}`。

### 私信房间

- `GET /_matrix/vendor/v1/friends/dm/{user_id}` 返回 `{room_id: string | null, user_id}`；没有私信房间时 `room_id` 为 `null`，不是 404。
- `POST /_matrix/vendor/v1/friends/dm/{user_id}` 返回 `{room_id, user_id, created}`，幂等且不读取请求体。
- 新建房间固定为 `visibility=private`、`preset=private_chat`、`is_direct=true`，客户端无法覆盖。

### 其他

- 所有请求体都启用 `deny_unknown_fields`，多传字段直接返回 `400 M_BAD_JSON`。
- 旧 `/friends/requests` 路径不存在；待处理列表使用 `/friends/requests/incoming` 与 `/friends/requests/outgoing`。
- 本页上方路由表仍保留历史 client 前缀行，实际 `/friends*` 端点全部位于 `/_matrix/vendor/v1`；`client v1/v3/r0` 为 0 条。
- SDK 生成 DTO `src/friend/__generated__/dto.ts` 已由 `pnpm contract:codegen` 对齐为 `retry_after_ms`。
