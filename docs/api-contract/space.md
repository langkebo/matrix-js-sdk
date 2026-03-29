# Space 模块 API 契约

> Space 相关 API 的 SDK 与后端接口契约

## 概述

Space 模块涉及以下 Matrix API：

| 功能 | Matrix API | 说明 |
|------|------------|------|
| 获取 Space 子房间 | `/_matrix/client/v3/rooms/{room_id}/spaces/{event_id}` | GET（未实现） |
| Space 层级结构 | `/_matrix/client/v3/rooms/{room_id}/hierarchy` | GET |
| 创建 Space | `/_matrix/client/v3/createRoom` | POST with `m.space` |
| 获取 Space 列表 | `/_matrix/client/v3/spaces/{space_id}` | GET |
| 获取 Space 成员 | `/_matrix/client/v3/spaces/{space_id}/members` | GET |

---

## 获取 Space 层级结构 / Get Room Hierarchy

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/rooms/{room_id}/hierarchy` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getRoomHierarchy()` |
| SDK 模块 | `matrix-js-sdk/src/room-summary/index.ts` (RoomSummaryManager) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | Space 的房间 ID（路径参数） |
| `max_depth` | `number` | 否 | 最大深度，默认 1 |
| `suggested_only` | `boolean` | 否 | 只返回建议的房间 |
| `limit` | `number` | 否 | 限制返回数量 |
| `from` | `string` | 否 | 分页游标 |

### 响应结构

```typescript
interface SpaceHierarchyResponse {
    room_id: string;
    rooms: SpaceHierarchyRoom[];
    next_batch?: string;
}

interface SpaceHierarchyRoom {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    join_rule?: string;
    membership?: string;
    num_joined_members?: number;
    is_space?: boolean;
    children_state?: Array<{
        type: string;
        state_key: string;
        content: {
            via?: string[];
            suggested?: boolean;
            order?: string;
            [key: string]: unknown;
        };
    }>;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限访问 Space |
| 404 | Space 不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/space.rs` - `get_room_hierarchy()` / `get_space_hierarchy_v1()`
- **SDK 封装**: [matrix-js-sdk/src/room-summary/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room-summary/index.ts) - `RoomSummaryManager.getRoomHierarchy()`
- **前端调用**: [hula/src/services/matrix/MatrixSpaceService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSpaceService.ts) - `getSpaceHierarchy()`

---

## 获取 Space 信息 / Get Space

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/spaces/{space_id}` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getSpace()` |
| SDK 模块 | 无独立 SpaceManager（前端自维护） |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `space_id` | `string` | 是 | Space ID（路径参数） |

### 响应结构

```typescript
interface SpaceResponse {
    space_id: string;
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator: string;
    join_rule: string;
    visibility?: string;
    is_public: boolean;
    created_ts: number;
    updated_ts?: number;
    parent_space_id?: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 404 | Space 不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/space.rs` - `get_space()`
- **SDK 封装**: [matrix-js-sdk/src/space/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/space/index.ts) - `SpaceManager.getSpace()`
- **前端调用**: [hula/src/services/matrix/MatrixSpaceService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSpaceService.ts)

---

## 获取 Space 子房间 / Get Space Children

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/spaces/{space_id}/children` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getSpaceChildren()` |
| SDK 模块 | `matrix-js-sdk/src/space/index.ts` - `SpaceManager.getSpaceChildren()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `space_id` | `string` | 是 | Space ID（路径参数） |

### 响应结构

```typescript
interface SpaceChildrenResponse {
    space_id: string;
    children: SpaceChild[];
}

