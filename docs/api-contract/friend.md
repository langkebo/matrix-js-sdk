# Friend 模块契约

> 审查来源: `synapse-rust/src/web/routes/friend_room.rs`

## 路由版本

| 前缀                 | 说明                                     |
| -------------------- | ---------------------------------------- |
| `/_matrix/client/v3` | 仅提供 `/friends` 列表与发送请求基础入口 |
| `/_matrix/client/v1` | 提供完整好友、请求、分组能力             |
| `/_matrix/client/r0` | 提供与 `v1` 基本对齐的兼容路由           |

## 好友与请求

| 方法   | 路径                                                       | 说明           |
| ------ | ---------------------------------------------------------- | -------------- |
| GET    | `/_matrix/client/v3/friends`                               | 获取好友列表   |
| POST   | `/_matrix/client/v3/friends`                               | 发送好友请求   |
| GET    | `/_matrix/client/v1/friends`                               | 获取好友列表   |
| POST   | `/_matrix/client/v1/friends`                               | 发送好友请求   |
| GET    | `/_matrix/client/r0/friendships`                           | 获取好友列表   |
| POST   | `/_matrix/client/r0/friendships`                           | 发送好友请求   |
| POST   | `/_matrix/client/{v1,r0}/friends/request`                  | 发送好友请求   |
| GET    | `/_matrix/client/{v1,r0}/friends/request/received`         | 获取收到的请求 |
| POST   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/accept` | 接受请求       |
| POST   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/reject` | 拒绝请求       |
| POST   | `/_matrix/client/{v1,r0}/friends/request/{user_id}/cancel` | 取消请求       |
| GET    | `/_matrix/client/{v1,r0}/friends/requests/incoming`        | incoming 请求  |
| GET    | `/_matrix/client/{v1,r0}/friends/requests/outgoing`        | outgoing 请求  |
| GET    | `/_matrix/client/{v1,r0}/friends/check/{user_id}`          | 检查好友关系   |
| GET    | `/_matrix/client/{v1,r0}/friends/suggestions`              | 好友建议       |
| DELETE | `/_matrix/client/{v1,r0}/friends/{user_id}`                | 删除好友       |
| PUT    | `/_matrix/client/{v1,r0}/friends/{user_id}/note`           | 更新好友备注   |
| GET    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 获取好友状态   |
| PUT    | `/_matrix/client/{v1,r0}/friends/{user_id}/status`         | 更新好友状态   |
| GET    | `/_matrix/client/{v1,r0}/friends/{user_id}/info`           | 获取好友信息   |

## 好友分组

| 方法   | 路径                                                                 | 说明                       |
| ------ | -------------------------------------------------------------------- | -------------------------- |
| GET    | `/_matrix/client/{v1,r0}/friends/groups`                             | 获取分组列表               |
| POST   | `/_matrix/client/{v1,r0}/friends/groups`                             | 创建分组                   |
| DELETE | `/_matrix/client/{v1,r0}/friends/groups/{group_id}`                  | 删除分组                   |
| PUT    | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/name`             | 重命名分组                 |
| POST   | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/add/{user_id}`    | 添加好友到分组             |
| DELETE | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/remove/{user_id}` | 从分组移除好友             |
| PUT    | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/users/{user_id}`  | 添加好友到分组（替代路径） |
| DELETE | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/users/{user_id}`  | 从分组移除好友（替代路径） |
| GET    | `/_matrix/client/{v1,r0}/friends/groups/{group_id}/friends`          | 获取分组内好友             |
| GET    | `/_matrix/client/{v1,r0}/friends/{user_id}/groups`                   | 获取用户所属分组           |
| PUT    | `/_matrix/client/{v1,r0}/friends/{user_id}/displayname`              | 设置好友显示名             |

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

## 认证与状态码

- 全部好友路由都需要用户 access token。
- 常见状态码: `200` `400` `401` `404` `409`

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/friend_room.rs`

## SDK Manager 对应关系

> 更新日期: 2026-04-04
> 审计状态: ✅ 已完成并修复

### 好友与请求

