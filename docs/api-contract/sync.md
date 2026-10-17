---
module: sync
generated_from: docs/api-contract/generated/modules/sync.json
generated_hash: sha256-d006d094ab7ebe8789f6e6097ce662af99aba7a0b5af8607d21f319a100e2de5
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Sync 模块契约

> 审查来源: `synapse-rust/synapse-web/src/routes/sync.rs` 与 `sliding_sync.rs`
> 审计状态: ✅ `joined_rooms`、`my_rooms` 与 simplified sliding sync 主入口已绑定生成契约，sync 主链路对齐完成

## 挂载版本

| 前缀                                                     | 路由                                |
| -------------------------------------------------------- | ----------------------------------- |
| `/_matrix/client/unstable/org.matrix.msc3575`            | `/sync`                             |
| `/_matrix/client/unstable/org.matrix.simplified_msc3575` | `/sync`                             |
| `/_matrix/client/v1`                                     | `/sync`                             |
| `/_matrix/client/v3`                                     | `/events`、`/joined_rooms`、`/sync` |
| `/_matrix/client/v4`                                     | `/sync`                             |

> **命名空间变更（2026-10-12 核对）**：`/_matrix/client/r0` 下的 `/sync`、`/events`、`/joined_rooms`
> 已随 r0 退役**整体移除**；Sliding Sync 现挂 `/_matrix/client/v1`（简化版）、`/_matrix/client/v4`、
> `/_matrix/client/unstable/org.matrix.msc3575`、`/_matrix/client/unstable/org.matrix.simplified_msc3575`；
> 原 `/my_rooms` 已迁 `/_matrix/vendor/v1`（属 `room` 模块注册，本页仅作跨页指引）。

## GET 同步端点

| 方法 | 路径                              | 查询参数                                                    | 主要响应字段                                               | 认证 |
| ---- | --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ---- |
| GET  | `/_matrix/client/v3/sync`         | `since?` `timeout?` `filter?` `full_state?` `set_presence?` | `next_batch` `rooms` `presence` `account_data` `to_device` | 用户 |
| GET  | `/_matrix/client/v1/sync`         | 同上                                                        | 同上                                                       | 用户 |
| GET  | `/_matrix/client/v3/sync`         | 同上                                                        | 同上                                                       | 用户 |
| GET  | `/_matrix/client/v3/events`       | 流水线查询参数                                              | 事件流结果                                                 | 用户 |
| GET  | `/_matrix/client/v3/events`       | 流水线查询参数                                              | 事件流结果                                                 | 用户 |
| GET  | `/_matrix/client/v3/joined_rooms` | 无                                                          | `joined_rooms`                                             | 用户 |
| GET  | `/_matrix/client/v3/joined_rooms` | 无                                                          | `joined_rooms`                                             | 用户 |
| GET  | `/_matrix/vendor/v1/my_rooms`     | 无                                                          | `rooms`                                                    | 用户 |

## POST Sliding Sync

| 方法 | 路径                                                          | 主要请求字段                                                                                        | 主要响应字段                       | 认证 |
| ---- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- | ---- |
| POST | `/_matrix/client/v3/sync`                                     | `pos?` `timeout?` `lists?` `room_subscriptions?` `unsubscribe_rooms?` `extensions?`                 | `pos` `lists` `rooms` `extensions` | 用户 |
| POST | `/_matrix/client/unstable/org.matrix.msc3575/sync`            | 同上                                                                                                | 同上                               | 用户 |
| POST | `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync` | 同上；SDK 额外接受 `clientTimeout?` 作为本地请求超时，仅用于 `localTimeoutMs`，不会进入 HTTP 请求体 | 同上                               | 用户 |

## 字段级契约

### `GET /sync`

- 顶层字段
    - `next_batch`: 下一次增量同步令牌；后端编码格式为 `s{stream_id}` 或 `s{stream_id}_{to_device}_{device_lists}`
    - `rooms`: 房间同步容器，按 `join` / `invite` / `knock` / `leave` 四类分区返回
    - `presence.events`: Presence 事件数组
    - `account_data.events`: 账户级 account data 数组
    - `to_device.events`: to-device 事件数组
    - `device_lists.changed`: 设备列表发生变化的用户 ID 数组
    - `device_lists.left`: 已离开视图范围的用户 ID 数组
    - `device_one_time_keys_count`: 按算法名返回当前设备的剩余 OTK 数量映射（例如 `{"signed_curve25519": 42}`），不是空对象
