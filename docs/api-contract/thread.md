---
module: thread
generated_from: docs/api-contract/generated/modules/thread.json
generated_hash: sha256-d9b0986249d0e1fe3600b8a211f23202c6b3334ed0e5e8665924e62970cd90b2
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Thread 模块契约

> 版本: v1.0.0
> 更新日期: 2026-04-13
> 对应 SDK 模块: `src/threading/index.ts`、`src/client-timeline-requests.ts`
> 审查来源: `synapse-rust/src/web/routes/handlers/thread.rs`
> 审计状态: ✅ `thread.rs` 的 21 个外部端点已全部具备对应 SDK REST 封装，并已绑定生成 `ThreadPathPattern`

## 挂载版本

| 前缀                 | 路由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/_matrix/client/v1` | `/threads`、`/threads/subscribed`、`/threads/unread`、`/rooms/{room_id}/threads`、`/rooms/{room_id}/threads/search`、`/rooms/{room_id}/threads/unread`、`/rooms/{room_id}/threads/{thread_id}`、`/rooms/{room_id}/threads/{thread_id}/freeze`、`/rooms/{room_id}/threads/{thread_id}/unfreeze`、`/rooms/{room_id}/threads/{thread_id}/replies`、`/rooms/{room_id}/threads/{thread_id}/subscribe`、`/rooms/{room_id}/threads/{thread_id}/unsubscribe`、`/rooms/{room_id}/threads/{thread_id}/mute`、`/rooms/{room_id}/threads/{thread_id}/read`、`/rooms/{room_id}/threads/{thread_id}/stats`、`/rooms/{room_id}/replies/{event_id}/redact` |
| `/_matrix/client/v3` | `/user/{user_id}/rooms/{room_id}/threads`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 路由清单

| 方法   | 路径                                                                 | 说明                 | 认证     |
| ------ | -------------------------------------------------------------------- | -------------------- | -------- |
| GET    | `/_matrix/client/v1/threads`                                         | 全局线程列表         | 用户     |
| POST   | `/_matrix/client/v1/threads`                                         | 全局创建线程         | 用户     |
| GET    | `/_matrix/client/v1/threads/subscribed`                              | 获取已订阅线程       | 用户     |
| GET    | `/_matrix/client/v1/threads/unread`                                  | 获取全局未读线程     | 用户     |
| GET    | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/threads`          | 兼容旧版线程搜索列表 | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads`                         | 在房间内创建线程     | 用户     |
| GET    | `/_matrix/client/v1/rooms/{room_id}/threads`                         | 获取房间线程列表     | 用户     |
| GET    | `/_matrix/client/v1/rooms/{room_id}/threads/search`                  | 搜索房间线程         | 用户     |
| GET    | `/_matrix/client/v1/rooms/{room_id}/threads/unread`                  | 获取房间未读线程     | 用户     |
| GET    | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}`             | 获取线程详情         | 可选认证 |
| DELETE | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}`             | 删除线程             | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/freeze`      | 冻结线程             | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unfreeze`    | 解冻线程             | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies`     | 添加回复             | 用户     |
| GET    | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies`     | 获取回复列表         | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/subscribe`   | 订阅线程             | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unsubscribe` | 取消订阅线程         | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/mute`        | 静音线程             | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/read`        | 标记线程已读         | 用户     |
| GET    | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/stats`       | 获取线程统计         | 用户     |
| POST   | `/_matrix/client/v1/rooms/{room_id}/replies/{event_id}/redact`       | 撤回回复             | 用户     |

## 请求体与稳定响应

### 全局线程接口

- `GET /threads` 使用查询参数 `limit`、`from`
- `GET /threads` 成功响应为 `ThreadListResponse`，字段为 `threads`、`next_batch`、`total`
- `POST /threads` 请求体要求 `room_id`、`root_event_id`、`content`，可选 `origin_server_ts`
- `POST /threads` 成功响应字段为 `thread_id`、`root_event_id`、`room_id`、`sender`、`reply_count`、`last_reply_event_id`、`last_reply_sender`、`last_reply_ts`、`participants`、`is_fetched`、`created_ts`
- `GET /threads/subscribed` 返回 `SubscribedThreadsResponse`
- `GET /threads/unread` 返回 `UnreadThreadsResponse`

### 房间线程接口

