# API 契约变更日志

## 2026-04-27

### 契约索引与模块归属修正

- 修正 `README.md` 索引，补入 `worker-admin.md`
- 修正 `README.md` 中 `account-data.md` 的覆盖说明，明确同时覆盖 `account_data.rs` 与 `tags.rs`
- 修正 `README.md` 中 `space.md` 的覆盖说明，明确同时覆盖 `space.rs` 与 `space/*` 子模块

### Space 契约重审

- 重写 `space.md` 的审查来源，补齐 `lifecycle_query.rs`、`children_hierarchy.rs`、`membership_state.rs`、`summary.rs`、`types.rs`
- 修正 space 模块认证边界，区分公开可见读接口、私有 space 的 `401/403` 分流，以及写接口必须认证的真实行为
- 修正多个端点的实际返回体，确认 `POST /spaces/{space_id}/children` 与 `POST /spaces/{space_id}/invite` 返回 `201 + DTO`，`POST /spaces/{space_id}/join` 返回 `200 + SpaceMemberResponse`，删除类接口返回 `204`
- 明确 `GET /spaces/{space_id}/hierarchy` 与 `GET /spaces/{space_id}/hierarchy/v1` 的查询参数差异，以及 `search_term -> query` 的兼容别名

### Account Data / Tags 契约重审

- 重写 `account-data.md`，将 `tags.rs` 纳入同一模块契约审查范围
- 补齐 `GET /user/{user_id}/tags`、`GET/PUT/DELETE /user/{user_id}/rooms/{room_id}/tags{/{tag}}` 的真实路径与返回格式
- 修正 filter、OpenID token、tag 写入删除接口的真实状态码与响应体，移除未被后端代码证实的 `201`、`413 M_TOO_LARGE` 等描述
- 补充 `room_tags` 表结构，并明确数据库字段 `order_value` 在响应中映射为 `order`

### Worker 契约重审

- 重写 `worker-admin.md`，区分管理员控制面与 replication 协议面，修正文档误称“全部端点均走 `AdminUser`”的问题
- 明确 worker 协议面仅在 `state.services.config.worker.enabled == true` 时挂载
- 修正复制位点与事件流接口定义，确认不存在 `GET /replication/{worker_id}/{stream_name}`，而是 `GET /replication/{worker_id}/position?stream_name=...` 与 `PUT /replication/{worker_id}/{stream_name}`
- 对齐 `WorkerType`、`WorkerStatus`、`WorkerResponse`、`WorkerCommandResponse`、`WorkerTaskResponse` 的稳定字段与合法枚举值

### 历史报告收口

- 为 `*_REVIEW_SUMMARY.md`、`ACCOUNT_DATA_REVIEW_REPORT.md`、`ACCOUNT_DATA_CHANGELOG.md`、`AUTH_REVIEW_REPORT.md`、`AUTH_CHANGELOG.md`、`ADMIN_SDK_COVERAGE_REPORT.md`、`ADMIN_UPDATE_2026-04-15.md` 增加“阶段性快照”注记
- 明确历史专项报告仅保留审查过程与当时结论，当前契约应以主文档、`README.md`、`CHANGELOG.md` 与 `VERIFICATION_REPORT.md` 为准
- 为 `auth-enhanced.md`、`device-enhanced.md`、`dm-enhanced.md` 增加“历史增强版契约快照”定位说明，避免与当前主契约基线混淆
- 在 `README.md` 中新增“历史材料清单”与“历史材料使用原则”，明确每份旧文档的用途与阅读边界
- 将历史专项报告、阶段性总结与增强版契约统一移动到 `history/` 目录，并新增 `history/README.md` 作为历史材料入口索引

## 2026-04-14

### HuLa 前端 throwOnError 全面迁移

