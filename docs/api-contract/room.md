---
module: room
generated_from: docs/api-contract/generated/modules/room.json
generated_hash: sha256-8a7c30eae97355ca774d0d35c4fa10217451609d0f0c28e3fec8c13ffd441693
ledger_schema: 4
last_reviewed: 2026-05-11
---

# Room 模块契约

> 审查来源: `synapse-rust/synapse-web/src/routes/room.rs`、`handlers/search.rs`、`moderation.rs`、`typing.rs`
> 审计状态: ✅ `RoomManager` 已将当前已实现的房间主路径绑定到生成 `RoomPathPattern`

## 挂载版本

| 前缀                                            | 条数 | 说明                                                                                                             |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `/_matrix/client/v3`                            | 38   | 标准主链路（`createRoom`、`joined_rooms`、`send`、`messages`、`context` …）                                      |
| `/_matrix/vendor/v1`                            | 51   | **项目私有扩展**：`/my_rooms`、`capabilities`、`timeline`、`keys/*`、`notifications`、`metadata`、`fragments` 等 |
| `/_matrix/client/unstable/org.matrix.msc4354`   | 3    | 粘性事件（`sticky_events`）                                                                                      |
| `/_matrix/client/v1`                            | 2    | `m.room.power_levels` 兼容读写（带尾斜杠的学生模板）                                                             |
| `/_matrix/client/unstable/uk.half-shot.msc2666` | 1    | `user/mutual_rooms`（MSC2666 共同房间）                                                                          |

> **命名空间变更（2026-10-12 核对）**：本页旧版把 `/_matrix/client/r0` 列为「兼容主链路」，
> 并称扩展能力（通知、同步、密钥、粘性事件）挂在 `/_matrix/client/v3`。实测后端 ledger：
>
> - `/_matrix/client/r0/*` 房间路由**已全部退役**（0 条）；
> - 扩展能力已按 ISSUE-13 迁至 **`/_matrix/vendor/v1`**（51 条）；
> - 粘性事件已迁至 **`/_matrix/client/unstable/org.matrix.msc4354`**（MSC4354 unstable 命名空间）。
>
> 打旧地址会得到 404，故本表按 ledger 重写。逐条见 `generated/modules/room.json`。

## 认证与通用响应

- 本文件中的房间端点默认需要用户 access token。
- 常见错误码: `400` 参数错误、`401` 未认证、`403` 无权限、`404` 房间/事件不存在、`429` 限流、`M_UNRECOGNIZED` 当前未支持的已挂载占位接口。
- 常见成功响应:
    - 写操作返回空对象或 `{ "event_id": "..." }`
    - 查询操作返回事件、列表、统计信息或 service 组装后的 JSON 对象

## r0 / v3 共享主链路