- `POST /rooms/{room_id}/threads` 请求体要求 `root_event_id`、`content`，可选 `origin_server_ts`
- `POST /rooms/{room_id}/threads` 成功响应字段与全局创建线程保持一致，不返回 `id`、`updated_ts`
- `GET /rooms/{room_id}/threads` 使用查询参数 `limit`、`from`、`include_all`
- `GET /rooms/{room_id}/threads` 列表项字段为 `id`、`room_id`、`thread_id`、`root_event_id`、`root_sender`、`root_content`、`root_origin_server_ts`、`latest_event_id`、`latest_sender`、`latest_content`、`latest_origin_server_ts`、`reply_count`、`participants`、`is_frozen`、`created_ts`、`updated_ts`
- `GET /rooms/{room_id}/threads/{thread_id}` 支持 `include_replies`、`reply_limit`
- `GET /rooms/{room_id}/threads/{thread_id}` 响应顶层字段为 `root`、`replies`、`reply_count`、`participants`、`summary`、`user_receipt`、`user_subscription`
- `GET /rooms/{room_id}/threads/{thread_id}` 中 `root` 来自 `ThreadRoot`，包含 `id`、`room_id`、`root_event_id`、`sender`、`thread_id`、`reply_count`、`last_reply_event_id`、`last_reply_sender`、`last_reply_ts`、`participants`、`is_fetched`、`created_ts`、`updated_ts`
- `GET /rooms/{room_id}/threads/search` 使用查询参数 `q`、`limit`
- `GET /rooms/{room_id}/threads/search` 返回 `ThreadSummary[]`
- `GET /rooms/{room_id}/threads/unread` 返回 `UnreadThreadsResponse`

### 线程状态与回复接口

- `DELETE /rooms/{room_id}/threads/{thread_id}` 成功返回 `204 No Content`
- `POST /rooms/{room_id}/threads/{thread_id}/freeze`、`POST /rooms/{room_id}/threads/{thread_id}/unfreeze`、`POST /rooms/{room_id}/threads/{thread_id}/unsubscribe`、`POST /rooms/{room_id}/replies/{event_id}/redact` 成功均返回 `200`
- `POST /rooms/{room_id}/threads/{thread_id}/replies` 请求体要求 `event_id`、`root_event_id`、`content`，可选 `in_reply_to_event_id`、`origin_server_ts`
- `POST /rooms/{room_id}/threads/{thread_id}/replies` 与 `GET /rooms/{room_id}/threads/{thread_id}/replies` 返回字段均为 `event_id`、`thread_id`、`room_id`、`sender`、`content`、`origin_server_ts`、`in_reply_to_event_id`、`is_edited`、`is_redacted`
- `POST /rooms/{room_id}/threads/{thread_id}/subscribe` 请求体要求 `notification_level`
- `POST /rooms/{room_id}/threads/{thread_id}/subscribe` 与 `POST /rooms/{room_id}/threads/{thread_id}/mute` 返回 `ThreadSubscription`，字段为 `id`、`room_id`、`thread_id`、`user_id`、`notification_level`、`is_muted`、`subscribed_ts`、`updated_ts`
- `POST /rooms/{room_id}/threads/{thread_id}/read` 请求体要求 `event_id`、`origin_server_ts`，返回 `ThreadReadReceipt`
- `ThreadReadReceipt` 字段为 `id`、`room_id`、`thread_id`、`user_id`、`last_read_event_id`、`last_read_ts`、`unread_count`、`updated_ts`
- `GET /rooms/{room_id}/threads/{thread_id}/stats` 返回 `ThreadStatistics | null`，字段为 `id`、`room_id`、`thread_id`、`total_replies`、`total_participants`、`total_edits`、`total_redactions`、`first_reply_ts`、`last_reply_ts`、`avg_reply_time_ms`、`created_ts`、`updated_ts`

### 兼容旧版搜索接口

- `GET /_matrix/client/v3/user/{user_id}/rooms/{room_id}/threads` 支持查询参数 `limit`、`from`、`include_all`，调用同一 service，但响应被重写为 `{ "chunk": [...], "next_batch": ... }`
- `chunk` 中稳定字段仅包含 `event_id`、`sender`、`content`、`origin_server_ts`

## 常见状态码

| 状态码 | 说明                                           |
| ------ | ---------------------------------------------- |
| `200`  | 请求成功                                       |
| `204`  | 删除线程成功且无响应体                         |
| `400`  | `room_id` 缺失、查询参数错误或请求体字段不完整 |
| `401`  | 需认证接口缺少或使用无效令牌                   |
| `404`  | 线程不存在                                     |
| `500`  | 存储层或 service 层内部错误                    |

## SDK Manager 对应关系

