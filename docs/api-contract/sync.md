# Sync 模块 API 契约

> 同步相关 API 的 SDK 与后端接口契约

## 概述

Sync 模块涉及以下 Matrix API：

| 功能 | Matrix API | 说明 |
|------|------------|------|
| 同步 | `/_matrix/client/v3/sync` | GET |
| 增量同步 | `/_matrix/client/v3/sync?since={token}` | GET |
| 滚动密钥更新 | `/_matrix/client/v3/sync` (filter 参数) | GET |
| 获取已加入房间 | `/_matrix/client/v3/joined_rooms` | GET |
| Sliding Sync | `/_matrix/client/v3/sync` (POST) | POST MSC3575 |

---

## 同步 / Sync

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/sync` |
| HTTP 方法 | GET |
| SDK 方法 | `client.sync()` (内部) |
| SDK 模块 | `matrix-js-sdk/src/sync.ts` (SyncApi) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `timeout` | `number` | 否 | 等待时间（毫秒），默认 30000 |
| `since` | `string` | 否 | 上次同步的 next_batch，用于增量同步 |
| `full_state` | `boolean` | 否 | 是否返回完整状态，默认 false |
| `set_presence` | `string` | 否 | 在线状态：`online`, `offline`, `unavailable` |
| `filter` | `string \| Filter` | 否 | 过滤器 ID 或内联过滤器 |

### 增量同步参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `since` | `string` | 是 | 上次同步返回的 `next_batch` |

### 滚动密钥更新参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `filter` | `Filter` | 否 | 包含 `room.rooms` 滚动密钥过滤 |

### 响应结构

```typescript
interface SyncResponse {
    next_batch: string;
    rooms?: {
        join?: Record<string, RoomData>;
        leave?: Record<string, RoomData>;
        invite?: Record<string, RoomData>;
        knock?: Record<string, RoomData>;
    };
    presence?: {
        events: Event[];
    };
    account_data?: {
        events: Event[];
    };
    to_device?: {
        events: Event[];
    };
    device_lists?: {
        changed?: string[];
        left?: string[];
    };
    device_one_time_keys_count?: Record<string, number>;
    device_unused_fallback_key_types?: string[];
    org_matrix_msc4075_action?: string;
}

interface RoomData {
    timeline?: {
        events: Event[];
        prev_batch?: string;
        limited?: boolean;
    };
    state?: {
        events: Event[];
    };
    ephemeral?: {
        events: Event[];
    };
    account_data?: {
        events: Event[];
    };
    unread_notifications?: {
        notification_count?: number;
        highlight_count?: number;
    };
    summary?: {
        "m.joined_member_count"?: number;
        "m.invited_member_count"?: number;
        "org.matrix.msc3879.recurring"?: boolean;
        "org.matrix.msc3879.metadata"?: Record<string, unknown>;
    };
}
```

### SDK 内部接口

```typescript
interface ISyncParams {
    filter?: string;
    timeout: number;
    since?: string;
    full_state?: boolean;
    set_presence?: SetPresence;
    _cacheBuster?: string | number;
    "org.matrix.msc4222.use_state_after"?: boolean;
}

type SetPresence = 'online' | 'offline' | 'unavailable';
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 同步成功 |
| 401 | 未认证或 Token 无效 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/handlers/sync.rs` - `sync()`
- **SDK 封装**: [matrix-js-sdk/src/sync.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/sync.ts) - `SyncApi.sync()`
- **前端调用**: [hula/src/services/matrix/MatrixSyncService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSyncService.ts) - `startSync()`

---

## 增量同步 / Incremental Sync

### 基本信息

增量同步通过在请求中包含 `since` 参数来实现，只返回自上次同步以来的变更。

### 请求示例

```typescript
// 首次同步
const firstSync = await client.sync({
    timeout: 30000,
    filter: myFilter,
    fullState: true
});

// 保存 next_batch
const nextBatch = firstSync.next_batch;

