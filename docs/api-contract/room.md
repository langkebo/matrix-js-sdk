---
module: room
generated_from: docs/api-contract/generated/modules/room.json
generated_hash: sha256-d3a2ccc49e98cb8df73e43880c7a7cf0ef31ac76de458353abb6c5a7c28ede09
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Room 模块契约

> 审查来源: `synapse-rust/src/web/routes/room.rs`、`handlers/search.rs`、`moderation.rs`、`typing.rs`
> 审计状态: ✅ `RoomManager` 已将当前已实现的房间主路径绑定到生成 `RoomPathPattern`

## 挂载版本

| 前缀                 | 说明                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `/_matrix/client/r0` | 兼容主链路 + `createRoom` + `get_membership_events` + 事件举报                                     |
| `/_matrix/client/v1` | `m.room.power_levels` 兼容读取 + `context` `hierarchy` `timestamp_to_event` + 事件举报相关房间路由 |
| `/_matrix/client/v3` | 兼容主链路 + `context` `hierarchy` + typing + 扩展房间能力、通知、同步、密钥、粘性事件等           |

## 认证与通用响应

- 本文件中的房间端点默认需要用户 access token。
- 常见错误码: `400` 参数错误、`401` 未认证、`403` 无权限、`404` 房间/事件不存在、`429` 限流、`M_UNRECOGNIZED` 当前未支持的已挂载占位接口。
- 常见成功响应:
    - 写操作返回空对象或 `{ "event_id": "..." }`
    - 查询操作返回事件、列表、统计信息或 service 组装后的 JSON 对象

## r0 / v3 共享主链路