- 将 HuLa 前端 25+ 个 Matrix Service 全面迁移到 BaseManager throwOnError 错误处理模式
- 迁移的 Service 列表：MatrixAccountService, MatrixQuotaService, MatrixFederationBlacklistService, MatrixKeyRotationService, MatrixPinnedEventsService, MatrixBurnAfterReadService, MatrixVoIPService, MatrixPushService, MatrixPresenceService, MatrixWidgetService, MatrixVoiceService, MatrixSyncService, MatrixReceiptService, MatrixTagService, MatrixRoomAccountDataService, MatrixEncryptionService, MatrixSettingsService, MatrixSlidingSyncService, MatrixUserDirectoryService, MatrixSecureBackupService
- 所有方法遵循契约规范：读操作默认 `throwOnError=true`，写操作默认 `throwOnError=false`
- 修复 MatrixAccountService 测试用例以匹配 throwOnError 行为
- 修复 MatrixClientService 预先存在的 `_tokenExpiresIn`/`_tokenStartTime` 属性声明缺失问题

### API 契约一致性修复

- MatrixPresenceService: 新增 `getPresenceList()` 方法，对齐 `presence.md` 契约
- MatrixSpaceService: 新增 `joinSpace()`, `leaveSpace()`, `inviteToSpace()`, `getSpaceRooms()`, `getSpaceState()`, `getSpaceSummary()`, `getPublicSpaces()` 方法，对齐 `space.md` 契约
- MatrixPushService: 修复 linter 错误，所有写入方法添加 throwOnError 参数
- MatrixWidgetService: 核心方法添加 throwOnError 参数，对齐 `widget.md` 契约
- MatrixVoiceService: 所有方法添加 throwOnError 参数，对齐 `voice.md` 契约
- 收敛 `synapse-rust` rendezvous 对象级鉴权：除创建会话外，`/_matrix/client/v1/rendezvous/{session_id}*` 现统一要求 `X-Matrix-Rendezvous-Key` 或已绑定用户/管理员身份；SDK `RendezvousManager` 已补充 `sessionKey` 透传，集成测试与 `rendezvous.md` 同步更新
- 收敛 `synapse-rust` typing 对象级鉴权：`/_matrix/client/v3/rooms/{room_id}/typing*` 与批量 `/_matrix/client/v3/rooms/typing` 现统一要求房间成员或管理员访问，且 `PUT /typing/{user_id}` 仅允许更新调用方自己的 typing；新增集成测试并同步 `room.md`
- 收敛 `synapse-rust` 邀请限制名单读取鉴权：`GET /_matrix/client/v3/rooms/{room_id}/invite_{blocklist,allowlist}` 现要求房间成员或管理员访问，防止通过已知 `room_id` 直接探测邀请限制；新增集成测试并同步 `room.md`
- 收敛 `synapse-rust` presence 单用户读取鉴权：`GET /_matrix/client/{v1,r0,v3}/presence/{user_id}/status` 现与写入一致，仅允许本人或管理员访问；新增跨用户读取拒绝回归并同步 `presence.md`

### 移动端 UI 模块补齐

- MobilePinnedEventsBar: 创建移动端置顶消息栏组件，已集成到 MobileChatMain 聊天界面
- MobileBurnIndicator: 创建移动端阅后即焚指示器组件
- MobileSpaceDetail: 创建移动端空间详情页
- MobileThreadPanel: 创建移动端线程面板
- SecuritySettings: 新增验证和密钥轮转功能
- ThreePidManagement: 创建移动端3PID管理页面
- DeviceManagement: 新增设备重命名功能

### 测试覆盖提升

- 新增 MatrixAccountService 单元测试（15个用例），覆盖设备管理/3PID/忽略用户/throwOnError 模式
- 总测试数从 547 提升至 562，全部通过

## 2026-04-13

### 字段级契约审计扩展

- 将 `room-summary.md` 从“响应形态”补齐为字段级契约，明确 `RoomSummary`、`RoomSummaryMember`、`RoomStats`、`IRoomSummaryState` 与内部列表接口的稳定字段
- 将 `push.md` 从“已知稳定字段”补齐为字段级响应审计，明确 `IPusher`、`IPushRules`、`IPushRuleSet`、`IPushRule`、`INotificationsResponse` 的顶层字段与列表项字段
- 将 `sync.md` 从“响应形态”补齐为字段级契约，展开 `GET /sync`、`GET /events`、`GET /joined_rooms`、`GET /my_rooms` 与 Sliding Sync 的顶层/房间级字段
- 修正 `sync.md` 将 Sliding Sync 请求体误写为 `rooms?` 的描述，改为与后端一致的 `room_subscriptions?` / `unsubscribe_rooms?`，并注明 `clientTimeout?` 仅为 SDK 本地超时
- 修正文档中 `thread.md` 若干简写路径，统一为实际后端完整路径，避免读者误判房间级线程路由范围
- 更新 `VERIFICATION_REPORT.md` 对字段级审计推进状态的结论，收敛“仅 thread 已展开字段审计”的过时表述