// 后续增量同步
const incrementalSync = await client.sync({
    timeout: 30000,
    since: nextBatch
});
```

### 增量同步行为

| 场景 | 返回内容 |
|------|----------|
| 新消息 | 在对应房间的 `timeline.events` 中 |
| 房间状态变更 | 在对应房间的 `state.events` 中 |
| 新邀请 | 在 `rooms.invite` 中 |
| 离开房间 | 在 `rooms.leave` 中 |
| 账号数据变更 | 在 `account_data.events` 中 |
| To-Device 消息 | 在 `to_device.events` 中 |

### SDK 处理

```typescript
// matrix-js-sdk/src/sync.ts
private async doSync(syncOptions: ISyncOptions): Promise<void> {
    while (this.running) {
        const syncToken = this.client.store.getSyncToken();

        let data: ISyncResponse;
        try {
            if (!this.currentSyncRequest) {
                this.currentSyncRequest = this.doSyncRequest(syncOptions, syncToken);
            }
            data = await this.currentSyncRequest;
        } catch (e) {
            const abort = await this.onSyncError(<MatrixError>e);
            if (abort) return;
            continue;
        } finally {
            this.currentSyncRequest = undefined;
        }

        // 设置同步 token
        this.client.store.setSyncToken(data.next_batch);

        // 处理同步响应
        await this.processSyncResponse(syncEventData, data);
    }
}
```

---

## 滚动密钥更新 / Key Streaming

### 基本信息

滚动密钥更新是 Matrix MSC3879 实现的功能，通过 Sliding Sync 的 `room.rooms` 字段实现。

### 响应结构

```typescript
interface KeyStreamingResponse {
    next_batch: string;
    rooms: {
        join: Record<string, {
            account_data?: {
                events: Array<{
                    type: 'm.room.key_requests';
                    content: {
                        action: 'request';
                        requested_key_id: string;
                        [key: string]: unknown;
                    };
                }>;
            };
        }>;
    };
}
```

### SDK 处理

```typescript
// matrix-js-sdk/src/sync.ts
interface RoomSummary {
    "m.joined_member_count"?: number;
    "m.invited_member_count"?: number;
    "org.matrix.msc3879.recurring"?: boolean;
    "org.matrix.msc3879.metadata"?: Record<string, unknown>;
}
```

---

## 获取已加入房间 / Get Joined Rooms

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/joined_rooms` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getJoinedRooms()` |
| SDK 模块 | `matrix-js-sdk/src/sync.ts` |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface JoinedRoomsResponse {
    joined_rooms: string[];
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/sync.rs` - `get_joined_rooms()`
- **SDK 封装**: [matrix-js-sdk/src/sync.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/sync.ts) - `SyncApi.getJoinedRooms()`
- **前端调用**: [hula/src/services/matrix/MatrixSyncService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSyncService.ts)

---

