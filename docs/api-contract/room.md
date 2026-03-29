# Room 模块 API 契约

> 房间相关 API 的 SDK 与后端接口契约

## 概述

Room 模块涉及以下 Matrix API：

| 功能 | Matrix API | 说明 |
|------|------------|------|
| 创建房间 | `/_matrix/client/v3/createRoom` | POST |
| 获取房间信息 | `/_matrix/client/v3/rooms/{room_id}` | GET |
| 加入房间 | `/_matrix/client/v3/join/{room_id_or_alias}` | POST |
| 离开房间 | `/_matrix/client/v3/rooms/{room_id}/leave` | POST |
| 邀请用户 | `/_matrix/client/v3/rooms/{room_id}/invite` | POST |
| 踢出用户 | `/_matrix/client/v3/rooms/{room_id}/kick` | POST |
| 封禁用户 | `/_matrix/client/v3/rooms/{room_id}/ban` | POST |
| 成员列表 | `/_matrix/client/v3/rooms/{room_id}/members` | GET |
| 发送消息 | `/_matrix/client/v3/rooms/{room_id}/send/{event_type}/{txn_id}` | PUT |
| 获取消息 | `/_matrix/client/v3/rooms/{room_id}/event/{event_id}` | GET |
| 消息历史 | `/_matrix/client/v3/rooms/{room_id}/messages` | GET |

---