### Sync SDK 收敛

- 修复 `MatrixClient.slidingSync()` 会原地修改调用方请求对象的问题，避免删除 `pos` / `timeout` / `clientTimeout`
- 修复 `slidingSync()` 将合法的 `timeout=0` 误判为未传值的问题，确保查询参数与后端契约一致
- 为 `spec/unit/matrix-client.spec.ts` 补充 Sliding Sync 回归测试，锁定查询参数拆分、`clientTimeout` 本地透传与无副作用行为
- 修复 `MatrixClient.getMyRooms()` 返回类型与后端 `membership` 字段不一致的问题；SDK 现保留真实字段，并在 `membership` / `join_state` 两个字段之间双向补齐兼容别名
- 为 `spec/unit/matrix-client.spec.ts` 补充 `GET /events` peek 轮询回归测试，锁定 `chunk` 消费与 `end -> from` 分页 token 传递
- 为 `spec/unit/matrix-client.spec.ts` 补充 `/sync` 查询参数回归测试，确认 SDK 会透传 `set_presence`，并继续以 filter id 发起请求
- 修复 `synapse-rust` `GET /sync` 未消费 `filter` 的链路缺口；服务端现会读取已保存 filter 的 `room.timeline.limit` 并对房间 timeline 结果做裁剪
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已对 `room.state` / `room.ephemeral` / `room.account_data` 接入 `types` / `not_types` / `senders` / `not_senders` 基础事件过滤，并补充对应单测与文档结论
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已对顶层 `presence` 接入 `types` / `not_types` / `senders` / `not_senders` 基础事件过滤，并补充解析/过滤单测与文档结论
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已将 `room.timeline` 的 `types` / `not_types` / `senders` / `not_senders` 下推到事件抓取链路，并补充 `/sync` 集成回归测试与契约说明
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已消费 `event_fields` / `event_format` / `room.rooms` / `room.not_rooms` / `room.include_leave`，并兼容 inline JSON filter，同时补充字段裁剪、房间筛选与通配类型匹配单测
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已支持 `contains_url` 解析与事件值过滤，并补充匹配单测与文档结论
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已支持基础版 `lazy_load_members`，会在 `/sync` 的 `state.events` 中按“当前用户 + 本次 timeline 相关成员”裁剪 `m.room.member`，并补充对应单测与契约说明
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已为 `lazy_load_members` 接入按 `user_id + device_id + room_id` 维度的进程内与数据库持久化成员缓存，可在新的 `SyncService` 实例中从数据库恢复并延续设备级去重语义，并在设备删除时清理对应缓存；同时 `include_redundant_members` 在 `/sync` 的 `state.events` 裁剪阶段及缓存恢复后均会生效，并补充 state delta、跨实例恢复与存储侧清理回归单测
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已补齐官方 Synapse 风格的非截断增量 `/sync` state delta membership 语义，会在 `timeline.limited = false` 时补发自 `since` 以来仅存在于 state delta 的相关成员状态，并让这类房间在无 timeline 事件时也能进入本次 `/sync`；同时补跑 `cargo test --lib`，确认当前库单测集合稳定通过
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已让未开启 `lazy_load_members` 的增量 `/sync` 正常返回自 `since` 以来的 `state.events`，并在 `room.timeline` 过滤掉这些事件时，仍按 state delta 将房间纳入本次 `/sync`、推进 `next_batch`；同时修正文档里“lazy-load 缓存仅进程内”的过时描述
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 filter 语义；服务端现已用回归测试锁定 `lazy_load_members` 在 `timeline.limited = true` 时的边界行为: 不会因为仅存在于 state delta 的 membership 变化而额外扩张 `state.events`，此时只返回当前用户与本次实际回传 timeline 所需的成员状态
- 继续收敛 `synapse-rust/src/services/sync_service.rs` 的 `/sync` timeline 语义；服务端现已按“抓取 `limit + 1` 条最新事件后再裁剪”的方式正确计算 `timeline.limited`，避免在事件数恰好等于 limit 时误报截断，并将最终 `timeline.events` 按客户端可消费的旧到新顺序返回
- 修复 `synapse-rust` `/sync` 与 `/rooms/{room_id}/messages` 的历史分页 token 兼容缺口；服务端现统一接受 `/sync` 返回的 `t{origin_server_ts}` `prev_batch` 作为 `/messages?from=` 与 `/timeline?from=` 输入，并为真实 `GET /_matrix/client/v3/rooms/{room_id}/messages?from=t...` 链路补充路由级集成测试
- 复核后端 Sync 能力现状：`synapse-rust` 现已补齐本轮后端验收范围内的 `SlidingSync` 三个核心缺口，包括列表过滤下推、房间级 `timeline` / `state` / `required_state` 响应组装，以及 MSC3886 风格增量 `ops`；同时 `/sync` 主响应已接入 `device_one_time_keys_count`，`SlidingSync` 也已补齐 `e2ee` extension 的 `device_lists` / `device_one_time_keys_count` / `device_unused_fallback_key_types` 和 `to_device` extension 的 `events` / `next_batch`。`SlidingSyncSdk`、`cryptoCallbacks`、`pendingEventOrdering` 改判为客户端 SDK 能力，不再作为后端实现项验收；后端剩余明确差距主要转为其他尚未覆盖的扩展能力与更细粒度 MSC3886 兼容项
- 收敛 `synapse-rust` room 占位接口：`GET /_matrix/client/{r0,v3}/rooms/{room_id}/initialSync` 已改为最小兼容实现，返回基础 `state` / `members` / `messages` 房间快照，并补充对应集成回归测试
- 清理 `synapse-rust` 10 个无业务价值的 room 私有占位路由：`fragments`、`service_types`、`event_perspective`、`reduced_events`、`rendered`、`translate`、`convert`、`vault_data`、`external_ids`、`device` 已从路由树移除，请求这些路径时返回 `404 NOT FOUND`；`room.md` 与集成回归测试已同步更新
- 复核并锁定 `synapse-rust` widget 鉴权闭环：`v1` widget CRUD / 配置 / session 读取终止与 `v3` 房间级 `capabilities` 现已要求认证，并补充 `401/403/400/200` 分层集成回归，覆盖非成员访问、widget-room 绑定不匹配与无关用户读取 session 等对象级鉴权场景
- 收敛 `synapse-rust` voice 伪成功语义：`POST /_matrix/client/r0/voice/convert` 与 `POST /_matrix/client/r0/voice/optimize` 不再返回“成功但内容为 null”的模拟结果，现改为显式 `M_UNRECOGNIZED` 错误，并同步更新 `voice_routes_tests.rs` 与 `voice.md`
- 修复 `synapse-rust` media 路由语义：`PUT /_matrix/media/v3/upload/{server_name}/{media_id}` 现已真正使用路径参数落盘，非本机 `server_name` 返回 `400`，重复 `media_id` 返回 `409`；同时 `/_matrix/media/{v1,r1}/download/...` 失败时现返回真实 `404` 等错误状态码，不再回 `200 + JSON 错误体`，并补充对应集成回归测试与 `media.md`
- 收敛 `synapse-rust` voice 用户级读取鉴权：`GET /_matrix/client/r0/voice/user/{user_id}` 与 `GET /_matrix/client/r0/voice/user/{user_id}/stats` 现仅允许访问认证用户自己的语音列表与统计，跨用户访问返回 `403 M_FORBIDDEN`，并同步更新 `voice_routes_tests.rs` 与 `voice.md`
- 收敛 `synapse-rust` voice 房间级读取鉴权：`GET /_matrix/client/r0/voice/room/{room_id}` 现要求调用方是房间成员，非成员访问返回 `403 M_FORBIDDEN`，并补充成员成功/非成员拒绝的集成回归测试
- 收敛 `synapse-rust` voice 消息级/上传鉴权：`POST /_matrix/client/r0/voice/upload` 现禁止非成员向目标房间挂载语音，`GET /_matrix/client/r0/voice/{message_id}` 与 `POST /_matrix/client/v1/voice/transcription` 现要求调用方为消息所有者或关联房间成员，并补充对应 `403` 集成回归测试
- 收敛 `synapse-rust` voice 删除鉴权：`DELETE /_matrix/client/r0/voice/{message_id}` 不再对现存越权删除伪装成 `404`，现改为显式 `403 M_FORBIDDEN`；同时允许管理员覆盖删除，并补充对应集成回归测试
- 收敛 `synapse-rust` room 时间线/状态读取鉴权：`GET /_matrix/client/{r0,v3}/rooms/{room_id}/messages`、`GET /_matrix/client/{r0,v3}/rooms/{room_id}/state`、`GET /_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}`、`GET /_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/` 与 `GET /_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/{state_key}` 现统一要求调用方为房间成员或管理员，越权访问返回 `403 M_FORBIDDEN`，并补充对应集成回归测试
- 收敛 `synapse-rust` room summary 对象级鉴权：`/_matrix/client/{r0,v3}/rooms/{room_id}/summary*` 现统一要求调用方为房间成员或管理员；非成员不再能读取摘要、成员列表、状态与统计，也不能刷新、重算、清理未读或写入摘要，越权访问统一返回 `403 M_FORBIDDEN`，并补充对应集成回归测试