## 获取我的房间 / Get My Rooms

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/my_rooms` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getMyRooms()` |
| SDK 模块 | `matrix-js-sdk/src/sync.ts` |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface MyRoomsResponse {
    rooms: Array<{
        room_id: string;
        membership: 'join' | 'leave' | 'invite' | 'ban' | 'knock';
    }>;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/sync.rs` - `get_my_rooms()`
- **SDK 封装**: [matrix-js-sdk/src/sync.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/sync.ts)
- **前端调用**: [hula/src/services/matrix/MatrixSyncService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSyncService.ts)

---

## Sliding Sync / MSC3575

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/sync` (POST) 或 `/_matrix/client/unstable/org.matrix.msc3575/sync` |
| HTTP 方法 | POST |
| SDK 方法 | `slidingSync()` |
| SDK 模块 | `matrix-js-sdk/src/sliding-sync-sdk.ts` |
| 认证要求 | 是 |

### 请求结构

```typescript
interface SlidingSyncRequest {
    pos?: string;
    lists?: Record<string, SlidingSyncList>;
    rooms?: string[];
}

interface SlidingSyncList {
    ranges?: Array<[number, number]>;
    filter?: {
        limit?: number;
        has_unsent?: boolean;
        rooms?: string[];
        room_subscriptions?: Record<string, RoomSubscription>;
    };
    sort?: string[];
    required_state?: Array<[string, string]>;
    extensions?: {
        account_data?: boolean;
        receipts?: boolean | { lists?: string[] };
        typing?: boolean;
        [key: string]: unknown;
    };
}

interface RoomSubscription {
    timeline_limit?: number;
   灭火state?: Array<[string, string]>;
}
```

### 响应结构

```typescript
interface SlidingSyncResponse {
    pos: string;
    lists?: Record<string, {
        channels: Array<{
            room_id: string;
            name?: string;
            avatar_url?: string;
            highlight_count?: number;
            notification_count?: number;
            num_joined_members?: number;
            last_msg?: {
                event_id: string;
                sender: string;
                ts: number;
                content: unknown;
            };
            initial?: boolean;
        }>;
        count?: number;
    }>;
    rooms?: Record<string, {
        name?: string;
        avatar_url?: string;
        required_state?: Event[];
        timeline?: Event[];
        limited?: boolean;
        prev_batch?: string;
    }>;
    extensions?: {
        account_data?: {
            events: Event[];
        };
        receipts?: {
            rooms: string[];
            chunks: Array<{
                room_id: string;
                receipt: {
                    [user_id: string]: {
                        ts: number;
                        event_id: string;
                    };
                };
            }>;
        };
        typing?: {
            rooms: string[];
            chunks: Array<{
                room_id: string;
                user_id: string;
                ts: number;
            }>;
        };
    };
}
```

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/sliding_sync.rs` - `sliding_sync()`
- **SDK 封装**: [matrix-js-sdk/src/sliding-sync-sdk.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/sliding-sync-sdk.ts) - `SlidingSyncSdk`
- **前端调用**: [hula/src/services/matrix/MatrixSlidingSyncService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixSlidingSyncService.ts)

---

## 同步状态 / Sync State

### SDK 同步状态机

```typescript
type SyncState = 'PREPARED' | 'SYNCING' | 'ERROR' | 'STOPPED' | 'CATCHUP';

interface ISyncStateData {
    // 同步错误信息（当 syncState 为 ERROR 时）
    error?: Error;
    // 下一个同步 token
    nextSyncToken?: string;
    // 是否正在追赶（catchup）模式
    catchingUp?: boolean;
    // 是否来自缓存
    fromCache?: boolean;
}
```

### 状态转换

| 当前状态 | 事件 | 下一状态 |
|----------|------|----------|
| null | 首次同步成功 | PREPARED |
| PREPARED | 继续同步 | SYNCING |
| SYNCING | 同步请求中 | SYNCING |
| SYNCING | 同步成功 | SYNCING / CATCHUP |
| * | 同步失败 | ERROR |
| ERROR | 重试成功 | SYNCING |
| * | 调用 stop() | STOPPED |

---

## SDK Manager 导出状态

| Manager | 导出位置 | 状态 |
|---------|----------|------|
| `SyncApi` | `matrix-js-sdk/src/sync.ts` | ✅ 内部使用 |
| `SyncManager` | `matrix-js-sdk/src/sync-management/index.ts` | ✅ 完整 |
| `SlidingSyncSdk` | `matrix-js-sdk/src/sliding-sync-sdk.ts` | ⚠️ 部分实现 |
| `SyncAccumulatorManager` | `matrix-js-sdk/src/sync-accumulator/index.ts` | ✅ 完整 |

---

## 状态说明

| 状态 | 说明 |
|------|------|
| ✅ 已集成 | 后端路由 + SDK 封装 + 前端接入均已完成 |
| ⚠️ 部分漂移 | 后端可用但 SDK/前端封装有分叉 |
| 🟡 行为不稳定 | 基本可用但存在逻辑疑点 |
| 🔴 未实现/有 bug | 缺少必要实现或存在已知 bug |

### Sync 模块当前状态

| 功能 | 状态 | 说明 |
|------|------|------|
| 同步 | ✅ 已集成 | 完整实现 |
| 增量同步 | ✅ 已集成 | 完整实现 |
| 滚动密钥更新 | ⚠️ 部分实现 | MSC3879 支持 |
| 获取已加入房间 | ✅ 已集成 | 完整实现 |
| 获取我的房间 | ✅ 已集成 | 完整实现 |
| Sliding Sync | ⚠️ 部分实现 | 后端有实现，SDK 支持 |

---

## 已知问题

| 问题 | 位置 | 说明 | 优先级 |
|------|------|------|--------|
| Sliding Sync 完整实现 | `matrix-js-sdk/src/sliding-sync-sdk.ts` | 部分功能，滚动密钥等待完善 | 🟡 中 |
| 同步错误处理 | `matrix-js-sdk/src/sync.ts` | 错误分类和处理可以优化 | 🟡 中 |
