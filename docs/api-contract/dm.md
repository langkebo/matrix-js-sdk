# DM (Direct Message) 模块 API 契约

> 私信相关 API 的 SDK 与后端接口契约

## 概述

DM 模块涉及以下 Matrix API：

| 功能 | Matrix API | 说明 |
|------|------------|------|
| 获取 DM 列表 | `client.getRooms()` + `m.direct` | 通过 `m.direct` account data 过滤 DM 房间 |
| 创建 DM | `/_matrix/client/v3/createRoom` | 创建带 `is_direct: true` 标识的房间 |
| m.direct 读取 | `client.getAccountData('m.direct')` | 用户级别的 account data |
| m.direct 写入 | `client.setAccountData('m.direct', content)` | 更新用户级别的 account data |

---

## 获取 DM 列表 / Get DM Rooms

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | 客户端本地过滤（无后端路由） |
| HTTP 方法 | 无 |
| SDK 方法 | `client.getRooms()` + `client.getAccountData(EventType.Direct)` |
| SDK 模块 | `matrix-js-sdk/src/dm/index.ts` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| 无 | - | - | 通过 `m.direct` account data 获取 DM 映射关系 |

### 响应结构

```typescript
interface IDirectRoomsMap {
    [userId: string]: string[];  // userId -> roomId[] 的映射
}

interface DmRoomInfo {
    roomId: string;
    inviter?: string;
    invitees: string[];
    name?: string;
    avatarUrl?: string;
    lastMessage?: {
        content: string;
        timestamp: number;
        sender: string;
    };
    unreadCount?: number;
}
```

### SDK 方法调用

```typescript
// 方式1: 使用 DirectMessageManager (推荐)
const dmManager = client.getDirectMessageManager();
const dmRooms = await dmManager.getDMRooms();

// 方式2: 手动过滤
const accountData = client.getAccountData('m.direct');
const dmMap: IDirectRoomsMap = accountData?.getContent() || {};
const allRooms = client.getRooms();
const dmRooms = allRooms.filter(room => {
    const roomId = room.roomId;
    return Object.values(dmMap).some(roomIds => roomIds.includes(roomId));
});
```

### 对应关系

- **后端实现**: 无（客户端本地过滤）
- **SDK 封装**: [matrix-js-sdk/src/dm/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/dm/index.ts) - `DirectMessageManager.getDMRooms()`
- **前端调用**: [hula/src/services/matrix/MatrixDirectMessageService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixDirectMessageService.ts) - `getDMRooms()`

---

## 创建 DM / Create DM Room

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/createRoom` |
| HTTP 方法 | POST |
| SDK 方法 | `client.createRoom()` 或 `dmManager.createDm()` |
| SDK 模块 | `matrix-js-sdk/src/dm/index.ts` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `is_direct` | `boolean` | 是 | 设为 `true` 表示 DM 房间 |
| `invite` | `string[]` | 是 | 邀请的用户 ID 列表 |
| `preset` | `string` | 否 | 房间预设：`trusted_private_chat`（加密）、`private_chat`（非加密） |
| `name` | `string` | 否 | 房间名称 |
| `topic` | `string` | 否 | 房间主题 |
| `initial_state` | `array` | 否 | 初始状态事件（如加密配置） |

### 请求示例

```typescript
// 通过 DirectMessageManager 创建（推荐）
const dmManager = client.getDirectMessageManager();
const roomId = await dmManager.createDm({
    userIds: ['@user:example.com'],
    isEncrypted: true,  // 默认加密
    name: 'DM Name',
});

// 直接调用 createRoom
const response = await client.createRoom({
    is_direct: true,
    invite: ['@user:example.com'],
    preset: 'trusted_private_chat',
    initial_state: [
        {
            type: 'm.room.encryption',
            state_key: '',
            content: {
                algorithm: 'm.megolm.v1.aes-sha2',
            },
        },
    ],
});
```

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

- **后端实现**: `synapse-rust/src/web/routes/room.rs`
- **SDK 封装**: [matrix-js-sdk/src/dm/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/dm/index.ts) - `DirectMessageManager.createDm()`
- **前端调用**: [hula/src/services/matrix/MatrixDirectMessageService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixDirectMessageService.ts) - `createDm()`

---

## m.direct 读取 / Read m.direct Account Data

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | 客户端本地操作（无后端路由） |
| HTTP 方法 | 无 |
| SDK 方法 | `client.getAccountData('m.direct')` |
| SDK 模块 | `matrix-js-sdk/src/dm/index.ts` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| 无 | - | - | 直接读取当前用户的 account data |

### 响应结构

```typescript
interface IDirectRoomsMap {
    [userId: string]: string[];  // 格式: { "@user:example.com": ["!roomId:example.com", ...] }
}
```

### ⚠️ 重要说明

> **m.direct 是用户级别的 account data，不是房间级别！**

| 正确做法 | 错误做法 |
|----------|----------|
| `client.getAccountData(EventType.Direct)` | `room.getAccountData(EventType.Direct)` |

### SDK 方法调用

```typescript
// 方式1: 使用 DirectMessageManager (推荐)
const dmManager = client.getDirectMessageManager();
const dmMap = await dmManager.getDirectRoomsByUser();
// 返回: { "@user:example.com": ["!roomId:example.com"] }