### Thread SDK 收敛

- 修复 `ThreadingManager.createGlobalThread()` / `createRoomThread()` 未发送后端必需 `content` 字段的问题；SDK 现默认补发空对象，并支持显式透传 `content` / `originServerTs`
- 修复 `ThreadingManager.getLegacyRoomThreadList()` 未暴露后端 `include_all` 查询参数的问题，避免旧版线程列表接口能力缺口
- 更新 `thread.md` 对创建线程请求体与 legacy 线程列表查询参数的契约说明，并补充对应请求封装回归测试
- 修复 `RoomSummaryManager.getRoomThreadById()` 继续沿用 `getRoomThread()` 旧返回类型的问题；SDK 现按 `/threads/{thread_id}` 真实响应拆分详情类型，并补充 room summary 线程读取回归测试
- 修复 `RoomSummaryManager.getRoomCapabilities()` / `getRoomNotifications()` / `getRoomUnreadCount()` / `getRoomMetadata()` 与 `room.rs` 返回字段不一致的问题；SDK 现补齐 `room_version`、`features`、`join_rule`、`next_token`、`notification_type`、`ts`、`is_read`、`notification_count`、`highlight_count`、`encryption`、`is_public`、`member_count`、`created_ts` 等真实字段，并为通知分页/旧未读计数字段/元数据补出兼容别名

