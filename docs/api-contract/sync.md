---
module: sync
generated_from: docs/api-contract/generated/modules/sync.json
generated_hash: sha256-6456d1f88499e3efe7c22b09da0c94002f940639c0e730e5da9f9d64c3821b83
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Sync 模块契约

> 审查来源: `synapse-rust/src/web/routes/sync.rs` 与 `sliding_sync.rs`
> 审计状态: ✅ `joined_rooms`、`my_rooms` 与 simplified sliding sync 主入口已绑定生成契约，sync 主链路对齐完成

## 挂载版本

| 前缀                                                     | 路由                                          |
| -------------------------------------------------------- | --------------------------------------------- |
| `/_matrix/client/r0`                                     | `/sync` `/events` `/joined_rooms`             |
| `/_matrix/client/v1`                                     | `/sync`                                       |
| `/_matrix/client/v3`                                     | `/sync` `/events` `/joined_rooms` `/my_rooms` |
| `/_matrix/client/unstable/org.matrix.msc3575`            | `POST /sync`                                  |
| `/_matrix/client/unstable/org.matrix.simplified_msc3575` | `POST /sync`                                  |

## GET 同步端点

| 方法 | 路径                              | 查询参数                                                    | 主要响应字段                                               | 认证 |
| ---- | --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ---- |
| GET  | `/_matrix/client/r0/sync`         | `since?` `timeout?` `filter?` `full_state?` `set_presence?` | `next_batch` `rooms` `presence` `account_data` `to_device` | 用户 |
| GET  | `/_matrix/client/v1/sync`         | 同上                                                        | 同上                                                       | 用户 |
| GET  | `/_matrix/client/v3/sync`         | 同上                                                        | 同上                                                       | 用户 |
| GET  | `/_matrix/client/r0/events`       | 流水线查询参数                                              | 事件流结果                                                 | 用户 |
| GET  | `/_matrix/client/v3/events`       | 流水线查询参数                                              | 事件流结果                                                 | 用户 |
| GET  | `/_matrix/client/r0/joined_rooms` | 无                                                          | `joined_rooms`                                             | 用户 |
| GET  | `/_matrix/client/v3/joined_rooms` | 无                                                          | `joined_rooms`                                             | 用户 |
| GET  | `/_matrix/client/v3/my_rooms`     | 无                                                          | `rooms`                                                    | 用户 |

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
    - `rooms`: 房间同步容器，当前实现固定返回 `join` `invite` `leave`
    - `presence.events`: Presence 事件数组
    - `account_data.events`: 账户级 account data 数组
    - `to_device.events`: to-device 事件数组
    - `device_lists.changed`: 设备列表发生变化的用户 ID 数组
    - `device_lists.left`: 已离开视图范围的用户 ID 数组
    - `device_one_time_keys_count`: 当前实现返回空对象 `{}`，尚未细分算法计数
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
- `src/client-secure-backup-requests.ts` 中的 `getMyRoomsRequest()` 已绑定生成的 `SyncPathPattern`，默认走 `GET /_matrix/client/v3/my_rooms`。
- `src/client.ts` 中的 `slidingSync()` 已绑定生成的 `SlidingSyncPathPattern`，继续使用 `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync` 作为 SDK 主入口。
- `SyncManager.getJoinedRooms()` 复用 `MatrixClient.getJoinedRooms()`，不再是契约缺口。
- 传统 `GET /sync` 与 `GET /events` 的核心实现仍位于底层 `SyncApi`/`MatrixClient` 同步栈，本轮未改变行为，只完成稳定入口的显式契约绑定。

## 覆盖率口径

- **Ledger 契约端点数**: 8
- **SDK 主入口已绑定生成契约**: 8/8
- **契约覆盖率**: 100%

## 代码定位

- 路由声明: `synapse-rust/src/web/routes/sync.rs`
- Sliding Sync 路由: `synapse-rust/src/web/routes/sliding_sync.rs`
- 处理器: `synapse-rust/src/web/routes/handlers/sync.rs`