| 方法         | 路径                                                                         | 主要请求参数                                          | 主要响应字段                                                        |
| ------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}`                                    | `room_id`                                             | 房间基础信息                                                        |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/messages`                           | `from` `to?` `dir` `limit?` `filter?`                 | `chunk` `start` `end`；要求调用方为房间成员或管理员，越权返回 `403` |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/search`                             | 搜索条件                                              | 搜索结果                                                            |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/membership/{user_id}`               | `user_id`                                             | 成员关系                                                            |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/receipt/{receipt_type}/{event_id}`  | receipt 内容                                          | 空对象                                                              |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/receipts/{receipt_type}/{event_id}` | 路径参数                                              | receipt 列表                                                        |
| POST/PUT     | `/_matrix/client/{r0,v3}/rooms/{room_id}/read_markers`                       | read marker 内容                                      | 空对象                                                              |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/aliases`                            | `room_id`                                             | 房间别名列表                                                        |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/join`                               | 可选 join body                                        | `room_id`                                                           |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/leave`                              | 可选 reason                                           | 空对象                                                              |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/upgrade`                            | `new_version`                                         | 新房间 ID                                                           |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/forget`                             | 可选 body                                             | 空对象                                                              |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/initialSync`                        | 查询参数                                              | 要求调用方已加入房间；返回基础房间快照                              |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/members`                            | `membership?` 等                                      | `chunk`                                                             |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/members/recent`                     | 查询参数                                              | 最近成员                                                            |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/joined_members`                     | 无                                                    | `joined` 成员映射                                                   |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/version`                            | 无                                                    | `room_version`                                                      |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/invite`                             | `user_id` `reason?`                                   | 空对象                                                              |
| GET          | `/_matrix/client/{r0,v3}/user/{user_id}/rooms`                               | `user_id`                                             | 用户房间列表                                                        |
| GET/PUT      | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/{state_key}`     | 状态事件内容                                          | 状态事件；GET 要求调用方为房间成员或管理员，越权返回 `403`          |
| GET/PUT      | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/`                | 空 state key                                          | 状态事件；GET 要求调用方为房间成员或管理员，越权返回 `403`          |
| GET/POST/PUT | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}`                 | 状态事件内容                                          | 状态事件 / 空对象；GET 要求调用方为房间成员或管理员，越权返回 `403` |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/state`                              | 无                                                    | 房间状态快照；要求调用方为房间成员或管理员，越权返回 `403`          |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/redact/{event_id}/{txn_id}`         | redaction body                                        | `event_id`                                                          |
| GET          | `/_matrix/client/{v1,v3}/rooms/{room_id}/hierarchy`                          | `limit?` `max_depth?` `suggested_only?` `from_token?` | 房间层级结构                                                        |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/kick`                               | `user_id` `reason?`                                   | 空对象                                                              |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/ban`                                | `user_id` `reason?`                                   | 空对象                                                              |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/unban`                              | `user_id` `reason?`                                   | 空对象                                                              |
| GET/POST     | `/_matrix/client/{r0,v3}/rooms/{room_id}/pinned_events`                      | POST 时提供事件信息                                   | pinned events                                                       |
| DELETE       | `/_matrix/client/{r0,v3}/rooms/{room_id}/pinned_events/{event_id}`           | `event_id`                                            | 空对象                                                              |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/send/{event_type}/{txn_id}`         | 事件内容                                              | `event_id`                                                          |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/event/{event_id}`                   | `event_id`                                            | 单个事件                                                            |
| GET          | `/_matrix/client/{v1,v3}/rooms/{room_id}/context/{event_id}`                 | `event_id` `limit?` `filter?`                         | `event` `events_before` `events_after` `start` `end` `state`        |
| POST         | `/_matrix/client/v3/rooms/{room_id}/report`                                  | `reason` `score?`                                     | 空对象                                                              |
| POST         | `/_matrix/client/{r0,v1,v3}/rooms/{room_id}/report/{event_id}`               | `reason` `score?`                                     | 空对象                                                              |
| PUT          | `/_matrix/client/{r0,v1,v3}/rooms/{room_id}/report/{event_id}/score`         | `score`                                               | 空对象                                                              |
| GET          | `/_matrix/client/v1/rooms/{room_id}/report/{event_id}/scanner_info`          | `event_id`                                            | scanner 信息                                                        |

## r0 专用

| 方法 | 路径                                                       | 说明                 |
| ---- | ---------------------------------------------------------- | -------------------- |
| POST | `/_matrix/client/r0/createRoom`                            | 创建房间             |
| POST | `/_matrix/client/r0/rooms/{room_id}/get_membership_events` | 获取 membership 事件 |

## v1 专用

| 方法 | 路径                                                            | 说明                   |
| ---- | --------------------------------------------------------------- | ---------------------- |
| GET  | `/_matrix/client/v1/rooms/{room_id}/state/m.room.power_levels/` | 兼容 power levels 读取 |
| GET  | `/_matrix/client/v1/rooms/{room_id}/timestamp_to_event`         | 以时间戳反查最近事件   |

## v3 扩展房间端点

| 方法     | 路径                                                            | 主要请求参数                       | 主要响应字段                                                                                  |
| -------- | --------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| POST     | `/_matrix/client/v3/createRoom`                                 | 创建房间请求体                     | `room_id`                                                                                     |
| GET      | `/_matrix/client/v3/rooms/{room_id}/notifications`              | 分页查询参数                       | `notifications`                                                                               |
| GET      | `/_matrix/client/v3/rooms/{room_id}/capabilities`               | 无                                 | 房间能力                                                                                      |
| GET      | `/_matrix/client/v3/rooms/{room_id}/sync`                       | 查询参数                           | 房间级同步结果                                                                                |
| GET      | `/_matrix/client/v3/rooms/{room_id}/timeline`                   | 查询参数                           | 时间线                                                                                        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/unread_count`               | 无                                 | 未读计数                                                                                      |
| GET/PUT  | `/_matrix/client/v3/rooms/{room_id}/typing/{user_id}`           | GET 无；PUT 为 `typing` `timeout?` | 用户 typing 状态 / 空对象；读写均要求调用方为房间成员或管理员，且 PUT 仅允许更新自己的 typing |
| GET      | `/_matrix/client/v3/rooms/{room_id}/typing`                     | 无                                 | 房间内 typing 用户列表；要求调用方为房间成员或管理员                                          |
| POST     | `/_matrix/client/v3/rooms/typing`                               | `room_ids` 列表                    | 各房间 typing 状态映射；请求中的每个房间都要求调用方为房间成员或管理员                        |
| GET/PUT  | `/_matrix/client/v3/rooms/{room_id}/account_data/{type}`        | account data 内容                  | account data                                                                                  |
| GET      | `/_matrix/client/v3/rooms/{room_id}/turn_server`                | 无                                 | TURN 配置                                                                                     |
| GET      | `/_matrix/client/v3/rooms/{room_id}/metadata`                   | 无                                 | 房间元数据                                                                                    |
| GET      | `/_matrix/client/v3/rooms/{room_id}/spaces`                     | 无                                 | 所属 space 列表                                                                               |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys`                       | 无                                 | 房间密钥                                                                                      |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys/count`                 | 无                                 | 密钥计数                                                                                      |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys/version`               | 无                                 | 密钥版本                                                                                      |
| POST     | `/_matrix/client/v3/rooms/{room_id}/keys/claim`                 | claim body                         | claim 结果                                                                                    |
| PUT      | `/_matrix/client/v3/rooms/{room_id}/room_keys/keys`             | 转发 room key                      | `count` `etag` `version`                                                                      |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys/{event_id}`            | `event_id`                         | 事件密钥                                                                                      |
| GET      | `/_matrix/client/v3/rooms/{room_id}/thread/{event_id}`          | `event_id`                         | 线程视图                                                                                      |
| POST     | `/_matrix/client/v3/join/{room_id_or_alias}`                    | 可选 via 信息                      | `room_id`                                                                                     |
| POST     | `/_matrix/client/v3/knock/{room_id_or_alias}`                   | knock 请求体                       | `room_id` / 空对象                                                                            |
| POST     | `/_matrix/client/v3/invite/{room_id}`                           | `user_id`                          | 空对象                                                                                        |
| GET/POST | `/_matrix/client/v3/rooms/{room_id}/invite_blocklist`           | blocklist body                     | blocklist；GET 要求调用方为房间成员或管理员，POST 维持当前仅房间创建者可写                    |
| GET/POST | `/_matrix/client/v3/rooms/{room_id}/invite_allowlist`           | allowlist body                     | allowlist；GET 要求调用方为房间成员或管理员，POST 维持当前仅房间创建者可写                    |
| GET/POST | `/_matrix/client/v3/rooms/{room_id}/sticky_events`              | sticky event body                  | sticky events                                                                                 |
| DELETE   | `/_matrix/client/v3/rooms/{room_id}/sticky_events/{event_type}` | `event_type`                       | 空对象                                                                                        |