### 契约索引与核验记录补齐

- 补齐 `README.md` 对 `rendezvous.md` 与 `THROW_ON_ERROR_MIGRATION.md` 的索引，消除目录覆盖缺口
- 收敛 `backend-route-inventory.md` 中将 `Rendezvous` 误列为“仍未单独拆文档模块”的过时描述
- 补齐 `VERIFICATION_REPORT.md` 对 `rendezvous.md` 的已重审记录，保持核验清单与实际文档一致
- 为 `admin.md` 补齐挂载版本、更新日期与常见状态码，提升参数/错误维度可验证性
- 为 `federation.md` 补齐挂载版本与更新日期，统一文档元信息
- 为 `rendezvous.md` 补齐后端审查来源与代码定位，完善源码追溯链路

### Voice / Widget / Thread 独立契约拆分

- 新增 `voice.md`，从 `media.md` 中拆出 `voice.rs` 的 11 个端点，并记录 SDK 与后端在上传、转换、优化、转写上的真实差异
- 新增 `widget.md`，补齐 `widget.rs` 的 17 个端点、权限/会话模型，以及 SDK 在 `v3` capabilities/send 前缀上的不一致
- 新增 `thread.md`，补齐 `handlers/thread.rs` 的 21 个端点，并明确 SDK 目前缺少直接 REST 封装
- 更新 `README.md`、`backend-route-inventory.md`、`VERIFICATION_REPORT.md` 索引，移除 Voice / Widget / Thread 仍属“未单独拆文档模块”的过时描述
- 更新 `media.md`，将语音路由从 Media 契约中剥离，避免继续把本地 SDK 行为误记为 `voice.rs` 的 REST 对接