- 查询参数行为
    - `set_presence?`: handler 会读取并传入 sync service，默认值为 `"online"`
- `filter?`: handler 现同时接受已保存 filter id 与 inline JSON filter；当前已支持 `event_fields`、`event_format`、顶层 `presence` 基础事件过滤，以及 `room.rooms` / `room.not_rooms` / `room.include_leave` / `room.timeline.limit`
- `filter?`: `room.timeline` / `room.state` / `room.ephemeral` / `room.account_data` 均已支持 `types` / `not_types` / `senders` / `not_senders` / `contains_url`，并且事件级 `rooms` / `not_rooms` 也会在值过滤阶段生效；`types` / `not_types` 额外支持以 `*` 结尾的前缀匹配
- `filter?`: `room.state.lazy_load_members` 与 `room.timeline.lazy_load_members` 已接入按成员缓存裁剪的语义；后端会在 `state.events` 中仅保留“当前用户 + 本次返回 timeline 涉及到、且当前 device 尚未知”的 `m.room.member` 状态，而非成员 state 仍按增量 state delta 返回
- `filter?`: `room.state.include_redundant_members` 与 `room.timeline.include_redundant_members` 现已生效；开启后即使成员已存在于当前 device 的 lazy-load 缓存中，也会继续在 `state.events` 中重复返回相关 `m.room.member`
- `filter?`: 当前 lazy-load 成员缓存同时存在于 `synapse-rust` 进程内与数据库，按 `user_id + device_id + room_id` 维度维护；因此既可跨次 `/sync` 请求复用，也可在新的 `SyncService` 实例中恢复并延续设备级去重语义
- `filter?`: 增量 `/sync` 的 `state.events` 会返回自 `since` 以来的 state delta；未开启 `lazy_load_members` 时会直接返回这些增量 state，开启后则对 `m.room.member` 额外套用 Synapse 风格的 lazy-load 裁剪与缓存去重
- `filter?`: `lazy_load_members` 现已补齐官方 Synapse 的关键增量语义：当本次 `/sync` 的 `timeline.limited = false` 时，若自 `since` 以来房间内存在不在 timeline 中的 `m.room.member` state delta，相关成员的当前 membership state 也会进入 `state.events`
- `filter?`: 当 `timeline.limited = true` 时，lazy-load 不会因为“仅存在于 state delta 的 membership 变化”而额外扩张 `state.events`；此时只保证返回当前用户与本次实际回传 timeline 所需的成员状态
- `filter?`: 若只有非成员 state 变化且这些事件被 timeline filter 排除，房间仍会按 state delta 进入本次 `/sync`
- `filter?`: `event_fields` 会裁剪 `presence` / `account_data` / `to_device` / 房间 `state` / `timeline` / `ephemeral` / `account_data` 里的事件字段，支持 `content.body`、`unsigned.age` 这类点路径

### `GET /sync` 房间对象

- `rooms.join.{room_id}.state.events`: 房间 state 事件数组；全量 sync 返回当前房间 state，增量 sync 返回自 `since` 以来的 state delta；若启用 `lazy_load_members`，其中 `m.room.member` 会再按当前用户、timeline 关联成员与设备缓存裁剪。若提供 `filter.room.state`，会按 `types` / `not_types` / `senders` / `not_senders` / `rooms` / `not_rooms` 过滤；若指定 `event_format=federation`，会额外包含 `depth` / `origin`
- `rooms.join.{room_id}.timeline.events`: 时间线事件数组，按旧到新返回；若指定 `event_format=federation`，会额外包含 `depth` / `origin`
- `rooms.join.{room_id}.timeline.limited`: 是否因为服务端窗口限制或 `filter.room.timeline.limit` 而截断；仅当服务端确认还有未返回的更多 timeline 事件时才为 `true`
- `rooms.join.{room_id}.timeline.prev_batch`: 回溯分页令牌，当前实现以 `t{origin_server_ts}` 生成
- `rooms.join.{room_id}.ephemeral.events`: 临时事件数组；若提供 `filter.room.ephemeral`，会按 `types` / `not_types` / `senders` / `not_senders` 过滤
- `rooms.join.{room_id}.account_data.events`: 房间级 account data 数组；若提供 `filter.room.account_data`，会按 `types` / `not_types` / `senders` / `not_senders` 过滤
- `rooms.join.{room_id}.unread_notifications.highlight_count`: 高亮未读数
- `rooms.join.{room_id}.unread_notifications.notification_count`: 普通通知未读数
- `rooms.leave.{room_id}`: 当 `filter.room.include_leave=true` 时，后端会把当前用户 membership 为 `leave` 的房间归入 `rooms.leave`

