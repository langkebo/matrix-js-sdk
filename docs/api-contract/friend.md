# Friend 模块 API 契约

> 好友管理相关 API 的 SDK 与后端接口契约

## 概述

Friend 模块提供好友请求、好友列表、分组管理功能。

**后端实现**: `synapse-rust/src/web/routes/friend_room.rs`
**SDK 封装**: `matrix-js-sdk/src/friend/index.ts` (`FriendManager`)
**前端调用**: `hula/src/services/MatrixFriendService.ts`

---

## 好友列表 / Get Friends

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/friends` |
| HTTP 方法 | GET |
| SDK 方法 | `friendManager.getFriends()` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface FriendsResponse {
    friends?: Friend[];
}

interface Friend {
    user_id: string;
    reason?: string;
    since?: number;
    display_name?: string;
    avatar_url?: string;
    note?: string;
    status?: "favorite" | "normal" | "blocked" | "hidden" | string;
    dm_room_id?: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证 |

---

## 发送好友请求 / Send Friend Request

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/request` |
| HTTP 方法 | POST |
| SDK 方法 | `friendManager.sendFriendRequest(userId, reason?)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | `string` | 是 | 目标用户 ID |
| `reason` | `string` | 否 | 请求理由 |

### 响应结构

```typescript
// 空响应，成功即返回 200
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求发送成功 |
| 400 | 参数错误（无效用户 ID） |
| 401 | 未认证 |
| 404 | 用户不存在 |
| 409 | 已是好友或请求已存在 |

---

## 接受好友请求 / Accept Friend Request

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/accept` |
| HTTP 方法 | POST |
| SDK 方法 | `friendManager.acceptFriendRequest(userId)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | `string` | 是 | 发起请求的用户 ID |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 接受成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 请求不存在 |

---

## 拒绝好友请求 / Reject Friend Request

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/reject` |
| HTTP 方法 | POST |
| SDK 方法 | `friendManager.rejectFriendRequest(userId)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | `string` | 是 | 发起请求的用户 ID |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 拒绝成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 请求不存在 |

---

## 取消好友请求 / Cancel Friend Request

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/cancel` |
| HTTP 方法 | POST |
| SDK 方法 | `friendManager.cancelFriendRequest(userId)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | `string` | 是 | 目标用户 ID |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 取消成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 请求不存在 |

---

## 删除好友 / Remove Friend

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/friends/{user_id}` |
| HTTP 方法 | DELETE |
| SDK 方法 | `friendManager.removeFriend(userId)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | `string` | 是 | 要删除的好友用户 ID (URL 编码) |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 删除成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 好友关系不存在 |

---

## 获取传入请求 / Get Incoming Requests

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/requests/incoming` |
| HTTP 方法 | GET |
| SDK 方法 | `friendManager.getIncomingRequests()` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 响应结构

```typescript
interface FriendRequestsResponse {
    requests?: FriendRequest[];
}