### Voice / Widget / Thread SDK 契约回补

- 对齐 `src/voice/index.ts` 中 `convertVoiceMessage()` / `optimizeVoiceMessage()` / `transcribeVoiceMessage()` 的请求体与稳定响应映射，改为匹配 `voice.rs` 的 `message_id`、`target_size_kb`、`event_id | mxc` 契约
- 对齐 `src/widget/index.ts` 中房间级 `capabilities` / `send` 到 `/_matrix/client/v3`，并新增 `setWidgetCapabilities()` 公开方法
- 在 `src/threading/index.ts` 中补齐线程列表、创建、详情、回复、订阅、未读、统计、撤回等全量 REST 封装，并将“创建线程响应”和“线程详情 root”拆分为真实后端类型
- 为 `spec/unit/api-encapsulation-audit.spec.ts` 与 `spec/unit/widget.spec.ts` 补齐能力端点、消息发送、语音转写、线程 REST 路径的回归校验
- 更新 `voice.md`、`widget.md`、`thread.md` 中 SDK 对齐状态、封装覆盖率与线程字段级响应契约

### SDK 类型与日志收敛

- 收紧 `src/room-summary/index.ts` 中 `getPublicRooms()` 返回类型为 `IPublicRoomsResponse | null`
- 收紧 `searchPublicRooms()` 与 `getRecommendedRooms()` 返回类型为 `IPublicRoomsChunkRoom[]`
- 将 `PushManager.getPushRules()` 的流程日志从 `info` 收敛为 `debug`，保留失败场景的 `error`

## 2026-04-11

### docs/api-contract 误报收敛

- 收敛 `room.md` 中把 widget `capabilities` / `send` 误写为未挂载的问题
- 收敛 `auth.md` 中把 `GET /_matrix/client/v1/config/client` 误写为 `M_UNRECOGNIZED` 的问题
- 收敛 `key-backup.md` 中把 `uploadSessionKey()` 单会话 PUT 路径误写为未挂载的问题
- 收敛 `backend-route-inventory.md`、`README.md`、`VERIFICATION_REPORT.md` 中把 `key_rotation.rs` 误列为未挂载文件的问题
- 保留 `openclaw.rs`、`websocket.rs` 作为当前仍未接入主装配入口的真实排除项

### TypeScript 类型安全修复 — `any` 类型消除

本轮对 SDK 源码中可消除的 `any` 类型进行了系统性替换，提升类型安全性。以下是影响公共 API 的变更：

#### 新增公共方法

- **`BaseManager.setRetryOptions(options: RetryOptions): void`**
    - 新增公共方法，替代直接访问 `protected retryOptions` 属性
    - 原先通过 `(manager as any).retryOptions = options` 的用法改为 `manager.setRetryOptions(options)`
    - 影响模块：`event/EventManager`、所有 `BaseManager` 子类

#### 返回类型收紧 (`Record<string, any>` → `Record<string, unknown>`)

以下公共 API 的返回类型或参数类型从 `Record<string, any>` 收紧为 `Record<string, unknown>`：

| 方法/属性                                    | 文件                                 | 变更                                                                              |
| -------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `MatrixClient.getStateEvent()` 返回类型      | `client.ts`                          | `Promise<Record<string, any>>` → `Promise<Record<string, unknown>>`               |
| `MatrixClient.sendReceipt()` body 参数       | `client.ts`                          | `Record<string, any>` → `Record<string, unknown>`                                 |
| `ISecureBackupInfo.auth_data`                | `client-api-types.ts`                | `Record<string, any>` → `Record<string, unknown>`                                 |
| `InteractiveAuth.getStageParams()` 返回类型  | `interactive-auth.ts`                | `Record<string, any>` → `Record<string, unknown>`                                 |
| `UrlPreviewManager.getUrlPreview()` 返回类型 | `url-preview/index.ts`               | `Promise<Record<string, any>>` → `Promise<Record<string, unknown>>`               |
| `getStateEventRequest()` 返回类型            | `client-room-management-requests.ts` | `Promise<Record<string, any>>` → `Promise<Record<string, unknown>>`               |
| `IDeviceKeys.unsigned`                       | `crypto/store/base.ts`               | `Record<string, any>` → `Record<string, unknown>`                                 |
| `Room.tags`                                  | `models/room.ts`                     | `Record<string, Record<string, any>>` → `Record<string, Record<string, unknown>>` |
| `ThirdpartyManager.parseMatrixUri()` fields  | `thirdparty/index.ts`                | `Record<string, any>` → `Record<string, unknown>`                                 |