### `GET /events`

- 顶层字段
    - `start`: 请求中的 `from` 令牌原样回显
    - `end`: 下一页事件流令牌，当前实现生成为 `s{timestamp}`
    - `chunk`: 事件数组，来自当前用户已加入房间在 `from` 之后的事件

### `GET /joined_rooms`

- 顶层字段
    - `joined_rooms`: 已加入房间 ID 数组

### `GET /my_rooms`

- 顶层字段
    - `rooms`: 房间列表
    - `total`: 房间列表条目总数，等于 `rooms.length`
- `rooms[]` 列表项字段
    - `room_id`: 房间 ID
    - `membership`: 当前用户在该房间的 membership
    - `name`: 房间名称；后端为空时回退为 `""`
    - `avatar_url`: 房间头像 MXC；后端为空时回退为 `""`

### `POST /sync` Sliding Sync

- 请求字段
    - `pos?`: 增量位置令牌，走查询参数
    - `timeout?`: 长轮询等待时长，走查询参数；`0` 也是合法值
    - `lists?`: 列窗口、排序与过滤定义
    - `room_subscriptions?`: 指定房间订阅配置
    - `unsubscribe_rooms?`: 取消订阅的房间 ID 数组
    - `extensions?`: 扩展请求负载
- 响应字段
    - `pos`: 新的滑动同步位置
    - `conn_id?`: 服务端连接标识
    - `lists`: list 响应对象，键为 list 名称
    - `rooms`: 房间响应对象，键为 room ID
    - `extensions?`: 扩展响应对象
- `rooms.{room_id}` 常见字段
    - `name?`: 房间名称
    - `required_state?`: 订阅请求的状态事件
    - `timeline?`: 时间线事件
    - `invite_state?`: 邀请态状态事件
    - `heroes?`: Hero 列表
    - `notification_count?`: 通知未读数
    - `highlight_count?`: 高亮未读数
    - `joined_count?`: joined 成员数
    - `invited_count?`: invited 成员数
    - `initial?`: 是否初始快照
    - `limited?`: 时间线是否截断
    - `is_dm?`: 是否 DM
    - `prev_batch?`: 时间线回溯令牌
    - `num_live?`: 本次增量 live event 数量
    - `timestamp?`: 房间 bump 时间戳

## 常见状态码

| 状态码 | 说明                   |
| ------ | ---------------------- |
| `200`  | 请求成功               |
| `400`  | 参数错误               |
| `401`  | Token 无效或缺失       |
| `429`  | 长轮询或同步请求被限流 |

## SDK 对齐结论

- `src/client-batch-requests.ts` 中的 `getJoinedRoomsRequest()` 已绑定生成的 `SyncPathPattern`，默认走 `GET /_matrix/client/v3/joined_rooms`。
- `src/client-secure-backup-requests.ts` 中的 `getMyRoomsRequest()` 已绑定生成的 `SyncPathPattern`，实际调用 `GET /_matrix/vendor/v1/my_rooms`。
- `src/client.ts` 中的 `slidingSync()` 已绑定生成的 `SlidingSyncPathPattern`，继续使用 `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync` 作为 SDK 主入口。
- `SyncManager.getJoinedRooms()` 复用 `MatrixClient.getJoinedRooms()`，不再是契约缺口。
- 传统 `GET /sync` 与 `GET /events` 的核心实现仍位于底层 `SyncApi`/`MatrixClient` 同步栈，本轮未改变行为，只完成稳定入口的显式契约绑定。

## 覆盖率口径

- **Ledger 契约端点数**: 8
- **SDK 主入口已绑定生成契约**: 8/8
- **契约覆盖率**: 100%

## 代码定位

