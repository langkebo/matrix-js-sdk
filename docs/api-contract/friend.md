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

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/friend_room.rs`

## SDK Manager 对应关系

> 更新日期: 2026-04-12
> 审计状态: ✅ 当前实现已与文档对齐

### 好友与请求

| 端点                                     | SDK Manager     | 方法                                               | 状态        |
| ---------------------------------------- | --------------- | -------------------------------------------------- | ----------- |
| `GET /friends`                           | `FriendManager` | `getFriends()` / `getFriendsList()`                | ✅ 已封装   |
| `POST /friends`                          | `FriendManager` | `sendFriendRequest()` / `addFriend()`              | ✅ 已封装   |
| `POST /friends/request`                  | `FriendManager` | `sendFriendRequest()`                              | ✅ 已封装   |
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

- SDK 当前以 `GET/POST /_matrix/client/v3/friends` 和 `/_matrix/client/v1/friends/request/*` 作为主链路。
- `/_matrix/client/v1/friends`、`/_matrix/client/r0/friendships`、`/_matrix/client/v1/friends/requests/incoming` 视为后端兼容别名，不再作为默认接入路径。
- `sendFriendRequest()` 请求体已经与后端 `AddFriendRequest` 对齐，发送字段为 `message`。
- `getFriendInfo()` 当前走专用端点 `GET /friends/{user_id}/info`，不再退化为全量好友列表扫描。
- `getFriends()` 会接收并缓存 `room_id`，`ensureFriendListRoom()` 仅复用该返回值，不混用发送好友请求入口。
- `getIncomingRequests()` 只封装正式契约 `GET /friends/request/received`，`/friends/requests/incoming` 保留为服务端兼容别名。
- `PUT /friends/{user_id}/displayname` 已纳入当前契约，可按文档直接使用。

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

- ✅ 事件系统 (`FriendEvent`)
- ✅ 好友缓存 (`Map<string, Friend>`)
- ✅ 请求缓存 (`Map<string, FriendRequest>`)
- ✅ 分组缓存 (`FriendGroups`)
- ✅ 参数验证 (`InvalidParamError`)
- ✅ 统一错误处理 (`normalizeError`)