#### 返回类型收紧 (其他)

| 方法/属性                                     | 文件                   | 变更                                                                                                                               |
| --------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `MatrixCall.getCurrentCallStats()`            | `webrtc/call.ts`       | `Promise<any[] \| undefined>` → `Promise<RTCStats[] \| undefined>`                                                                 |
| `DiscoveryManager.searchUserDirectory()` body | `discovery/index.ts`   | `Record<string, any>` → `Record<string, string \| number>`                                                                         |
| `ThreadLike.lastReply`                        | `client-send-event.ts` | `(predicate: (event: any) => boolean) => any` → `(predicate: (event: MatrixEvent) => boolean) => MatrixEvent \| null \| undefined` |

#### 新增响应接口 (external-service)

| 接口                              | 用途                                   |
| --------------------------------- | -------------------------------------- |
| `IListServicesResponseItem`       | `listServices()` 的 API 响应类型       |
| `IGetAllHealthStatusResponseItem` | `getAllHealthStatus()` 的 API 响应类型 |

#### 保留 `any` 的合理场景

以下 `any` 类型经评估后保留，因为修改会导致大量级联类型错误或破坏 API 兼容性：

- `Body = Record<string, any> | BodyInit` — HTTP 请求体类型，TypeScript 接口无隐式索引签名
- `IContent` / `IUnsigned` 的 `[key: string]: any` — Matrix 协议可扩展内容对象
- `AnyListener = (...args: any) => any` — 事件系统基础类型
- `BaseManager` 的 `Record<Events, any>` — 子类事件映射使用对象类型，与 `ListenerMap` 不兼容
- `ToDevicePayload = Record<string, any>` — 接口不能赋值给 `Record<string, unknown>`
- `SendToDeviceContentMap` — 同上
- `logger.ts` 的 `...msg: any[]` — 日志方法需接受任意参数
- `IStore.on` / `IndexedDBStore.on` 的 `(...args: any[]) => void` — 事件处理器参数类型动态

## 2026-04-04

### Presence 模块审计完成

- 完成 `presence.md` 契约与 SDK/后端交叉验证
- 发现 3 个问题：
    - ⚠️ P1: 契约文档缺少 `GET /presence/list/{user_id}` 端点记录
    - ⚠️ P1: SDK 缺少 `getPresenceList()` 方法
    - 📝 P2: SDK 错误处理不完善
- 更新 `presence.md` 添加 SDK Manager 对应关系和审计状态
- 创建 `PRESENCE_API_AUDIT.md` 审计报告
- 封装覆盖率: 80% (4/5)

### Key Backup 模块审计完成

- 完成 `key-backup.md` 契约与 SDK/后端交叉验证
- 发现 5 个问题：
    - 🔴 P0: SDK 使用间接封装而非直接 HTTP 调用
    - 🔴 P0: 缺少恢复与校验功能 (6 个端点)
    - 🔴 P0: 缺少导入导出功能 (4 个端点)
    - ⚠️ P1: 缺少 Secure Backup 封装 (6 个端点)
    - ⚠️ P1: 缺少批量密钥上传
- 更新 `key-backup.md` 添加 SDK Manager 对应关系和审计状态
- 创建 `KEY_BACKUP_API_AUDIT.md` 审计报告
- 封装覆盖率: 0% 直接 HTTP 封装，75% 未封装

### E2EE 契约文档补齐

- 新增 `e2ee.md`，拆分 `e2ee_routes.rs` 中的核心密钥、to-device、设备信任与安全摘要接口
- 新增 `key-backup.md`，拆分 `key_backup.rs` 的版本管理、密钥备份、恢复、导入导出，以及 `e2ee_routes.rs` 中的 secure backup 接口
- 新增 `verification.md`，拆分 `verification_routes.rs` 的 SAS 与二维码设备校验接口
- 更新 `README.md` 索引，纳入新增文档
- 更新 `backend-route-inventory.md`，将 E2EE / Key Backup / Verification 从总表补录改为独立文档引用
- 更新 `VERIFICATION_REPORT.md`，记录本轮补齐范围
- 审查基线保持为 `synapse-rust` 当前磁盘代码；已纠正把 `key_rotation.rs` 误判为未挂载文件的问题