// 方式2: 直接读取
import { EventType } from 'matrix-js-sdk';
const accountData = client.getAccountData(EventType.Direct);
const dmMap = accountData?.getContent() as IDirectRoomsMap;
```

### 对应关系

- **后端实现**: 无（客户端本地操作）
- **SDK 封装**: [matrix-js-sdk/src/dm/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/dm/index.ts) - `DirectMessageManager.getDirectRoomsByUser()`
- **前端调用**: [hula/src/services/matrix/MatrixDirectMessageService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixDirectMessageService.ts)

---

## m.direct 写入 / Write m.direct Account Data

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | 客户端本地操作（无后端路由） |
| HTTP 方法 | 无 |
| SDK 方法 | `client.setAccountData('m.direct', content)` |
| SDK 模块 | `matrix-js-sdk/src/dm/index.ts` |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `content` | `IDirectRoomsMap` | 是 | m.direct 内容，格式为 `{ [userId]: [roomId, ...] }` |

### 请求示例

```typescript
// 方式1: 使用 DirectMessageManager (推荐)
const dmManager = client.getDirectMessageManager();
await dmManager.setDmRoom(roomId, '@user:example.com');

// 方式2: 直接设置
import { EventType } from 'matrix-js-sdk';
const dmMap = {
    '@user:example.com': ['!roomId:example.com'],
};
await client.setAccountData(EventType.Direct, dmMap);
```

### 响应结构

无返回值（void）。

### 状态码

无 HTTP 状态码（客户端本地操作）。

### ⚠️ 重要说明

> **m.direct 写入会覆盖整个映射表，而不是增量更新！**

正确的写入方式：

```typescript
// 1. 先读取现有内容
const dmMap = await dmManager.getDirectRoomsByUser();

// 2. 修改内容
if (!dmMap[userId]) {
    dmMap[userId] = [];
}
dmMap[userId].push(roomId);

// 3. 写回（完整覆盖）
await client.setAccountData(EventType.Direct, dmMap);
```

### 对应关系

- **后端实现**: 无（客户端本地操作）
- **SDK 封装**: [matrix-js-sdk/src/dm/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/dm/index.ts) - `DirectMessageManager.setDmRoom()`
- **前端调用**: [hula/src/services/matrix/MatrixDirectMessageService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixDirectMessageService.ts) - `setDmRoom()`

---

## 状态说明

| 状态 | 说明 |
|------|------|
| ✅ 已集成 | 后端路由 + SDK 封装 + 前端接入均已完成 |
| ⚠️ 部分漂移 | 后端可用但 SDK/前端封装有分叉 |
| 🟡 行为不稳定 | 基本可用但存在逻辑疑点 |
| 🔴 未实现/有 bug | 缺少必要实现或存在已知 bug |

### DM 模块当前状态

| 功能 | 状态 | 说明 |
|------|------|------|
| 获取 DM 列表 | ✅ 已集成 | `getDMRooms()` 支持 invite/join，含回退机制 |
| 创建 DM | ✅ 已集成 | 后端 + SDK + 前端均已接通 |
| m.direct 读取 | ✅ 已集成 | 使用 `client.getAccountData()` 正确读取 |
| m.direct 写入 | ✅ 已集成 | 通过 `setDmRoom()` 正确写入 |
| 根据用户ID获取DM | ✅ 已集成 | `getDmRoomsByUserIds()` 完整实现 |
| 检查房间是否DM | ✅ 已集成 | `checkRoomIsDm()` 正确实现 |
| 获取DM伙伴 | ✅ 已集成 | `getDmPartner()` 正确实现 |

---

## 已知问题

| 问题 | 位置 | 说明 | 优先级 |
|------|------|------|--------|
| m.direct 写入覆盖问题 | `matrix-js-sdk/src/dm/index.ts` | 需要完整读取-修改-写入模式 | 🟡 中 |
| SDK 缺少独立 SpaceManager | `matrix-js-sdk/src/` | Space 能力依赖 core client | 🟡 中 |