## 创建房间 / Create Room

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/createRoom` |
| HTTP 方法 | POST |
| SDK 方法 | `client.createRoom()` |
| SDK 模块 | `matrix-js-sdk/src/room/index.ts` - `RoomManager.createRoom()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_alias_name` | `string` | 否 | 房间别名本地部分 |
| `visibility` | `Visibility` | 否 | `'public'` 或 `'private'` |
| `name` | `string` | 否 | 房间名称 |
| `topic` | `string` | 否 | 房间主题 |
| `preset` | `Preset` | 否 | 房间预设 |
| `power_level_content_override` | `object` | 否 | 权力等级覆盖 |
| `creation_content` | `object` | 否 | 创建内容 |
| `initial_state` | `ICreateRoomStateEvent[]` | 否 | 初始状态事件 |
| `invite` | `string[]` | 否 | 邀请的用户 ID 列表 |
| `invite_3pid` | `IInvite3PID[]` | 否 | 第三方邀请 |
| `is_direct` | `boolean` | 否 | 是否为直接消息房间 |
| `room_version` | `string` | 否 | 房间版本 |

### 响应结构

```typescript
interface CreateRoomResponse {
    room_id: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 创建成功 |
| 400 | 参数错误（缺少必填字段） |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限创建房间 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `create_room()`
- **SDK 封装**: [matrix-js-sdk/src/room/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room/index.ts) - `RoomManager.createRoom()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `createRoom()`

---

## 获取房间信息 / Get Room Info

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getRoom()` (本地) |
| SDK 模块 | `matrix-js-sdk/src/room/index.ts` - `RoomManager.getRoom()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |

### 响应结构

```typescript
interface Room {
    roomId: string;
    name: string | null;
    topic: string | null;
    avatarUrl: string | null;
    memberCount: number;
    joinedCount: number;
    canonicalAlias: string | null;
    isPublic: boolean;
}
```

> 注意：此为 SDK 本地 Room 对象，非 HTTP 响应。后端返回的是完整的房间状态事件。

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限访问房间 |
| 404 | 房间不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `get_room_info()`
- **SDK 封装**: [matrix-js-sdk/src/room/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room/index.ts) - `RoomManager.getRoom()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `getRoom()`

---

## 加入房间 / Join Room

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/join/{room_id_or_alias}` |
| HTTP 方法 | POST |
| SDK 方法 | `client.joinRoom()` |
| SDK 模块 | `matrix-js-sdk/src/room/index.ts` - `RoomManager.joinRoom()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id_or_alias` | `string` | 是 | 房间 ID 或别名（路径参数） |
| `opts.viaServers` | `string[]` | 否 | 尝试加入的服务器列表 |
| `opts.inviteSignUrl` | `string` | 否 | 第三方邀请签名 URL |
| `opts.acceptSharedHistory` | `boolean` | 否 | 是否接受共享的历史消息 |

### 响应结构

```typescript
interface JoinRoomResponse {
    room_id: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 加入成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限加入房间 |
| 404 | 房间不存在 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `join_room()` / `join_room_by_id_or_alias()`
- **SDK 封装**: [matrix-js-sdk/src/room/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room/index.ts) - `RoomManager.joinRoom()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `joinRoom()`

---

## 离开房间 / Leave Room

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/leave` |
| HTTP 方法 | POST |
| SDK 方法 | `client.leaveRoom()` |
| SDK 模块 | `matrix-js-sdk/src/room/index.ts` - `RoomManager.leave()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 离开成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限离开房间 |
| 404 | 房间不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `leave_room()`
- **SDK 封装**: [matrix-js-sdk/src/room/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room/index.ts) - `RoomManager.leave()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `leaveRoom()`

---

## 邀请用户 / Invite User

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/invite` |
| HTTP 方法 | POST |
| SDK 方法 | `client.invite()` |
| SDK 模块 | `matrix-js-sdk/src/room/index.ts` - `RoomManager.invite()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |
| `user_id` | `string` | 是 | 被邀请的用户 ID |
| `reason` | `string` | 否 | 邀请原因 |
| `shareEncryptedHistory` | `boolean` | 否 | 是否共享加密历史（MSC4268） |

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 邀请成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限邀请用户 |
| 404 | 房间不存在 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `invite_user()` / `invite_user_by_room()`
- **SDK 封装**: [matrix-js-sdk/src/room/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room/index.ts) - `RoomManager.invite()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `inviteUser()`

---

## 踢出用户 / Kick User

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/kick` |
| HTTP 方法 | POST |
| SDK 方法 | `client.kick()` |
| SDK 模块 | `matrix-js-sdk/src/room-joining/index.ts` - `RoomJoiningManager.kickUser()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |
| `user_id` | `string` | 是 | 被踢出的用户 ID |
| `reason` | `string` | 否 | 踢出原因 |

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 踢出成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限踢出用户（需要适当的权力等级） |
| 404 | 房间不存在 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `kick_user()`
- **SDK 封装**: [matrix-js-sdk/src/room-joining/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room-joining/index.ts) - `RoomJoiningManager.kickUser()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `kickUser()`

---

## 封禁用户 / Ban User

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/ban` |
| HTTP 方法 | POST |
| SDK 方法 | `client.ban()` |
| SDK 模块 | `matrix-js-sdk/src/room/index.ts` - `RoomManager.ban()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |
| `user_id` | `string` | 是 | 被封禁的用户 ID |
| `reason` | `string` | 否 | 封禁原因 |

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 封禁成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限封禁用户（需要适当的权力等级） |
| 404 | 房间不存在 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `ban_user()`
- **SDK 封装**: [matrix-js-sdk/src/room/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room/index.ts) - `RoomManager.ban()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `banUser()`

---

## 成员列表 / Get Room Members

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/members` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getRoomMembers()` |
| SDK 模块 | `matrix-js-sdk/src/membership/index.ts` - `MembershipManager.getRoomMembers()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |
| `not_membership` | `string` | 否 | 过滤特定成员资格状态 |
| `send_image` | `boolean` | 否 | 是否发送头像 |

### 响应结构

```typescript
interface MembershipEventsResponse {
    chunk: IEvent[];
}
```

### SDK 响应结构（本地）

```typescript
interface RoomMember {
    userId: string;
    roomId: string;
    name: string;
    rawDisplayName: string;
    membership: 'join' | 'leave' | 'invite' | 'ban' | 'knock';
    powerLevel: number;
    isDirect: boolean;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限访问成员列表 |
| 404 | 房间不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `get_room_members()`
- **SDK 封装**: [matrix-js-sdk/src/membership/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/membership/index.ts) - `MembershipManager.getRoomMembers()`
- **前端调用**: [hula/src/services/matrix/MatrixRoomService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixRoomService.ts) - `getMembers()`

---

## 发送消息 / Send Message

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/send/{event_type}/{txn_id}` |
| HTTP 方法 | PUT |
| SDK 方法 | `client.sendTextMessage()` / `client.sendMessage()` |
| SDK 模块 | `matrix-js-sdk/src/message/index.ts` - `MessageManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |
| `event_type` | `string` | 是 | 事件类型（路径参数），如 `m.room.message` |
| `txn_id` | `string` | 是 | 事务 ID（路径参数），用于幂等性 |
| `content` | `object` | 是 | 消息内容（请求体） |

### 消息内容示例

```typescript
// 文本消息
interface TextMessageContent {
    msgtype: 'm.text';
    body: string;
}

// 位置消息
interface LocationMessageContent {
    msgtype: 'm.location';
    body: string;
    geo_uri: string;
}

// 文件消息
interface FileMessageContent {
    msgtype: 'm.file';
    body: string;
    url: string;
    info?: {
        mimetype: string;
        size: number;
    };
}
```

### 响应结构

```typescript
interface SendEventResponse {
    event_id: string;
    room_id?: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 发送成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限发送消息 |
| 404 | 房间不存在 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `send_message()`
- **SDK 封装**: [matrix-js-sdk/src/message/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/message/index.ts) - `MessageManager`
- **前端调用**: [hula/src/services/matrix/MatrixMessageService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixMessageService.ts)

---

## 获取消息 / Get Event

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/event/{event_id}` |
| HTTP 方法 | GET |
| SDK 方法 | `client.fetchRoomEvent()` |
| SDK 模块 | `matrix-js-sdk/src/room-events/index.ts` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |
| `event_id` | `string` | 是 | 事件 ID（路径参数） |

### 响应结构

```typescript
interface Event {
    event_id: string;
    room_id: string;
    type: string;
    sender: string;
    content: IContent;
    origin_server_ts: number;
    state_key?: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限访问事件 |
| 404 | 房间或事件不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `get_single_event()`
- **SDK 封装**: [matrix-js-sdk/src/room-events/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room-events/index.ts)
- **前端调用**: [hula/src/services/matrix/MatrixEventService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixEventService.ts)

---

## 消息历史 / Get Messages

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/messages` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getMessages()` |
| SDK 模块 | `matrix-js-sdk/src/pagination/index.ts` - `PaginationManager` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID（路径参数） |
| `from` | `string` | 是 | 分页起点 token |
| `to` | `string` | 否 | 分页终点 token |
| `dir` | `'b' \| 'f'` | 是 | 方向：`'b'` 向后（历史），`'f'` 向前 |
| `limit` | `number` | 否 | 限制返回的事件数量 |
| `filter` | `IRoomEventFilter` | 否 | 过滤器 |

### 响应结构

```typescript
interface MessagesResponse {
    start: string;
    end: string;
    chunk: IEvent[];
    state?: IEvent[];
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限访问消息历史 |
| 404 | 房间不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/room.rs` - `get_messages()`
- **SDK 封装**: [matrix-js-sdk/src/pagination/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/pagination/index.ts) - `PaginationManager`
- **前端调用**: [hula/src/services/matrix/MatrixEventService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixEventService.ts)

---

## SDK Manager 导出状态

| Manager | 导出位置 | 状态 |
|---------|----------|------|
| `RoomManager` | `matrix-js-sdk/src/room/index.ts` | ✅ 完整 |
| `RoomCreationManager` | `matrix-js-sdk/src/room-creation/index.ts` | ✅ 完整 |
| `RoomJoiningManager` | `matrix-js-sdk/src/room-joining/index.ts` | ✅ 完整 |
| `MembershipManager` | `matrix-js-sdk/src/membership/index.ts` | ✅ 完整 |
| `MessageManager` | `matrix-js-sdk/src/message/index.ts` | ✅ 完整 |
| `PaginationManager` | `matrix-js-sdk/src/pagination/index.ts` | ✅ 完整 |

---

## 状态说明

| 状态 | 说明 |
|------|------|
| ✅ 已集成 | 后端路由 + SDK 封装 + 前端接入均已完成 |
| ⚠️ 部分漂移 | 后端可用但 SDK/前端封装有分叉 |
| 🟡 行为不稳定 | 基本可用但存在逻辑疑点 |
| 🔴 未实现/有 bug | 缺少必要实现或存在已知 bug |

### Room 模块当前状态

| 功能 | 状态 | 说明 |
|------|------|------|
| 创建房间 | ✅ 已集成 | 完整实现 |
| 获取房间信息 | ✅ 已集成 | 本地 Room 对象 + 后端路由 |
| 加入房间 | ✅ 已集成 | 完整实现 |
| 离开房间 | ✅ 已集成 | 完整实现 |
| 邀请用户 | ✅ 已集成 | 完整实现 |
| 踢出用户 | ✅ 已集成 | 完整实现 |
| 封禁用户 | ✅ 已集成 | 完整实现 |
| 成员列表 | ✅ 已集成 | 完整实现 |
| 发送消息 | ✅ 已集成 | 完整实现 |
| 获取消息 | ✅ 已集成 | 完整实现 |
| 消息历史 | ✅ 已集成 | 完整实现 |

---

## 已知问题

| 问题 | 位置 | 说明 | 优先级 |
|------|------|------|--------|
| 无 | - | Room 模块各 API 均已完整实现 | - |