| 方法         | 路径                                                                         | 主要请求参数                                                                                               | 主要响应字段                                                                |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}`                                    | `room_id`                                                                                                  | 房间基础信息                                                                |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/messages`                           | `from` `to?` `dir`（默认 `b`，其他值 400） `limit?`（默认 10，夹在 1..1000） `filter?`（不支持，非空 400） | `chunk` `start` `end` `state`；要求调用方为房间成员或管理员，越权返回 `403` |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/search`                             | 搜索条件                                                                                                   | 搜索结果                                                                    |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/membership/{user_id}`               | `user_id`                                                                                                  | 成员关系                                                                    |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/receipt/{receipt_type}/{event_id}`  | receipt 内容                                                                                               | 空对象                                                                      |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/receipts/{receipt_type}/{event_id}` | 路径参数                                                                                                   | receipt 列表                                                                |
| POST/PUT     | `/_matrix/client/{r0,v3}/rooms/{room_id}/read_markers`                       | read marker 内容                                                                                           | 空对象                                                                      |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/aliases`                            | `room_id`                                                                                                  | 房间别名列表                                                                |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/join`                               | 可选 join body                                                                                             | `room_id`                                                                   |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/leave`                              | 可选 reason                                                                                                | 空对象                                                                      |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/upgrade`                            | `new_version`                                                                                              | 新房间 ID                                                                   |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/forget`                             | 可选 body                                                                                                  | 空对象                                                                      |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/initialSync`                        | 查询参数                                                                                                   | 要求调用方已加入房间；返回基础房间快照                                      |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/members`                            | `membership?` 等                                                                                           | `chunk`                                                                     |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/members/recent`                     | 查询参数                                                                                                   | 最近成员                                                                    |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/joined_members`                     | 无                                                                                                         | `joined` 成员映射                                                           |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/version`                            | 无                                                                                                         | `room_version`                                                              |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/invite`                             | `user_id` `reason?`                                                                                        | 空对象                                                                      |
| GET          | `/_matrix/client/{r0,v3}/user/{user_id}/rooms`                               | `user_id`                                                                                                  | 用户房间列表                                                                |
| GET/PUT      | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/{state_key}`     | 状态事件内容                                                                                               | 状态事件；GET 要求调用方为房间成员或管理员，越权返回 `403`                  |
| GET/PUT      | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/`                | 空 state key                                                                                               | 状态事件；GET 要求调用方为房间成员或管理员，越权返回 `403`                  |
| GET/POST/PUT | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}`                 | 状态事件内容                                                                                               | 状态事件 / 空对象；GET 要求调用方为房间成员或管理员，越权返回 `403`         |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/state`                              | 无                                                                                                         | 房间状态快照；要求调用方为房间成员或管理员，越权返回 `403`                  |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/redact/{event_id}/{txn_id}`         | redaction body                                                                                             | `event_id`                                                                  |
| GET          | `/_matrix/client/{v1,v3}/rooms/{room_id}/hierarchy`                          | `limit?` `max_depth?` `suggested_only?` `from_token?`                                                      | 房间层级结构                                                                |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/kick`                               | `user_id` `reason?`                                                                                        | 空对象                                                                      |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/ban`                                | `user_id` `reason?`                                                                                        | 空对象                                                                      |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/unban`                              | `user_id` `reason?`                                                                                        | 空对象                                                                      |
| GET/POST     | `/_matrix/client/{r0,v3}/rooms/{room_id}/pinned_events`                      | POST 时提供事件信息                                                                                        | pinned events                                                               |
| DELETE       | `/_matrix/client/{r0,v3}/rooms/{room_id}/pinned_events/{event_id}`           | `event_id`                                                                                                 | 空对象                                                                      |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/send/{event_type}/{txn_id}`         | 事件内容                                                                                                   | `event_id`                                                                  |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/event/{event_id}`                   | `event_id`                                                                                                 | 单个事件                                                                    |
| GET          | `/_matrix/client/{v1,v3}/rooms/{room_id}/context/{event_id}`                 | `event_id` `limit?` `filter?`                                                                              | `event` `events_before` `events_after` `start` `end` `state`                |
| POST         | `/_matrix/client/v3/rooms/{room_id}/report`                                  | `reason` `score?`                                                                                          | 空对象                                                                      |
| POST         | `/_matrix/client/{r0,v1,v3}/rooms/{room_id}/report/{event_id}`               | `reason` `score?`                                                                                          | 空对象                                                                      |
| PUT          | `/_matrix/client/{r0,v1,v3}/rooms/{room_id}/report/{event_id}/score`         | `score`                                                                                                    | 空对象                                                                      |
| GET          | `/_matrix/vendor/v1/rooms/{room_id}/report/{event_id}/scanner_info`          | `event_id`                                                                                                 | scanner 信息                                                                |

## r0 专用

| 方法 | 路径                                                       | 说明                 |
| ---- | ---------------------------------------------------------- | -------------------- |
| POST | `/_matrix/client/v3/createRoom`                            | 创建房间             |
| POST | `/_matrix/vendor/v1/rooms/{room_id}/get_membership_events` | 获取 membership 事件 |

## v1 专用

| 方法 | 路径                                                            | 说明                   |
| ---- | --------------------------------------------------------------- | ---------------------- |
| GET  | `/_matrix/client/v1/rooms/{room_id}/state/m.room.power_levels/` | 兼容 power levels 读取 |
| GET  | `/_matrix/client/v1/rooms/{room_id}/timestamp_to_event`         | 以时间戳反查最近事件   |

## v3 扩展房间端点

| 方法     | 路径                                                                                     | 主要请求参数                       | 主要响应字段                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| POST     | `/_matrix/client/v3/createRoom`                                                          | 创建房间请求体                     | `room_id`                                                                                     |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/notifications`                                       | 分页查询参数                       | `notifications`                                                                               |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/capabilities`                                        | 无                                 | 房间能力                                                                                      |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/sync`                                                | 查询参数                           | 房间级同步结果                                                                                |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/timeline`                                            | 查询参数                           | 时间线                                                                                        |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/unread_count`                                        | 无                                 | 未读计数                                                                                      |
| GET/PUT  | `/_matrix/client/v3/rooms/{room_id}/typing/{user_id}`                                    | GET 无；PUT 为 `typing` `timeout?` | 用户 typing 状态 / 空对象；读写均要求调用方为房间成员或管理员，且 PUT 仅允许更新自己的 typing |
| GET      | `/_matrix/client/v3/rooms/{room_id}/typing`                                              | 无                                 | 房间内 typing 用户列表；要求调用方为房间成员或管理员                                          |
| POST     | `/_matrix/client/v3/rooms/typing`                                                        | `room_ids` 列表                    | 各房间 typing 状态映射；请求中的每个房间都要求调用方为房间成员或管理员                        |
| GET/PUT  | `/_matrix/client/v3/rooms/{room_id}/account_data/{type}`                                 | account data 内容                  | account data                                                                                  |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/turn_server`                                         | 无                                 | TURN 配置                                                                                     |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/metadata`                                            | 无                                 | 房间元数据                                                                                    |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/spaces`                                              | 无                                 | 所属 space 列表                                                                               |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/keys`                                                | 无                                 | 房间密钥                                                                                      |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/keys/count`                                          | 无                                 | 密钥计数                                                                                      |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/keys/version`                                        | 无                                 | 密钥版本                                                                                      |
| POST     | `/_matrix/vendor/v1/rooms/{room_id}/keys/claim`                                          | claim body                         | claim 结果                                                                                    |
| PUT      | `/_matrix/vendor/v1/rooms/{room_id}/room_keys/keys`                                      | 转发 room key                      | `count` `etag` `version`                                                                      |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/keys/{event_id}`                                     | `event_id`                         | 事件密钥                                                                                      |
| GET      | `/_matrix/vendor/v1/rooms/{room_id}/thread/{event_id}`                                   | `event_id`                         | 线程视图                                                                                      |
| POST     | `/_matrix/client/v3/join/{room_id_or_alias}`                                             | 可选 via 信息                      | `room_id`                                                                                     |
| POST     | `/_matrix/client/v3/knock/{room_id_or_alias}`                                            | knock 请求体                       | `room_id` / 空对象                                                                            |
| POST     | `/_matrix/client/v3/rooms/{room_id}/invite`                                              | `user_id`                          | 空对象                                                                                        |
| GET/POST | `/_matrix/vendor/v1/rooms/{room_id}/invite_blocklist`                                    | blocklist body                     | blocklist；GET 要求调用方为房间成员或管理员，POST 维持当前仅房间创建者可写                    |
| GET/POST | `/_matrix/vendor/v1/rooms/{room_id}/invite_allowlist`                                    | allowlist body                     | allowlist；GET 要求调用方为房间成员或管理员，POST 维持当前仅房间创建者可写                    |
| GET/POST | `/_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events`              | sticky event body                  | sticky events                                                                                 |
| DELETE   | `/_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events/{event_type}` | `event_type`                       | 空对象                                                                                        |

### 关键扩展响应字段

- `GET /_matrix/vendor/v1/rooms/{room_id}/capabilities` 顶层字段为 `room_id`、`room_version`、`capabilities`、`features`、`join_rule`
- `GET /_matrix/vendor/v1/rooms/{room_id}/notifications` 顶层字段为 `notifications`、`next_token`；列表项稳定字段为 `event_id`、`room_id`、`ts`、`notification_type`、`is_read`、`sender`、`content`、`client_action`
- 其中 `capabilities` 当前稳定字段为 `knock`、`restricted`、`threading`、`read_receipts`、`typing_notifications`
- 其中 `features` 当前稳定字段为 `encryption`、`federation`、`guest_access`
- `GET /_matrix/vendor/v1/rooms/{room_id}/unread_count` 顶层字段为 `notification_count`、`highlight_count`
- `GET /_matrix/vendor/v1/rooms/{room_id}/metadata` 顶层字段为 `room_id`、`name?`、`topic?`、`avatar_url?`、`canonical_alias?`、`join_rule?`、`history_visibility?`、`creator?`、`room_version?`、`encryption?`、`is_public?`、`member_count?`、`created_ts?`
- `GET /_matrix/client/{r0,v3}/rooms/{room_id}/messages` 与 `GET /_matrix/client/{r0,v3}/rooms/{room_id}/state*` 现已统一要求调用方为房间成员或管理员，避免跨房间直接读取时间线与状态快照
- `typing` 相关端点现已统一要求调用方具备对应房间访问权，避免通过已知 `room_id` 直接探测他房输入状态
- `invite_blocklist` / `invite_allowlist` 的 GET 路由现已要求调用方具备对应房间访问权，避免跨房间探测邀请限制名单

## `initialSync` 与扩展路由现状

- `GET /_matrix/client/{r0,v3}/rooms/{room_id}/initialSync` 现已提供最小兼容实现，要求调用方已加入房间；响应包含 `room_id`、`membership`、`visibility`、`state`、`members`、`messages`、`pagination_chunk`、`presence`、`receipts`、`account_data` 等基础字段。
- 下列扩展接口在后端 `room` 路由树中仍然挂载，属于当前 Ledger 契约范围；SDK 侧是否封装需以模块实现与单测为准，不应按“已移除/404”口径统计。
- `/_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities` 实际由 `widget.rs` 挂载，因此不计入“已挂载但未支持”列表。

| 方法 | 路径                                                      | 当前状态                              |
| ---- | --------------------------------------------------------- | ------------------------------------- |
| GET  | `/_matrix/client/{r0,v3}/rooms/{room_id}/initialSync`     | 已实现，返回基础房间快照              |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/fragments/{user_id}`  | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/service_types`        | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/event_perspective`    | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/reduced_events`       | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/rendered/`            | 后端已挂载，SDK 已封装（RoomSummary） |
| POST | `/_matrix/vendor/v1/rooms/{room_id}/translate/{event_id}` | 后端已挂载，SDK 已封装（RoomSummary） |
| POST | `/_matrix/vendor/v1/rooms/{room_id}/convert/{event_id}`   | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/vault_data`           | 后端已挂载，SDK 已封装（RoomSummary） |
| PUT  | `/_matrix/vendor/v1/rooms/{room_id}/vault_data`           | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/external_ids`         | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/device/{device_id}`   | 后端已挂载，SDK 已封装（RoomSummary） |

## 典型请求/响应

- 创建房间: `POST /_matrix/client/{r0,v3}/createRoom`，请求体常见字段为 `name` `topic` `invite` `initial_state`，成功返回 `{ "room_id": "..." }`
- 发送消息: `PUT /rooms/{room_id}/send/{event_type}/{txn_id}`，请求体为事件 `content`，成功返回 `{ "event_id": "..." }`
- 拉取消息: `GET /rooms/{room_id}/messages`，`dir` 缺省为 `b`（其他取值 400 `M_INVALID_PARAM`，不静默回退）；`limit` 缺省 10、夹在 1..1000；`filter` 不被支持，非空即 400 `M_INVALID_PARAM`。响应为 `{chunk, start, end, state}`，要求调用方为房间成员或管理员
- 成员管理: `invite` `kick` `ban` `unban` 统一返回空对象

## SDK 对齐结论

- `src/room/RoomManager.ts` 现已将当前 manager 直接封装的房间主路径绑定到生成的 `RoomPathPattern`。
- 已绑定的核心入口包括 `createRoom()`、`joinRoom()`、`knockRoom()`、`leave()`、`forget()`、`getRoomVersion()`、
  `getRoomCapabilities()`、`getRoomMetadata()`、`getMembers()`、`getJoinedMembers()`、`getMembership()`、
  `invite()`、`inviteByThreePid()`、`kick()`、`ban()`、`unban()`、`getEvent()`、`getEventContext()`、
  `redactEvent()`、`getLocalAliases()`、`getRoomHierarchy()`、`upgradeRoom()`、`reportRoom()`、`roomInitialSync()`。
- `state`、`messages`、`search`、`receipt`、`tags`、`directory` 等其余房间能力仍由其它 manager / client helper 承担；它们不再构成 `room` 模块主链路的人工封装缺口。
- 运行时默认前缀策略保持不变，本轮只做路径模板绑定与测试回归，不改变 `RoomManager` 的现有行为语义。

## 覆盖率口径

- **Ledger 契约端点数**: 132（以 `docs/api-contract/generated/modules/room.json` 的 `entry_count` 为准）
- **覆盖统计口径**: 以“后端已挂载路由 + SDK 已实现并可调用封装 + 单测可回归”计入，不以 route-table 声明或历史人工结论直接视为已覆盖
- **本轮人工复核结论**: `RoomManager` 主链路稳定；`RoomSummary`/`InviteBlocklist`/`StickyEvent` 等扩展链路与本轮新增 `permissions`、`resolve`、`message_queue`、`service_types`、`reduced_events`、`rendered`、`fragments`、`device`、`event_url`、`account_data`、`invites`、`keys_claim`、`keys_count`、`keys_version`、`members_recent`、`receipts`、`room_keys_forward`、`search`、`power_levels`、`translate`、`convert`、`sign`、`verify` 均已封装并有对应单测回归
- **契约覆盖率**: 按当前路由清单复核为 **132/132（100%）**

## 代码定位

- 路由声明: `synapse-rust/synapse-web/src/routes/room.rs`
- 处理器主体: `synapse-rust/synapse-web/src/routes/handlers/room/mod.rs`
- 搜索/上下文补充路由: `synapse-rust/synapse-web/src/routes/handlers/search/mod.rs`
- 举报补充路由: `synapse-rust/synapse-web/src/routes/moderation.rs`
- Typing 补充路由: `synapse-rust/synapse-web/src/routes/typing.rs`

## DTO Definitions

> Source: `src/room/__generated__/dto.ts`

```typescript
export interface RoomEvent {
    content: IContent;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: Record<string, unknown>;
}
export interface RoomStateEvent extends RoomEvent {
    state_key: string;
    prev_content?: IContent;
}
export interface RoomVersionResponse {
    room_version: string;
}
export interface RoomCapabilitiesResponse {
    capabilities: Record<string, unknown>;
}
export interface RoomMetadataResponse {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    history_visibility?: string;
    guest_access?: string;
    created_ts?: number;
}
export interface CreateRoomRequest {
    visibility?: "public" | "private";
    room_alias_name?: string;
    name?: string;
    topic?: string;
    room_version?: string;
    power_level_content_override?: IContent;
    preset?: "private_chat" | "trusted_private_chat" | "public_chat";
    initial_state?: Array<{ type: string; state_key?: string; content: IContent }>;
    invite?: string[];
    invite_3pid?: Array<{ id_server: string; id_access_token: string; medium: string; address: string }>;
    creation_content?: IContent;
    is_direct?: boolean;
    predecessor?: { room_id: string; event_id: string };
    space?: string;
}
export interface CreateRoomResponse {
    room_id: string;
}
export interface JoinRoomRequest {
    third_party_signed?: {
        sender: string;
        mixid: string;
        signed: { mxid: string; signatures: Record<string, Record<string, string>>; token: string };
    };
}
export interface JoinRoomResponse {
    room_id: string;
}
export interface KnockRoomRequest {
    reason?: string;
}
export interface KnockRoomResponse {
    room_id: string;
}
export interface RoomMember {
    display_name?: string;
    avatar_url?: string;
}
export interface GetMembersResponse {
    chunk: RoomStateEvent[];
}
export interface JoinedMembersResponse {
    joined: Record<string, RoomMember>;
}
export interface GetMessagesResponse {
    chunk: RoomEvent[];
    start: string;
    end?: string;
    state?: RoomStateEvent[];
}
export interface SendEventResponse {
    event_id: string;
    room_id?: string;
}
export interface EventContextResponse {
    event: RoomEvent;
    events_before: RoomEvent[];
    events_after: RoomEvent[];
    start: string;
    end: string;
    state: RoomStateEvent[];
}
export interface InviteRequest {
    user_id: string;
    reason?: string;
}
export interface KickRequest {
    user_id: string;
    reason?: string;
}
export interface BanRequest {
    user_id: string;
    reason?: string;
}
export interface UnbanRequest {
    user_id: string;
}
export interface RedactEventRequest {
    reason?: string;
}
export interface UpgradeRoomRequest {
    new_version: string;
    additional_creators?: string[];
}
export interface UpgradeRoomResponse {
    replacement_room: string;
}
export interface ReportRoomRequest {
    reason: string;
}
export interface RoomDirectoryVisibilityResponse {
    visibility: "public" | "private";
}
export interface SetRoomDirectoryVisibilityRequest {
    visibility: "public" | "private";
}
export interface RoomIdForAliasResponse {
    room_id: string;
    servers: string[];
}
export interface CreateAliasRequest {
    room_id: string;
}
export interface LocalAliasesResponse {
    aliases: string[];
}
export interface RoomHierarchyRoom {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    room_type?: string;
    num_joined_members?: number;
    children_state?: RoomStateEvent[];
}
export interface RoomHierarchyResponse {
    rooms: RoomHierarchyRoom[];
    next_batch?: string;
}
export interface TagMetadata {
    order?: number;
}
export interface TagsResponse {
    tags: Record<string, TagMetadata>;
}
export interface GuestAccessRequest {
    guest_access: "can_join" | "forbidden";
}
```

## 实现口径补充（2026-10-17 后端契约回灌）

> 依据：`synapse-rust/docs/sdk/rooms.md`、`messages.md` 与 `docs/api-contract/generated/modules/room.json`。
> 本节只补充口径，不覆盖上文既有路由表行、端点计数与覆盖率数字。

### 路由归属修正（5 组实际在 vendor）

上文路由表中以下 5 组路径按 `{r0,v3}` 书写，实际注册在 `/_matrix/vendor/v1`，按旧地址调用会 404：

- 房间内搜索：`POST /_matrix/vendor/v1/rooms/{room_id}/search`（不是 `/_matrix/client/{r0,v3}/rooms/{room_id}/search`）。
- 单人成员状态：`GET /_matrix/vendor/v1/rooms/{room_id}/membership/{user_id}`。
- 读取回执：`GET /_matrix/vendor/v1/rooms/{room_id}/receipts/{receipt_type}/{event_id}`（发送回执仍是 v3 的 `POST /rooms/{room_id}/receipt/{receipt_type}/{event_id}`，注意单复数不同）。
- 最近成员：`GET /_matrix/vendor/v1/rooms/{room_id}/members/recent`。
- 置顶事件：`GET|POST /_matrix/vendor/v1/rooms/{room_id}/pinned_events`、`DELETE /_matrix/vendor/v1/rooms/{room_id}/pinned_events/{event_id}`。

以 `generated/modules/room.json` 的登记路径为准；上表路径列保持原样不改。

### `GET /messages`

- `from` 必填，取上次响应的 `start` / `end` 或 `/sync` 的 `prev_batch`；`to` 可选。
- `dir` 缺省为 `b`（向后），仅接受 `f` / `b`；其他取值返回 400 `M_INVALID_PARAM`，不会静默回退。
- `limit` 缺省 10，夹在 `1..=1000`。
- `filter` **不被支持**：非空值即 400 `M_INVALID_PARAM`；懒加载成员属于 `/sync?filter=` 的能力。
- 响应固定为 `{chunk, start, end, state}`；`chunk` 内消息事件**不带 `unsigned`**（sticky TTL、`age`、`transaction_id` 均需逐条走 `GET /rooms/{room_id}/event/{event_id}` 读取）。
- `dir=b` 且本地返回不足 `limit` 时，服务端会异步向联邦节点回填更早事件；客户端不要因“没拿满”立即重复请求。

### `GET /context`

- 路径同时存在 `v3` 与 `v1`：`/_matrix/client/v3/rooms/{room_id}/context/{event_id}`、`/_matrix/client/v1/rooms/{room_id}/context/{event_id}`。
- 查询参数 `limit` 控制前后各取多少条。
- 响应为 `{event, events_before, events_after, start, end, state}`，`event` 为单个事件对象，其余为数组。

### `GET /members` 与 `joined_members`

- `at`: MSC4502 分页游标，取上次响应的 `next_batch`。
- `limit`: 缺省 100，夹在 `1..=1000`。
- `membership` / `not_membership`: 取值 `join` / `invite` / `leave` / `ban` / `knock`。
- 响应为 `{chunk: [m.room.member 事件], next_batch?}`；非成员访问私有房间的成员列表返回 403 `M_FORBIDDEN`。
- `GET /rooms/{room_id}/joined_members` 返回 `{joined: {"@u:x": {display_name, avatar_url}}}`。

### 状态事件

- `GET /rooms/{room_id}/state` 返回的是对象 `{"events": [...]}`，**不是裸数组**；客户端应写 `const events = res.events ?? res;`。
- `GET /rooms/{room_id}/state?type={event_type}` 为 MSC4497 精确类型过滤。
- `GET /rooms/{room_id}/state/{event_type}`、`.../{event_type}/`、`.../{event_type}/{state_key}` 只返回该事件的 **content**，不含 `event_id` / `type`；指定 `state_key` 不存在时返回 404 `M_NOT_FOUND`。
- 写入支持 `PUT` 与 `POST`，响应 `{event_id}`；写路径与 `/send` 一样接受 `org.matrix.msc4354.sticky_duration_ms` / 短名 `sticky_duration_ms`，取值必须为 `1..=3600000`，越界或非整数返回 400 `M_INVALID_PARAM`。
- `m.room.join_rules` 的 `allow` 是**对象数组**（`{type, room_id}`），不是字符串数组。

### 发送、编辑与撤回

- 发送：`PUT|POST /_matrix/client/v3/rooms/{room_id}/send/{event_type}/{txn_id}`，成功返回 `{event_id}`，不是 `{status, data}`。
- `txn_id` 幂等键为 `(user, device, txn_id, event_type)`：同设备同会话重放返回同一 `event_id`；换设备重发会真的产生第二条。
- 编辑不是 `PATCH`，而是再发一条普通 `m.room.message`，带 `m.relates_to: {rel_type: "m.replace", event_id}` 与 `m.new_content`。
- 撤回：`PUT|POST /_matrix/client/v3/rooms/{room_id}/redact/{event_id}/{txn_id}`，`txn_id` **必须存在**；不存在 `txn_id` 的 `PUT /rooms/{room_id}/redact/{event_id}` 会路由不匹配（404），不是“服务端自动生成”。
- 撤回请求体为 `{reason?}`，响应 `{event_id}`（撤回事件本身的 ID）；被撤回事件的 `content` 被清空，`unsigned.redacted_because` 给出撤回事件。
- `/send` 与 `/state` 写路径还接受查询参数 `org.matrix.msc4140.delay`（延迟发送）与 `org.matrix.msc4354.sticky_duration_ms`（sticky 时长）；带 `delay` 时响应是延迟事件对象（含 `delay_id`），不是 `{event_id}`。

### `createRoom`

- `POST /_matrix/client/v3/createRoom`；`room_version` 缺省取 `capabilities.m.room_versions.default`（当前为 `"12"`）。
- `invite` 最多 100 个，超出返回 400 `M_BAD_JSON`（`Too many invites (max 100)`）。
- `preset` 仅接受 `private_chat` / `trusted_private_chat` / `public_chat`，非法返回 400 `M_INVALID_PARAM`。
- `creation_content` **直接就是** `m.room.create` 的 content，不是 `{type, state_key, content}` 三层结构。
- 房间类型可用 `room_type`（如 `"m.space"`），也可写在 `creation_content.type`。
- `room_version` 不支持返回 400 `M_UNSUPPORTED_ROOM_VERSION`；与默认不兼容返回 400 `M_INCOMPATIBLE_ROOM_VERSION`；别名占用返回 400 `M_ROOM_IN_USE`。

### 离开与遗忘

- `POST /_matrix/client/v3/rooms/{room_id}/leave`，`forget` 在**请求体**：`{"forget": true}`（MSC4267，能力 `m.forget_forced_upon_leave`）。
- `forget=true` 时服务端在同一事务内完成 leave + forget，事后单独调 `/forget` 不会与它竞争。
- 房间不存在返回 404 `M_NOT_FOUND`；被 ban、需要邀请或敲门返回 403 `M_FORBIDDEN`。

### 房间信息

- `GET /_matrix/client/v3/rooms/{room_id}` **要求调用者为房间成员**；非成员返回 **404 `M_NOT_FOUND`**（`Room not found or not a member`），不是 403。
- 响应字段包含 `room_id`、`name`、`avatar_url`、`topic`、`canonical_alias`、`joined_members_count`、`invited_members_count`、`world_readable`、`guest_can_join`、`membership`。
- `GET /rooms/{room_id}/aliases` 返回 `{aliases: [...]}`；`GET /rooms/{room_id}/initialSync` 仅为兼容保留。

### 回执与 typing

- 发送回执：`POST /rooms/{room_id}/receipt/{receipt_type}/{event_id}`，`receipt_type` 白名单只有 `m.read` 与 `m.read.private`；传 `m.fully_read` 返回 400 `M_INVALID_PARAM`。
- 已读书签必须走 `POST|PUT /rooms/{room_id}/read_markers`，请求体可含 `m.read` / `m.read.private` / `m.fully_read`。
- 回执的 `event_id` 必须是房间内真实存在的事件，否则 404 `M_NOT_FOUND`；回执经 `/sync` 的房间 `ephemeral.events` 中的 `m.receipt` 下发，不产生 timeline 事件。
- typing：`PUT|POST /rooms/{room_id}/typing/{user_id}`，`user_id` 必须是本人，否则 403 `M_FORBIDDEN`；`timeout` 缺省 30000ms，超时后服务端自动清除，停止输入应显式发 `{"typing": false}`。
- typing 状态**不落 timeline**，只在 `/sync` 的 `ephemeral` 中出现。
- `GET /rooms/{room_id}/typing`、`POST /rooms/typing` 均要求调用方具备对应房间访问权。

### 路由归属与覆盖率口径

- `docs/api-contract/generated/modules/room.json` 当前 `entry_count` 为 **95**；本页“132”是历史人工复核口径，不能当作当前 ledger 条目数。
- 页面审计来源中的 `handlers/search.rs`、`moderation.rs`、`typing.rs` 属于跨文件挂载：房间内搜索、举报、typing 的路径虽由这些文件注册，但仍归 `room` 模块路由树统计。
- 覆盖率数字维持上文原样；复核时以 `room.json` 的登记条目与 `RoomPathPattern` 绑定关系为准，不以历史结论直接视为已覆盖。