| 端点                                     | SDK Manager     | 方法                                               | 状态      |
| ---------------------------------------- | --------------- | -------------------------------------------------- | --------- |
| `GET /friends`                           | `FriendManager` | `getFriends()` / `getFriendsList()`                | ✅ 已封装 |
| `POST /friends`                          | `FriendManager` | `sendFriendRequest()` / `addFriend()`              | ✅ 已修复 |
| `POST /friends/request`                  | `FriendManager` | `sendFriendRequest()`                              | ✅ 已修复 |
| `GET /friends/request/received`          | `FriendManager` | `getIncomingRequests()`                            | ✅ 已封装 |
| `POST /friends/request/{user_id}/accept` | `FriendManager` | `acceptFriendRequest()`                            | ✅ 已封装 |
| `POST /friends/request/{user_id}/reject` | `FriendManager` | `rejectFriendRequest()` / `declineFriendRequest()` | ✅ 已封装 |
| `POST /friends/request/{user_id}/cancel` | `FriendManager` | `cancelFriendRequest()`                            | ✅ 已封装 |
| `GET /friends/requests/incoming`         | `FriendManager` | `getIncomingRequests()`                            | ✅ 已封装 |
| `GET /friends/requests/outgoing`         | `FriendManager` | `getOutgoingRequests()`                            | ✅ 已封装 |
| `GET /friends/check/{user_id}`           | `FriendManager` | `checkFriendship()`                                | ✅ 已封装 |
| `GET /friends/suggestions`               | `FriendManager` | `getFriendSuggestions()`                           | ✅ 已封装 |
| `DELETE /friends/{user_id}`              | `FriendManager` | `removeFriend()`                                   | ✅ 已封装 |
| `PUT /friends/{user_id}/note`            | `FriendManager` | `updateFriendNote()`                               | ✅ 已封装 |
| `GET /friends/{user_id}/status`          | `FriendManager` | `getFriendStatus()`                                | ✅ 已封装 |
| `PUT /friends/{user_id}/status`          | `FriendManager` | `updateFriendStatus()`                             | ✅ 已封装 |
| `GET /friends/{user_id}/info`            | `FriendManager` | `getFriendInfo()`                                  | ✅ 已修复 |
| `PUT /friends/{user_id}/displayname`     | `FriendManager` | `setFriendDisplayName()`                           | ✅ 已修复 |

## 审计发现的问题

> 审计日期: 2026-04-04
> 修复状态: ✅ 已修复

### 🔴 高优先级问题

#### 1. ~~后端缺失 displayname 路由~~

**问题描述**: SDK 实现了 `setFriendDisplayName()` 方法，但后端 `friend_room.rs` 中没有对应的 `PUT /friends/{user_id}/displayname` 路由。

**影响**: 调用此方法将返回 404 错误。

**修复状态**: ✅ 已修复

- 后端已添加 `PUT /friends/{user_id}/displayname` 路由
- 后端已添加 `update_friend_displayname` 服务方法

- SDK `setFriendDisplayName()` 方法现在可以正常调用

**后端代码位置**: `synapse-rust/src/web/routes/friend_room.rs`

---

### ⚠️ 中优先级问题

#### 2. ~~sendFriendRequest 请求体字段不一致~~

**问题描述**:

- 后端 `AddFriendRequest` 结构体定义字段为 `message`
- SDK `sendFriendRequest()` 发送字段为 `reason`

**修复状态**: ✅ 已修复

- SDK 已将 `reason` 改为 `message`

**后端定义** (`friend_room.rs:198-202`):

```rust
pub struct AddFriendRequest {
    pub user_id: String,
    pub message: Option<String>,  // ← 字段名为 message
}
```

**SDK 修复** (`friend/index.ts:228`):

```typescript
{ user_id: userId, message: reason },  // ✅ 字段名已修正
```

**影响**: 好友请求的附言消息现在可以正确传递到后端。

---

#### 3. ~~getFriendInfo 实现错误~~

**问题描述**: SDK 的 `getFriendInfo()` 方法没有调用后端专用端点，而是从好友列表中查找。

**修复状态**: ✅ 已修复

- SDK 已改为调用专用端点 `GET /friends/{user_id}/info`

**后端端点**: `GET /friends/{user_id}/info` (已实现)

**SDK 修复后实现** (`friend/index.ts:647-668`):

```typescript
async getFriendInfo(userId: string): Promise<Friend | null> {
    if (!userId) {
        throw new InvalidParamError("User ID is required");
    }

    try {
        const response = await this.client.http.authedRequest<Friend>(
            Method.Get,
            `/friends/${encodeURIComponent(userId)}/info`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
        return normalizeFriend(response);
    } catch (e) {
        const error = this.normalizeError(e, 'getFriendInfo');
        if (error instanceof NotFoundError) {
            return null;
        }
        throw error;
    }
}
```

**影响**:

- ✅ 性能优化： 现在只请求单个好友信息
- ✅ 数据完整: 可以获取后端返回的完整信息

---

#### 4. ~~ensureFriendListRoom 路径语义不清~~

**问题描述**: `ensureFriendListRoom()` 方法调用 `GET /friends` 并期望返回 `room_id`，但后端 `get_friends` 返回的是好友列表，不是房间信息。

