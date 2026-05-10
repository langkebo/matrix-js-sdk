---
module: friend_room
generated_from: docs/api-contract/generated/modules/friend_room.json
generated_hash: sha256-e07aa0ca791cb97140673fe4808662f3fa31f71207b23e5ec73b6eb88a7bae73
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Friend 模块契约

> 审查来源: `synapse-rust/src/web/routes/friend_room.rs`

## 路由版本

| 前缀                 | 说明                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `/_matrix/client/v3` | `GET/POST /friends` 正式契约，作为好友列表与发送请求的主入口     |
| `/_matrix/client/v1` | `friends/request/*` 与好友详情/分组能力的正式契约前缀            |
| `/_matrix/client/r0` | 兼容别名层，`/friendships` 等历史路径逐步废弃，不作为 SDK 主入口 |

## 好友与请求

| 方法   | 路径                                                       | 说明              |
| ------ | ---------------------------------------------------------- | ----------------- |
| GET    | `/_matrix/client/v3/friends`                               | 获取好友列表      |
| POST   | `/_matrix/client/v3/friends`                               | 发送好友请求      |
| GET    | `/_matrix/client/v1/friends`                               | 兼容列表别名      |
| POST   | `/_matrix/client/v1/friends`                               | 兼容发送别名      |
| GET    | `/_matrix/client/r0/friendships`                           | 兼容列表别名      |
| POST   | `/_matrix/client/r0/friendships`                           | 兼容发送别名      |
| POST   | `/_matrix/client/v1/friends/request`                       | 发送好友请求      |
| GET    | `/_matrix/client/v1/friends/request/received`              | 获取收到的请求    |
| POST   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/accept` | 接受请求          |
| POST   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/reject` | 拒绝请求          |
| POST   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/cancel` | 取消请求          |
| GET    | `/_matrix/client/v1/friends/requests/incoming`             | incoming 兼容别名 |
| GET    | `/_matrix/client/v1/friends/requests/outgoing`             | outgoing 请求     |
| GET    | `/_matrix/client/{v1,r0}/friends/check/{user_id}`          | 检查好友关系      |
| GET    | `/_matrix/client/{v1,r0}/friends/suggestions`              | 好友建议          |
| DELETE | `/_matrix/client/{v1,r0}/friends/{user_id}`                | 删除好友          |
| PUT    | `/_matrix/client/{v1,r0}/friends/{user_id}/note`           | 更新好友备注      |
| GET    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 获取好友状态      |
| PUT    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 更新好友状态      |
| GET    | `/_matrix/client/{v1,r0}/friends/{user_id}/info`           | 获取好友信息      |

## 好友分组

| 方法   | 路径                                                                 | 说明             |
| ------ | -------------------------------------------------------------------- | ---------------- |
| GET    | `/_matrix/client/{v1,r0}/friends/groups`                             | 获取分组列表     |
| POST   | `/_matrix/client/{v1,r0}/friends/groups`                             | 创建分组         |
| DELETE | `/_matrix/client/{v1,r0}/friends/groups/{group_id}`                  | 删除分组         |
| PUT    | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/name`             | 重命名分组       |
| POST   | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/add/{user_id}`    | 添加好友到分组   |
| DELETE | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/remove/{user_id}` | 从分组移除好友   |
| GET    | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/friends`          | 获取分组内好友   |
| GET    | `/_matrix/client/{v1,r0}/friends/{user_id}/groups`                   | 获取用户所属分组 |
| PUT    | `/_matrix/client/{v1,r0}/friends/{user_id}/displayname`              | 设置好友显示名   |

## 请求体与响应字段

- `send_friend_request`: 请求体结构来自 `AddFriendRequest`
    - `user_id`
    - `message?`
- `update_note`: 请求体结构来自 `UpdateNoteRequest`
    - `note`
- `update_status`: 请求体结构来自 `UpdateStatusRequest`
    - `status`
- 请求/好友列表常见字段:
    - `user_id`
    - `display_name?`
    - `avatar_url?`
    - `message?`
    - `timestamp`
- `GET /friends`: 返回 `friends`、`total`、`room_id`

## 认证与状态码

- 全部好友路由都需要用户 access token。
- 常见状态码: `200` `400` `401` `404` `409`

## 后端校验规则

> 规则来源：`synapse-rust/src/web/routes/friend_room.rs`  
> 前端 SDK 已与后端校验规则完全对齐（2026-05-05 审计确认）。

| 端点 | 校验字段 | 后端规则 | 前端 SDK 校验 |
|------|---------|---------|:---:|
| `POST /friends/request` | `user_id` | 格式校验 + 禁止添加自己 | ✅ |
| `POST /friends/request` | `message` | 可选字符串，无长度限制 | ✅ |
| `PUT /friends/{id}/note` | `note` | `len <= 1000` | ✅ |
| `PUT /friends/{id}/status` | `status` | `"favorite" / "normal" / "blocked" / "hidden"` | ✅ |
| `PUT /friends/{id}/displayname` | `displayname` | `1 <= len <= 256` | ✅ |
| `POST /friends/groups` | `name` | `1 <= len <= 50` | ✅ |
| `PUT /friends/groups/{id}/name` | `name` | `1 <= len <= 50` | ✅ |
| 全端点通用 | `user_id` | Matrix 用户 ID 格式校验 | ✅ |

## 事件系统

| 事件 | 触发方法 | 参数 |
|------|---------|------|
| `FriendEvent.Invited` | `sendFriendRequest` / `addFriend` | `(userId: string, request: FriendRequest)` |
| `FriendEvent.Accepted` | `acceptFriendRequest` | `(userId: string)` |
| `FriendEvent.Rejected` | `rejectFriendRequest` / `declineFriendRequest` | `(userId: string)` |
| `FriendEvent.Cancelled` | `cancelFriendRequest` | `(userId: string)` |
| `FriendEvent.Removed` | `removeFriend` | `(userId: string)` |
| `FriendEvent.ListUpdated` | `acceptFriendRequest` / `removeFriend` | `()` |
| `FriendEvent.SyncComplete` | `sync()` | `()` |
| `FriendEvent.FriendAdded` | `acceptFriendRequest` | `(friend: Friend)` |
| `FriendEvent.FriendRemoved` | `removeFriend` | `(userId: string)` |
| `FriendEvent.FriendUpdated` | `updateFriendNote` / `updateFriendStatus` | `(friend: Friend)` |
| `FriendEvent.RequestSent` | `sendFriendRequest` / `addFriend` | `(userId: string)` |
| `FriendEvent.RequestAccepted` | `acceptFriendRequest` | `(userId: string)` |
| `FriendEvent.RequestRejected` | `rejectFriendRequest` / `declineFriendRequest` | `(userId: string)` |
| `FriendEvent.RequestCancelled` | `cancelFriendRequest` | `(userId: string)` |
| `FriendEvent.RequestReceived` | `getIncomingRequests` | `(request: FriendRequest)` |

## 后端验证状态

| 验证项 | 状态 |
|-------|:---:|
| 全部 29 条后端路由是否存在对应前端方法 | ✅ |
| 请求体字段名是否前后端一致 | ✅ |
| 响应字段结构是否前后端一致 | ✅ |
| 校验规则是否前后端对齐 | ✅ |
| 事件系统是否全部触发 | ✅ |
| 向后兼容降级逻辑 | ✅ （`getIncomingRequests` 自动降级到 `/friends/requests/incoming`） |

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/friend_room.rs`