- 路由声明: `synapse-rust/synapse-web/src/routes/sync.rs`
- Sliding Sync 路由: `synapse-rust/synapse-web/src/routes/sliding_sync.rs`
- 处理器: `synapse-rust/synapse-web/src/routes/handlers/sync.rs`

## DTO Definitions

> Source: `src/sync/__generated__/dto.ts`

```typescript
export interface SyncRequest {
    filter?: string;
    full_state?: boolean;
    set_presence?: string;
    timeout?: number;
    since?: string;
}
export interface SyncResponse {
    next_batch: string;
    rooms?: SyncRooms;
    presence?: SyncPresence;
    account_data?: SyncAccountData;
    to_device?: SyncToDevice;
    device_lists?: SyncDeviceLists;
    device_one_time_keys_count?: Record<string, number>;
    device_unused_fallback_key_types?: string[];
}
export interface SyncRooms {
    join?: Record<string, SyncJoinedRoom>;
    invite?: Record<string, SyncInvitedRoom>;
    leave?: Record<string, SyncLeftRoom>;
    knock?: Record<string, SyncKnockedRoom>;
}
export interface SyncJoinedRoom {
    summary?: SyncRoomSummary;
    state?: SyncState;
    timeline: SyncTimeline;
    ephemeral?: SyncEphemeral;
    account_data?: SyncAccountData;
    unread_notifications?: SyncUnreadNotifications;
    unread_thread_notifications?: Record<string, SyncUnreadNotifications>;
}
export interface SyncInvitedRoom {
    invite_state: SyncInviteState;
}
export interface SyncLeftRoom {
    state?: SyncState;
    timeline: SyncTimeline;
    account_data?: SyncAccountData;
}
export interface SyncKnockedRoom {
    knock_state: SyncKnockState;
}
export interface SyncRoomSummary {
    "m.heroes"?: string[];
    "m.joined_member_count"?: number;
    "m.invited_member_count"?: number;
}
export interface SyncState {
    events: SyncStateEvent[];
}
export interface SyncStateEvent {
    content: IContent;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    state_key: string;
    prev_content?: IContent;
    unsigned?: Record<string, unknown>;
}
export interface SyncTimeline {
    events: SyncTimelineEvent[];
    limited?: boolean;
    prev_batch: string | null;
}
export interface SyncTimelineEvent {
    content: IContent;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: Record<string, unknown>;
}
export interface SyncEphemeral {
    events: SyncMinimalEvent[];
}
export interface SyncPresence {
    events: SyncMinimalEvent[];
}
export interface SyncAccountData {
    events: SyncMinimalEvent[];
}
export interface SyncMinimalEvent {
    content: IContent;
    type: string;
    room_id?: string;
    unsigned?: Record<string, unknown>;
}
export interface SyncInviteState {
    events: SyncStrippedState[];
}
export interface SyncStrippedState {
    content: IContent;
    state_key: string;
    type: string;
    sender: string;
}
export interface SyncKnockState {
    events: SyncStrippedState[];
}
export interface SyncToDevice {
    events: SyncToDeviceEvent[];
}
export interface SyncToDeviceEvent {
    content: IContent;
    sender: string;
    type: string;
}
export interface SyncDeviceLists {
    changed?: string[];
    left?: string[];
}
export interface SyncUnreadNotifications {
    highlight_count?: number;
    notification_count?: number;
}
```

## 实现口径补充（2026-10-17 后端契约回灌）

> 依据：`synapse-rust/docs/sdk/sync.md`、`synapse-rust/docs/sdk/messages.md` 与
> `docs/api-contract/generated/modules/sync.json`、`sliding_sync.json`、`room.json`。
> 本节只补充口径，不覆盖上文既有路由表行与统计数字。

### 房间分区与 stripped state

- `rooms` 恒含 `join` / `invite` / `knock` / `leave` 四个分区；空分区可以省略，但不会出现第五种键名。
- `rooms.invite.{room_id}` 与 `rooms.knock.{room_id}` **只有 stripped state，没有 timeline**：
    - invite 用 `invite_state.events`，knock 用 `knock_state.events`，事件形状为 `{content, state_key, type, sender}`。
    - 必需 stripped state 类型依次为 `m.room.create`、`m.room.join_rules`、`m.room.name`、`m.room.avatar`、
      `m.room.topic`、`m.room.encryption`、`m.room.canonical_alias`、`m.room.member` 等。