interface SpaceChild {
    space_id: string;
    room_id: string;
    via_servers: string[];
    sender: string;
    is_suggested: boolean;
    added_ts: number;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 404 | Space 不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/space.rs` - `get_space_children()`
- **SDK 封装**: [matrix-js-sdk/src/space/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/space/index.ts) - `SpaceManager.getSpaceChildren()`
- **前端调用**: [hula/src/services/matrix/MatrixSpaceService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSpaceService.ts)

---

## 创建 Space / Create Space

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/createRoom` |
| HTTP 方法 | POST |
| SDK 方法 | `client.createRoom()` |
| SDK 模块 | `matrix-js-sdk/src/room-creation/index.ts` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `name` | `string` | 是 | Space 名称 |
| `topic` | `string` | 否 | Space 主题 |
| `preset` | `string` | 否 | 房间预设 |
| `initial_state` | `array` | 否 | 初始状态事件（需包含 `m.space`） |
| `creation_content` | `object` | 否 | 创建内容（需包含 `type: m.space`） |
| `room_alias_name` | `string` | 否 | 房间别名本地部分 |
| `visibility` | `string` | 否 | `'public'` 或 `'private'` |

### 请求示例

```typescript
const response = await client.createRoom({
    name: 'My Space',
    topic: 'Space description',
    preset: 'private_chat',
    initial_state: [
        {
            type: 'm.room.history_visibility',
            state_key: '',
            content: { history_visibility: 'shared' }
        },
        {
            type: 'm.space',
            state_key: '',
            content: {}
        }
    ],
    creation_content: { type: 'm.space' }
});
```

### 响应结构

```typescript
interface CreateSpaceResponse {
    room_id: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 创建成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限创建 Space |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/space.rs` - `create_space()`
- **SDK 封装**: [matrix-js-sdk/src/room-creation/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/room-creation/index.ts)
- **前端调用**: [hula/src/services/matrix/MatrixSpaceService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSpaceService.ts) - `createSpace()`

---

## 添加子房间到 Space / Add Child to Space

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/spaces/{space_id}/children` |
| HTTP 方法 | POST |
| SDK 方法 | `client.addChildToSpace()` |
| SDK 模块 | `matrix-js-sdk/src/space/index.ts` - `SpaceManager.addChild()` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `space_id` | `string` | 是 | Space ID（路径参数） |
| `room_id` | `string` | 是 | 子房间 ID |
| `via_servers` | `string[]` | 否 | 使用的服务器列表 |
| `order` | `string` | 否 | 排序值 |
| `suggested` | `boolean` | 否 | 是否为建议房间 |

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 添加成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限（需要 Space 管理权限） |
| 404 | Space 或子房间不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/space.rs` - `add_child()`
- **SDK 封装**: [matrix-js-sdk/src/space/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/space/index.ts) - `SpaceManager.addChild()`
- **前端调用**: [hula/src/services/matrix/MatrixSpaceService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSpaceService.ts) - `addChildToSpace()`

---

## 获取用户的所有 Space / Get User Spaces

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/spaces/user` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getUserSpaces()` |
| SDK 模块 | `matrix-js-sdk/src/space/index.ts` - `SpaceManager.getUserSpaces()` |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface UserSpacesResponse {
    spaces: SpaceResponse[];
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/space.rs` - `get_user_spaces()`
- **SDK 封装**: 无
- **前端调用**: [hula/src/services/matrix/MatrixSpaceService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSpaceService.ts)

---

## SDK Manager 导出状态

| Manager | 导出位置 | 状态 |
|---------|----------|------|
| `RoomSummaryManager` | `matrix-js-sdk/src/room-summary/index.ts` | ⚠️ 部分功能 |
| `SpaceManager` | `matrix-js-sdk/src/space/index.ts` | ✅ 已实现 |

---

## 状态说明

| 状态 | 说明 |
|------|------|
| ✅ 已集成 | 后端路由 + SDK 封装 + 前端接入均已完成 |
| ⚠️ 部分漂移 | 后端可用但 SDK/前端封装有分叉 |
| 🟡 行为不稳定 | 基本可用但存在逻辑疑点 |
| 🔴 未实现/有 bug | 缺少必要实现或存在已知 bug |

### Space 模块当前状态

| 功能 | 状态 | 说明 |
|------|------|------|
| 获取 Space 层级结构 | ⚠️ 部分漂移 | 后端有实现，SDK 有独立 SpaceManager |
| 获取 Space 信息 | ✅ 已集成 | `SpaceManager.getSpace()` 完整实现 |
| 获取 Space 子房间 | ✅ 已集成 | `SpaceManager.getSpaceChildren()` 完整实现 |
| 创建 Space | ✅ 已集成 | 完整实现 |
| 添加子房间 | ✅ 已集成 | `SpaceManager.addChild()` 完整实现 |
| 获取用户 Space 列表 | ✅ 已集成 | `SpaceManager.getUserSpaces()` 完整实现 |

---

## 已知问题

| 问题 | 位置 | 说明 | 优先级 |
|------|------|------|--------|
| 获取 Space 层级结构 | SDK | `SpaceManager.getSpaceHierarchy()` 本地实现，后端 API 需验证 | 🟡 中 |