## SDK Manager 对应关系

> 更新日期: 2026-05-05
> 审计状态: ✅ 已审计，映射关系已修正

### 好友与请求

| 端点                                     | SDK Manager     | 方法                                               | 状态        |
| ---------------------------------------- | --------------- | -------------------------------------------------- | ----------- |
| `GET /friends` (v3)                      | `FriendManager` | `getFriends()` / `getFriendsList()`                | ✅ 已封装   |
| `POST /friends` (v3)                     | `FriendManager` | —                                                  | ℹ️ 版本别名，实际使用 v1 `/friends/request` |
| `POST /friends/request`                  | `FriendManager` | `sendFriendRequest()` / `addFriend()`              | ✅ 已封装   |
| `GET /friends/request/received`          | `FriendManager` | `getIncomingRequests()`                            | ✅ 已封装   |
| `POST /friends/request/{user_id}/accept` | `FriendManager` | `acceptFriendRequest()`                            | ✅ 已封装   |
| `POST /friends/request/{user_id}/reject` | `FriendManager` | `rejectFriendRequest()` / `declineFriendRequest()` | ✅ 已封装   |
| `POST /friends/request/{user_id}/cancel` | `FriendManager` | `cancelFriendRequest()`                            | ✅ 已封装   |
| `GET /friends/requests/incoming`         | `FriendManager` | 无新增主封装                                       | ℹ️ 兼容别名 |
| `GET /friends/requests/outgoing`         | `FriendManager` | `getOutgoingRequests()`                            | ✅ 已封装   |
| `GET /friends/check/{user_id}`           | `FriendManager` | `checkFriendship()`                                | ✅ 已封装   |
| `GET /friends/suggestions`               | `FriendManager` | `getFriendSuggestions()`                           | ✅ 已封装   |
| `DELETE /friends/{user_id}`              | `FriendManager` | `removeFriend()`                                   | ✅ 已封装   |
| `PUT /friends/{user_id}/note`            | `FriendManager` | `updateFriendNote()`                               | ✅ 已封装   |
| `GET /friends/{user_id}/status`          | `FriendManager` | `getFriendStatus()`                                | ✅ 已封装   |
| `PUT /friends/{user_id}/status`          | `FriendManager` | `updateFriendStatus()`                             | ✅ 已封装   |
| `GET /friends/{user_id}/info`            | `FriendManager` | `getFriendInfo()`                                  | ✅ 已封装   |
| `PUT /friends/{user_id}/displayname`     | `FriendManager` | `setFriendDisplayName()`                           | ✅ 已封装   |