| 后端端点                                                                  | SDK 模块           | 方法                        | 现状                                                                                   |
| ------------------------------------------------------------------------- | ------------------ | --------------------------- | -------------------------------------------------------------------------------------- |
| `GET /_matrix/client/v1/threads`                                          | `ThreadingManager` | `getGlobalThreadList()`     | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/threads/subscribed`                               | `ThreadingManager` | `getSubscribedThreads()`    | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/threads/unread`                                   | `ThreadingManager` | `getGlobalUnreadThreads()`  | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v3/user/{user_id}/rooms/{room_id}/threads`           | `ThreadingManager` | `getLegacyRoomThreadList()` | ✅ 已直接封装；现已补齐 `include_all` 查询支持                                         |
| `POST /_matrix/client/v1/threads`                                         | `ThreadingManager` | `createGlobalThread()`      | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads`                         | `ThreadingManager` | `createRoomThread()`        | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/rooms/{room_id}/threads`                          | `ThreadingManager` | `getRoomThreadList()`       | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/rooms/{room_id}/threads/search`                   | `ThreadingManager` | `searchRoomThreads()`       | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/rooms/{room_id}/threads/unread`                   | `ThreadingManager` | `getRoomUnreadThreads()`    | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}`              | `ThreadingManager` | `getRoomThread()`           | ✅ 已直接封装；`RoomSummaryManager.getRoomThreadById()` 仍调用另一条 `v3` summary 路径 |
| `DELETE /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}`           | `ThreadingManager` | `deleteRoomThread()`        | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/freeze`      | `ThreadingManager` | `freezeThread()`            | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unfreeze`    | `ThreadingManager` | `unfreezeThread()`          | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies`     | `ThreadingManager` | `addThreadReply()`          | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies`      | `ThreadingManager` | `getThreadReplies()`        | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/subscribe`   | `ThreadingManager` | `subscribeToThread()`       | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unsubscribe` | `ThreadingManager` | `unsubscribeFromThread()`   | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/mute`        | `ThreadingManager` | `muteThread()`              | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/read`        | `ThreadingManager` | `markThreadRead()`          | ✅ 已直接封装                                                                          |
| `GET /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/stats`        | `ThreadingManager` | `getThreadStats()`          | ✅ 已直接封装                                                                          |
| `POST /_matrix/client/v1/rooms/{room_id}/replies/{event_id}/redact`       | `ThreadingManager` | `redactThreadReply()`       | ✅ 已直接封装                                                                          |

## 当前对齐结论

- `ThreadingManager` 已补齐 `thread.rs` 的全量 REST 封装，覆盖全局/房间列表、创建、详情、回复、订阅、未读、统计与撤回路径。
- `src/threading/index.ts` 现已将 `v1` 与 `v3` 线程 REST 路径绑定到生成的 `ThreadPathPattern`，避免 `/threads*` 路径再次手写漂移。
- `ThreadingManager` 仍同时保留本地线程对象与 timeline 能力，这部分与 `thread.rs` 的 REST 接口语义不同，不能混用理解。
- `buildThreadListRequestPath()` 与 `getThreadTimeline()` 仍属于路径构造或本地 timeline 能力，但不再是线程 REST 覆盖缺口。
- `GET /rooms/{room_id}/threads/{thread_id}` 在后端使用 `OptionalAuthenticatedUser`，是本模块中唯一可选认证接口。
- `search_threads` 的真实返回体是 `ThreadSummary[]`，并非 `ThreadListResponse`；SDK 已按后端实现收敛返回类型。
- 创建线程响应与详情里的 `root` 字段并非同一结构：前者不返回 `id`、`updated_ts`，SDK 已拆分类型避免误导。
- 创建线程接口在后端反序列化层要求 `content`；SDK 现默认补发 `{}`，并允许显式透传 `content` / `originServerTs`，避免因缺字段触发 `400`。
- `RoomSummaryManager` 中两个线程读取方法对应两条不同后端路径：`getRoomThread()` 命中 `/thread/{event_id}` 的事件线程视图，`getRoomThreadById()` 命中 `/threads/{thread_id}` 的线程详情视图；两者响应结构不同，SDK 现已拆分返回类型。

## 封装覆盖率

- **后端路由总数**: 21 个端点
- **SDK 已提供直接 REST 封装**: 21/21
- **已绑定生成路由模板**: 21/21
- **完全未封装**: 0/21

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/handlers/thread.rs`
- SDK 线程能力: `matrix-js-sdk/src/threading/index.ts`
- SDK 路径构造: `matrix-js-sdk/src/client-timeline-requests.ts`