### Media 模块修复完成

- **SDK 修复**:
    - Voice 端点路径: `ClientPrefix.V3` → `VOICE_R0_PREFIX` (`/_matrix/client/r0`)
    - Voice transcription: `/voice/transcribe` → `/voice/transcription`, prefix → `VOICE_V1_PREFIX`
    - Voice getWaveform: 改为本地生成波形（后端无此端点）
    - 添加 `MediaManager.deleteMedia()` 方法
    - 添加 `MediaManager.previewUrl()` 方法
    - 添加 `MediaManager.uploadContentWithId()` 方法
    - 添加 `MediaQuotaManager.getQuotaAlerts()` 方法
- **文档更新**:
    - 更新 `media.md` 契约状态为"已完成并修复"
    - 更新 `MEDIA_API_AUDIT.md` 审计报告
- **验证结果**: 封装覆盖率 78% (18/23)

### Media 模块审计完成

- 完成 `media.md` 契约与 SDK/后端交叉验证
- 发现 6 个问题：
    - 🔴 P0: Voice 端点路径错误 (SDK 使用 V3，后端实际是 r0)
    - 🔴 P0: 缺少 `deleteMedia()` 方法
    - ⚠️ P1: 缺少 `previewUrl()` 方法
    - ⚠️ P1: 缺少 `getQuotaAlerts()` 方法
    - 📝 P2: 缺少 `uploadContentWithId()` 方法
    - 📝 P2: voice 端点应在独立契约文档
- 更新 `media.md` 添加 SDK Manager 对应关系和审计状态
- 创建 `MEDIA_API_AUDIT.md` 审计报告

### Friend 模块修复完成

- **后端修复**: 添加 `PUT /friends/{user_id}/displayname` 路由和 `update_friend_displayname` 服务方法
- **SDK 修复**:
    - `sendFriendRequest` 字段 `reason` → `message` 与后端对齐
    - `getFriendInfo` 改为调用专用端点而非遍历好友列表
- **文档更新**:
    - 更新 `friend.md` 契约状态为"已完成并修复"
    - 更新 `FRIEND_API_AUDIT.md` 审计报告
- **验证结果**: 封装覆盖率 100% (25/25)

## 2026-04-03

### Friend 模块审计完成

- 完成 `friend.md` 契约与 SDK/后端交叉验证
- 发现 5 个问题：
    - 🔴 P0: 后端缺失 `PUT /friends/{user_id}/displayname` 路由
    - ⚠️ P1: `sendFriendRequest` 请求体字段不一致 (`reason` vs `message`)
    - ⚠️ P1: `getFriendInfo` 实现错误（未调用专用端点）
    - ⚠️ P2: `ensureFriendListRoom` 语义不清
    - 📝 P3: 契约文档与实现不一致
- 更新 `friend.md` 添加审计状态列和问题详情

### 契约文档重审

- 以 `synapse-rust` 当前磁盘代码为准，重审 `docs/api-contract` 目录
- 重写 `README.md`，改为后端真实挂载路由索引
- 重写 `auth.md`，补齐 auth/account/directory/discovery 端点
- 重写 `admin.md`，按 admin 子模块分组列出真实端点
- 重写 `room.md`，按 `r0/v1/v3` 真实挂载拆分
- 重写 `sync.md`，区分 GET Sync 与 POST Sliding Sync
- 重写 `push.md`、`space.md`、`dm.md`、`friend.md`
- 新增 `account-data.md`、`device.md`、`media.md`、`presence.md`、`room-summary.md`、`federation.md`
- 新增 `backend-route-inventory.md`，补充其余已挂载模块的后端路由总表
- 重写 `VERIFICATION_REPORT.md`，记录本轮交叉验证方法与排除项

## 变更原则

- 文档结论以已挂载路由为准
- 版本前缀必须与代码一致
- 未挂载文件不写入可达 API 契约
- 复杂响应仅承诺代码中稳定可见字段