## 当前对齐结论

- SDK 当前以 `GET /_matrix/client/v3/friends`（获取列表）和 `/_matrix/client/v1/friends/request/*`（请求操作）作为主链路。
- `POST /_matrix/client/v3/friends`、`/_matrix/client/v1/friends`、`/_matrix/client/r0/friendships`、`/_matrix/client/v1/friends/requests/incoming` 及 `/v3/friends/requests/*` 视为后端兼容别名，不作为 SDK 默认接入路径。
- `sendFriendRequest()` 请求体已经与后端 `AddFriendRequest` 对齐，发送字段为 `message`，使用 `POST /v1/friends/request` 路径。
- `getFriendInfo()` 当前走专用端点 `GET /friends/{user_id}/info`，不再退化为全量好友列表扫描。
- `getFriends()` 会接收并缓存 `room_id`，`ensureFriendListRoom()` 仅复用该返回值，不混用发送好友请求入口。
- `getIncomingRequests()` 只封装正式契约 `GET /friends/request/received`，`/friends/requests/incoming` 保留为服务端兼容别名。
- `PUT /friends/{user_id}/displayname` 已纳入当前契约，可按文档直接使用。
- `FriendEvent` 全部 15 个枚举值均已被正确触发，不存在死代码事件。

### Manager 初始化

```typescript
import { createClient, extendMatrixClientWithManagers } from "matrix-js-sdk";

// 初始化所有 Manager
await extendMatrixClientWithManagers();

const client = createClient({ baseUrl: "https://matrix.org" });

// 获取 FriendManager 实例
const friendManager = client.getFriendManager();

// 发送好友请求
await friendManager.sendFriendRequest("@user:matrix.org", "Hi!");

// 检查好友关系
const isFriend = await friendManager.checkFriendship("@user:matrix.org");

// 更新好友备注
await friendManager.updateFriendNote("@user:matrix.org", "Best friend");

// 创建分组
const groupId = await friendManager.createFriendGroup("Close Friends");

// 添加好友到分组
await friendManager.addToFriendGroup(groupId, "@user:matrix.org");
```

### FriendManager 特性

- ✅ 事件系统 (`FriendEvent`) — 15 个事件全部触发
- ✅ 好友缓存 (`LRU Map<string, Friend>`，容量 500，TTL 5 分钟)
- ✅ 请求缓存 (`Map<string, FriendRequest>`)
- ✅ 分组缓存 (`FriendGroups`)
- ✅ 参数验证 (`AdminValidators.validateUserId` + 字段长度/格式校验，与后端对齐)
- ✅ 统一错误处理 (`normalizeError`)
- ✅ 向后兼容降级 (`getIncomingRequests` 主路径 404 时降级到兼容别名)
- ⚠️ `isFriend()` 已弃用，请迁移到 `checkFriendship()`，运行时输出 `logger.warn` 提示