### 关键扩展响应字段

- `GET /_matrix/client/v3/rooms/{room_id}/capabilities` 顶层字段为 `room_id`、`room_version`、`capabilities`、`features`、`join_rule`
- `GET /_matrix/client/v3/rooms/{room_id}/notifications` 顶层字段为 `notifications`、`next_token`；列表项稳定字段为 `event_id`、`room_id`、`ts`、`notification_type`、`is_read`、`sender`、`content`、`client_action`
- 其中 `capabilities` 当前稳定字段为 `knock`、`restricted`、`threading`、`read_receipts`、`typing_notifications`
- 其中 `features` 当前稳定字段为 `encryption`、`federation`、`guest_access`
- `GET /_matrix/client/v3/rooms/{room_id}/unread_count` 顶层字段为 `notification_count`、`highlight_count`
- `GET /_matrix/client/v3/rooms/{room_id}/metadata` 顶层字段为 `room_id`、`name?`、`topic?`、`avatar_url?`、`canonical_alias?`、`join_rule?`、`history_visibility?`、`creator?`、`room_version?`、`encryption?`、`is_public?`、`member_count?`、`created_ts?`
- `GET /_matrix/client/{r0,v3}/rooms/{room_id}/messages` 与 `GET /_matrix/client/{r0,v3}/rooms/{room_id}/state*` 现已统一要求调用方为房间成员或管理员，避免跨房间直接读取时间线与状态快照
- `typing` 相关端点现已统一要求调用方具备对应房间访问权，避免通过已知 `room_id` 直接探测他房输入状态
- `invite_blocklist` / `invite_allowlist` 的 GET 路由现已要求调用方具备对应房间访问权，避免跨房间探测邀请限制名单