- **fail-closed**：若既没有邀请方带来的 stripped state，本地房间状态里又没有 `m.room.create`，该房间会被
  **整体略过**，不会出现在 `rooms.invite` 中。客户端不可假设“收到邀请就能读到房间名”。
- knock 房间**永远不会**以 `join` 形态出现，避免把敲门误判为已加入。
- `rooms.leave.{room_id}` 结构与 join 相同，通常只有 `timeline` 尾部与 `account_data`，并同时覆盖主动离开与被踢/被封禁。

### 响应字段

- `device_one_time_keys_count` 是按算法名到剩余 OTK 数量的映射（如 `{"signed_curve25519": 42}`），不是空对象；
  E2EE 依赖它判断何时补传 `/keys/upload`。
- `device_unused_fallback_key_types` 是**字符串数组**（如 `["signed_curve25519"]`），不是对象映射。
- `use_state_after=true`（不稳定拼写 `org.matrix.msc4222.use_state_after`，两者同时出现时以不稳定拼写优先）时：
    - 房间对象中的 `state` 键**改名为 `state_after`**，且该房间**不再有 `state`**；
    - 不稳定拼写下键名为 `org.matrix.msc4222.state_after`。
- 扩展字段（`GET /sync` 顶层）：
    - `key_rotation_needed.rooms`: 本仓扩展，服务端判定需要轮换 megolm 会话的房间 ID 数组。
    - `device_list_changes`: 本仓扩展，`{users, changed_count, left_count}` 形式的 `device_lists` 带计数投影；
      `users[user_id] = {change_type: "changed"|"left", device_count?}`，`device_count` 仅在 changed 且计数查询成功时存在。
      它不是 `device_lists` 的同义副本：changed 用户若设备数查询失败会从 `users` 缺席，但 `changed_count` 仍计入。
- 房间级 `sticky_events`（本仓 MSC4354 扩展，可选）：仅当房间存在 sticky 事件时出现，元素为
  `{event_type, event_id, is_sticky}`，与 `GET /_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events` 同源。
- 布尔查询参数接受 `true/false`、`1/0`、`yes/no`（大小写不敏感）。

### 错误、超时与重试

- `since` 无法解析返回 **400 `M_BAD_PAGINATION`**（`Invalid since token`），**不是 401**；客户端应丢弃本地 `since`
  改走初始同步，**不要**清 token。只有 401 `M_UNKNOWN_TOKEN` 才清 token 并重新登录。
- `timeout` 为负数返回 400 `M_BAD_JSON`；`timeout=0` 合法，表示立即返回。
- 超出同步限流返回 429 `M_LIMIT_EXCEEDED`，带 `retry_after_ms` 与 `Retry-After` / `X-RateLimit-*` 头；
  客户端应按 `retry_after_ms` 退避，不要立即重连（会造成同步风暴）。
- 初始同步与增量同步**分开限流**（`ratelimit:sync:{user}:{device}:initial|incremental`）；限流后端故障时默认 fail-open。
- 服务端内部等待上限是客户端 `timeout` **+ 15s** 缓冲；客户端 HTTP 超时应至少设为 `timeout + 20s`。
- 同一时刻只应保持一个 `since` 请求在飞；需要强制刷新时用 `timeout=0` 重新发起，而不是并发两个请求。

### 路由边界

- `/_matrix/client/v3/sync` **只有 GET**。对 v3 发 `POST /sync` 返回 **405 `M_UNRECOGNIZED`**
  （`Method not allowed for this endpoint`）。Sliding Sync 只能走 `v1` / `v4` / `unstable/*`。
- 不存在 `GET /_matrix/client/v1/sync`；`v1` 下的 `/sync` 仅承载 Simplified Sliding Sync 的 `POST`。
- `GET /_matrix/vendor/v1/my_rooms` 属 `room` 模块注册（`/_matrix/vendor/v1` 私有前缀），不在 `sync.json` 清单内。
- Ledger 口径：`sync.json` 仅登记 **3** 条经典同步路由（`GET /_matrix/client/v3/events`、
  `GET /_matrix/client/v3/joined_rooms`、`GET /_matrix/client/v3/sync`）；本页“8”是连同 `sliding_sync.json`
  的 4 条与 `my_rooms` 的 1 条跨清单合计，统计数字本身不改。