interface FriendRequest {
    user_id: string;
    reason?: string;
    status: "pending" | "accepted" | "rejected" | "cancelled";
    timestamp?: number;
    display_name?: string;
    avatar_url?: string;
    message?: string;
    direction?: 'incoming' | 'outgoing';
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证 |

---

## 获取传出请求 / Get Outgoing Requests

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/requests/outgoing` |
| HTTP 方法 | GET |
| SDK 方法 | `friendManager.getOutgoingRequests()` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证 |

---

## 获取好友建议 / Get Friend Suggestions

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/suggestions` |
| HTTP 方法 | GET |
| SDK 方法 | `friendManager.getFriendSuggestions(limit?)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `limit` | `number` | 否 | 返回数量限制，默认 10 |

### 响应结构

```typescript
interface FriendSuggestionsResponse {
    suggestions?: Friend[];
    total?: number;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证 |

---

## 获取好友分组 / Get Friend Groups

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/groups` |
| HTTP 方法 | GET |
| SDK 方法 | `friendManager.getFriendGroups()` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 响应结构

```typescript
interface FriendGroups {
    [groupId: string]: {
        name: string;
        users: string[];
    };
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证 |

---

## 创建好友分组 / Create Friend Group

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/groups` |
| HTTP 方法 | POST |
| SDK 方法 | `friendManager.createFriendGroup(name)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `name` | `string` | 是 | 分组名称 |

### 响应结构

```typescript
interface CreateGroupResponse {
    group_id: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 创建成功 |
| 400 | 参数错误 |
| 401 | 未认证 |

---

## 添加用户到分组 / Add User to Group

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/groups/{group_id}/users/{user_id}` |
| HTTP 方法 | PUT |
| SDK 方法 | `friendManager.addToFriendGroup(groupId, userId)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `group_id` | `string` | 是 | 分组 ID |
| `user_id` | `string` | 是 | 用户 ID (URL 编码) |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 添加成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 分组或用户不存在 |

---

## 从分组移除用户 / Remove User from Group

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/groups/{group_id}/users/{user_id}` |
| HTTP 方法 | DELETE |
| SDK 方法 | `friendManager.removeFromFriendGroup(groupId, userId)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `group_id` | `string` | 是 | 分组 ID |
| `user_id` | `string` | 是 | 用户 ID (URL 编码) |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 移除成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 分组或用户不存在 |

---

## 删除好友分组 / Delete Friend Group

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/groups/{group_id}` |
| HTTP 方法 | DELETE |
| SDK 方法 | `friendManager.deleteFriendGroup(groupId)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `group_id` | `string` | 是 | 分组 ID |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 删除成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 分组不存在 |

---

## 设置好友显示名 / Set Friend Display Name

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/friend_room/friends/{user_id}/displayname` |
| HTTP 方法 | PUT |
| SDK 方法 | `friendManager.setFriendDisplayName(userId, displayName)` |
| SDK 模块 | `FriendManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | `string` | 是 | 用户 ID (URL 编码) |
| `displayname` | `string` | 是 | 显示名称 |

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 设置成功 |
| 400 | 参数错误 |
| 401 | 未认证 |
| 404 | 好友关系不存在 |

---

## FriendManager 完整方法列表

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getFriends()` | GET `/friend_room/friends` | 获取好友列表 | ✅ |
| `sendFriendRequest(userId, reason?)` | POST `/friend_room/request` | 发送好友请求 | ✅ |
| `acceptFriendRequest(userId)` | POST `/friend_room/accept` | 接受好友请求 | ✅ |
| `rejectFriendRequest(userId)` | POST `/friend_room/reject` | 拒绝好友请求 | ✅ |
| `cancelFriendRequest(userId)` | POST `/friend_room/cancel` | 取消好友请求 | ✅ |
| `removeFriend(userId)` | DELETE `/friend_room/friends/{user_id}` | 删除好友 | ✅ |
| `getIncomingRequests()` | GET `/friend_room/requests/incoming` | 获取传入请求 | ✅ |
| `getOutgoingRequests()` | GET `/friend_room/requests/outgoing` | 获取传出请求 | ✅ |
| `getFriendSuggestions(limit?)` | GET `/friend_room/suggestions` | 获取好友建议 | ✅ |
| `getFriendGroups()` | GET `/friend_room/groups` | 获取好友分组 | ✅ |
| `createFriendGroup(name)` | POST `/friend_room/groups` | 创建好友分组 | ✅ |
| `addToFriendGroup(groupId, userId)` | PUT `/friend_room/groups/{group_id}/users/{user_id}` | 添加用户到分组 | ✅ |
| `removeFromFriendGroup(groupId, userId)` | DELETE `/friend_room/groups/{group_id}/users/{user_id}` | 从分组移除用户 | ✅ |
| `deleteFriendGroup(groupId)` | DELETE `/friend_room/groups/{group_id}` | 删除好友分组 | ✅ |
| `setFriendDisplayName(userId, displayName)` | PUT `/friend_room/friends/{user_id}/displayname` | 设置好友显示名 | ✅ |
| `isFriend(userId)` | - | 检查是否是好友 | ✅ |
| `getFriendInfo(userId)` | - | 获取好友信息 | ✅ |
| `getFriendCount()` | - | 获取好友数量 | ✅ |
| `sync()` | - | 同步好友数据 | ✅ |
| `start()` | - | 启动好友管理器 | ✅ |
| `stop()` | - | 停止好友管理器 | ✅ |

---

## 事件列表

| 事件 | 说明 |
|------|------|
| `Invited` | 好友请求已发送 |
| `Accepted` | 好友请求被接受 |
| `Rejected` | 好友请求被拒绝 |
| `Cancelled` | 好友请求被取消 |
| `Removed` | 好友被删除 |
| `RequestReceived` | 收到新的好友请求 |
| `ListUpdated` | 好友列表已更新 |
| `SyncComplete` | 同步完成 |
| `FriendAdded` | 好友已添加 |
| `FriendRemoved` | 好友已删除 |
| `FriendUpdated` | 好友信息已更新 |
| `RequestSent` | 请求已发送 |
| `RequestAccepted` | 请求已被接受 |
| `RequestRejected` | 请求已被拒绝 |
| `RequestCancelled` | 请求已被取消 |

---

## DM 模块补充

Friend 模块与 DM 模块协同工作：
- **好友关系** → 存储在 `m.friend` 事件中
- **DM 房间关联** → 通过 `Friend.dm_room_id` 字段关联

### DM 创建时自动添加好友

当创建 DM 房间时，可以自动添加好友关系：
```typescript
await friendManager.sendFriendRequest(userId);
```