## `initialSync` 与扩展路由现状

- `GET /_matrix/client/{r0,v3}/rooms/{room_id}/initialSync` 现已提供最小兼容实现，要求调用方已加入房间；响应包含 `room_id`、`membership`、`visibility`、`state`、`members`、`messages`、`pagination_chunk`、`presence`、`receipts`、`account_data` 等基础字段。
- 下列扩展接口在后端 `room` 路由树中仍然挂载，属于当前 Ledger 契约范围；SDK 侧是否封装需以模块实现与单测为准，不应按“已移除/404”口径统计。
- `/_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities` 与 `/_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/send` 实际由 `widget.rs` 挂载，且当前实现可用，因此不计入“已挂载但未支持”列表。

| 方法 | 路径                                                      | 当前状态                              |
| ---- | --------------------------------------------------------- | ------------------------------------- |
| GET  | `/_matrix/client/{r0,v3}/rooms/{room_id}/initialSync`     | 已实现，返回基础房间快照              |
| GET  | `/_matrix/client/v3/rooms/{room_id}/fragments/{user_id}`  | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/client/v3/rooms/{room_id}/service_types`        | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/client/v3/rooms/{room_id}/event_perspective`    | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/client/v3/rooms/{room_id}/reduced_events`       | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/client/v3/rooms/{room_id}/rendered/`            | 后端已挂载，SDK 已封装（RoomSummary） |
| POST | `/_matrix/client/v3/rooms/{room_id}/translate/{event_id}` | 后端已挂载，SDK 已封装（RoomSummary） |
| POST | `/_matrix/client/v3/rooms/{room_id}/convert/{event_id}`   | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/client/v3/rooms/{room_id}/vault_data`           | 后端已挂载，SDK 已封装（RoomSummary） |
| PUT  | `/_matrix/client/v3/rooms/{room_id}/vault_data`           | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/client/v3/rooms/{room_id}/external_ids`         | 后端已挂载，SDK 已封装（RoomSummary） |
| GET  | `/_matrix/client/v3/rooms/{room_id}/device/{device_id}`   | 后端已挂载，SDK 已封装（RoomSummary） |

## 典型请求/响应

- 创建房间: `POST /_matrix/client/{r0,v3}/createRoom`，请求体常见字段为 `name` `topic` `invite` `initial_state`，成功返回 `{ "room_id": "..." }`
- 发送消息: `PUT /rooms/{room_id}/send/{event_type}/{txn_id}`，请求体为事件 `content`，成功返回 `{ "event_id": "..." }`
- 拉取消息: `GET /rooms/{room_id}/messages`，核心查询参数为 `from` `dir` `limit?`，返回 `chunk/start/end`，并要求调用方为房间成员或管理员
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

- 路由声明: `synapse-rust/src/web/routes/room.rs`
- 处理器主体: `synapse-rust/src/web/routes/handlers/room.rs`
- 搜索/上下文补充路由: `synapse-rust/src/web/routes/handlers/search.rs`
- 举报补充路由: `synapse-rust/src/web/routes/moderation.rs`
- Typing 补充路由: `synapse-rust/src/web/routes/typing.rs`

## DTO Definitions

> Source: `src/room/__generated__/dto.ts`

```typescript
export interface RoomEvent {
    content: Record<string, unknown>;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: Record<string, unknown>;
}
export interface RoomStateEvent extends RoomEvent {
    state_key: string;
    prev_content?: Record<string, unknown>;
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
    power_level_content_override?: Record<string, unknown>;
    preset?: "private_chat" | "trusted_private_chat" | "public_chat";
    initial_state?: Array<{ type: string; state_key?: string; content: Record<string, unknown> }>;
    invite?: string[];
    invite_3pid?: Array<{ id_server: string; id_access_token: string; medium: string; address: string }>;
    creation_content?: Record<string, unknown>;
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