**修复状态**: ⚠️ 待核实

- 需要确认后端是否有专门的"好友列表房间"概念

- 如果不需要，考虑移除此方法

- 如果需要，后端应提供相应端点

**后端响应** (`friend_room.rs:243-246`):

```rust
Ok(Json(json!({
    "friends": friends,
    "total": friends.len()
}))
```

**影响**: `friendListRoomId` 始终为 `null`，影响依赖此字段的功能。

**解决方案**:

- 核实后端是否有专门的"好友列表房间"概念
- 如果不需要，移除此方法
- 如果需要，后端应提供相应端点

---

### 📝 低优先级问题

#### 5. ~~契约文档缺少 displayname 端点定义~~

**问题描述**: 原契约文档列出了 `PUT /friends/{user_id}/displayname`，但后端未实现。

**修复状态**: ✅ 已修复

- 后端已添加该路由
- 契约文档已更新

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

## 审计发现的问题

> 审计日期: 2026-04-03

### 🔴 高优先级问题

#### 1. 后端缺失 displayname 路由

**问题描述**: SDK 实现了 `setFriendDisplayName()` 方法，但后端 `friend_room.rs` 中没有对应的 `PUT /friends/{user_id}/displayname` 路由。

**影响**: 调用此方法将返回 404 错误。

**解决方案**:

- 方案 A: 在后端添加该路由
- 方案 B: 从 SDK 中移除此方法或标记为未实现

**后端代码位置**: `synapse-rust/src/web/routes/friend_room.rs`

---

### ⚠️ 中优先级问题

#### 2. sendFriendRequest 请求体字段不一致

**问题描述**:

- 后端 `AddFriendRequest` 结构体定义字段为 `message`
- SDK `sendFriendRequest()` 发送字段为 `reason`

**后端定义** (`friend_room.rs:198-202`):

```rust
pub struct AddFriendRequest {
    pub user_id: String,
    pub message: Option<String>,  // ← 字段名为 message
}
```

**SDK 实现** (`friend/index.ts:227-229`):

```typescript
{ user_id: userId, reason },  // ← 字段名为 reason
```

**影响**: 好友请求的附言消息可能无法正确传递到后端。

**解决方案**: 将 SDK 中的 `reason` 改为 `message`。

---

#### 3. getFriendInfo 实现错误

**问题描述**: SDK 的 `getFriendInfo()` 方法没有调用后端专用端点，而是从好友列表中查找。

**后端端点**: `GET /friends/{user_id}/info` (已实现)

**SDK 错误实现** (`friend/index.ts:647-650`):

```typescript
async getFriendInfo(userId: string): Promise<Friend | null> {
    const friends = await this.getFriends();  // ← 获取整个好友列表
    return friends.find(f => f.user_id === userId) || null;  // ← 本地查找
}
```

**影响**:

- 性能问题：获取单个好友信息却请求整个好友列表
- 数据不完整：后端 `get_friend_info` 可能返回更多字段

**解决方案**: 改为调用专用端点 `GET /friends/{user_id}/info`。

---

#### 4. ensureFriendListRoom 路径语义不清

**问题描述**: `ensureFriendListRoom()` 方法调用 `GET /friends` 并期望返回 `room_id`，但后端 `get_friends` 返回的是好友列表，不是房间信息。

**后端响应** (`friend_room.rs:243-246`):

```rust
Ok(Json(json!({
    "friends": friends,
    "total": friends.len()
})))
```

**影响**: `friendListRoomId` 始终为 `null`，可能影响依赖此字段的功能。

**解决方案**:

- 核实后端是否有专门的"好友列表房间"概念
- 如果不需要，移除此方法
- 如果需要，后端应提供相应端点

---

### 📝 低优先级问题

#### 5. 契约文档缺少 displayname 端点定义

**问题描述**: 原契约文档列出了 `PUT /friends/{user_id}/displayname`，但后端未实现。

**解决方案**: 从契约中移除或标注为"待实现"。

---

## 修复优先级

| 优先级 | 问题                          | 影响       | 修复位置 |
| ------ | ----------------------------- | ---------- | -------- |
| 🔴 P0  | 后端缺失 displayname 路由     | 功能不可用 | 后端     |
| ⚠️ P1  | sendFriendRequest 字段不一致  | 消息丢失   | SDK      |
| ⚠️ P1  | getFriendInfo 实现错误        | 性能问题   | SDK      |
| ⚠️ P2  | ensureFriendListRoom 语义不清 | 功能异常   | 需核实   |
| 📝 P3  | 契约文档不一致                | 文档漂移   | 文档     |
