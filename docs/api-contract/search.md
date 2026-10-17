---
module: search
generated_from: docs/api-contract/generated/modules/search.json
generated_hash: sha256-40e21f15ed9f0d08f19215a0d2c75fc5a19e9f808d32e439909aa2e525ee3029
ledger_schema: 4
last_reviewed: 2026-05-11
---

# 搜索契约

> 审查来源: `synapse-rust/synapse-web/src/routes/handlers/search/mod.rs`
> SDK 入口: `src/search/index.ts`、`src/client.ts`、`src/event/EventManager.ts`、`src/room/RoomManager.ts`

## 当前审计结论

- `generated/modules/search.json` 当前记录 **11** 条路由，不是旧文档中的单一 `POST /search`。
- 路由能力分散在多个 SDK 入口：
    - `POST /search` 由 `MatrixClient.search()` / `SearchManager.search()` / `searchMessageText()` 承接
    - `POST /search_rooms` 由 `MatrixClient.searchRooms()` 承接
    - `POST /search_recipients` 本轮新增 `MatrixClient.searchRecipients()` 与 `SearchManager.searchRecipients()`
    - `/rooms/{room_id}/context/{event_id}` 由 `EventManager.getEventContext()` 承接
    - `/rooms/{room_id}/hierarchy` 由 `RoomManager.getRoomHierarchy()` / `MatrixClient.getRoomHierarchy()` 承接
    - `/rooms/{room_id}/timestamp_to_event` 由 `MatrixClient.timestampToEvent()` 承接
- `searchUserDirectory()` 实际走的是 `/user_directory/search`，不属于本模块 11 条后端路由统计。
- 本轮已将 `POST /search`、`POST /search_rooms`、`POST /search_recipients` 绑定到生成的 `SearchPathPattern`。

## 真实后端路由

| 方法 | 路径                                                    | 说明                   | 认证     |
| ---- | ------------------------------------------------------- | ---------------------- | -------- |
| POST | `/_matrix/client/v3/search`                             | 全局搜索               | 用户     |
| POST | `/_matrix/vendor/v1/search_recipients`                  | 搜索可作为收件人的用户 | 用户     |
| POST | `/_matrix/vendor/v1/search_rooms`                       | 搜索房间               | 用户     |
| GET  | `/_matrix/client/v1/rooms/{room_id}/context/{event_id}` | 获取事件上下文         | 房间成员 |
| GET  | `/_matrix/client/v1/rooms/{room_id}/hierarchy`          | 获取房间层级           | 房间可见 |
| GET  | `/_matrix/client/v1/rooms/{room_id}/timestamp_to_event` | 时间戳定位事件         | 房间成员 |
| POST | `/_matrix/client/v3/search`                             | 全局搜索               | 用户     |
| POST | `/_matrix/vendor/v1/search_recipients`                  | 搜索可作为收件人的用户 | 用户     |
| POST | `/_matrix/vendor/v1/search_rooms`                       | 搜索房间               | 用户     |
| GET  | `/_matrix/client/v3/rooms/{room_id}/context/{event_id}` | 获取事件上下文         | 房间成员 |
| GET  | `/_matrix/client/v3/rooms/{room_id}/hierarchy`          | 获取房间层级           | 房间可见 |

## SDK 对齐状态

| 路由能力                                  | SDK 入口                         | 方法                                                      | 状态      |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------- | --------- |
| `POST /search`                            | `MatrixClient` / `SearchManager` | `search()` / `searchMessageText()` / `searchRoomEvents()` | ✅ 已封装 |
| `POST /search_rooms`                      | `MatrixClient`                   | `searchRooms()`                                           | ✅ 已封装 |
| `POST /search_recipients`                 | `MatrixClient` / `SearchManager` | `searchRecipients()`                                      | ✅ 已封装 |
| `GET /rooms/{room_id}/context/{event_id}` | `EventManager`                   | `getEventContext()`                                       | ✅ 已封装 |
| `GET /rooms/{room_id}/hierarchy`          | `RoomManager` / `MatrixClient`   | `getRoomHierarchy()`                                      | ✅ 已封装 |
| `GET /rooms/{room_id}/timestamp_to_event` | `MatrixClient`                   | `timestampToEvent()`                                      | ✅ 已封装 |

- **总端点数**: 11
- **已封装**: 11
- **覆盖率**: 100%
- **路径绑定**:
    - `src/client-crypto-requests.ts` 绑定 `POST /search`
    - `src/client-secure-backup-requests.ts` 绑定 `POST /search_rooms` 与 `POST /search_recipients`
- **验证状态**: `spec/unit/search.spec.ts`

## 关键响应口径

```typescript
interface SearchRoomEventsResponse {
    search_categories: {
        room_events?: {
            count: number;
            results: Array<{
                rank?: number;
                result: Record<string, unknown>;
                context?: {
                    events_before: Array<Record<string, unknown>>;
                    events_after: Array<Record<string, unknown>>;
                    profile_info?: Record<string, { displayname?: string; avatar_url?: string }>;
                };
            }>;
            next_batch?: string;
            highlights?: string[];
        };
        users?: {
            results: Array<Record<string, unknown>>;
            limited?: boolean;
        };
    };
}
```

```typescript
interface SearchRecipientsOrRoomsResponse {
    results: unknown[];
    count: number;
    next_batch: string | null;
}
```

补充说明:

- `search_recipients` 与 `search_rooms` 的后端响应都使用 `{ results, count, next_batch }`。
- `/search` 的 `room_events.next_batch` 是基于 `origin_server_ts|event_id` 的游标，不是简单 offset。
- `/rooms/{room_id}/hierarchy` 的 `v1` 与 `v3` 都存在，但 `SDK` 优先走较新的客户端入口实现。

## 常见状态码

| 状态码 | 说明                                   |
| ------ | -------------------------------------- |
| `200`  | 请求成功                               |
| `400`  | 搜索词为空、过滤器超限或请求体格式非法 |
| `401`  | Token 无效或缺失                       |
| `403`  | 无权搜索目标房间或查看用户资料         |
| `404`  | 房间或事件不存在                       |
| `429`  | 触发限流                               |

## 错误语义对齐（BaseManager）

| 场景                   | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                               |
| ---------------------- | -------------------------------------- | ---------------- | ---------------------------------------- |
| 未认证或 token 失效    | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录或刷新凭据                   |
| 搜索条件不合法         | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正 `term`、`limit`、`filter` 后重试    |
| 无权访问目标房间或资料 | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户缺少对应房间成员资格或资料可见性 |
| 上下文房间/事件不存在  | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 提示目标房间或事件已不存在               |
| 限流或短暂服务异常     | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试                             |
| 其他 API 错误          | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底处理     |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                           |
| ------------------ | --------- | ------------------------------ |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失  |
| `M_BAD_JSON`       | `400`     | 请求体结构不符合接口要求       |
| `M_INVALID_PARAM`  | `400`     | 搜索词、过滤器或分页参数非法   |
| `M_FORBIDDEN`      | `403`     | 无权搜索目标房间或查看受限资料 |
| `M_NOT_FOUND`      | `404`     | 请求中的房间或事件不存在       |
| `M_LIMIT_EXCEEDED` | `429`     | 搜索请求触发限流               |

## 变更历史

| 日期       | 变更                                                                                                  | 影响                |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| 2026-05-11 | 按后端 ledger 扩展为 11 条路由口径，新增 `search_recipients` SDK 入口，并补充多入口映射与路径绑定说明 | 修复文档与 SDK 漂移 |

## 实现口径补充（2026-10-17 后端契约回灌）

### 房间内搜索：vendor 路径，归 `room.json`

- 房间内搜索的真实端点是 `POST /_matrix/vendor/v1/rooms/{room_id}/search`，不是 `/_matrix/client/v3/rooms/{room_id}/search`。
- 该路由在 ledger 中 `registered_by: room`，计入 `generated/modules/room.json`；`generated/modules/search.json` 的 `entry_count` 为 **8**，本页既有“11 条”为历史人工口径（含 `v1` / `v3` 双前缀重复计数），此处不改写既有计数与覆盖率。
- SDK 对应入口是 `RoomSummarySearchManager.searchRoom()`（`src/room-summary/sub-managers/room-search-manager.ts`），不是 `MatrixClient.search()`。

### 房间内搜索的请求与响应

- 请求体接受以下写法，按顺序取第一个非空 `search_term`：顶层 `search_term` → `search_categories.room_events.search_term` → `search_categories.room_events.search.term` → `search.term`。
- `limit` 取顶层 `limit`，其次 `search_categories.room_events.filter.limit`，缺省 10、上限 100。
- `search_term` 必填且 `trim()` 后不得为空，否则返回 400。
- 响应固定为 `{"search_categories":{"room_events":{"count":N,"results":[...],"highlights":["<term>"]}}}`；**没有** `next_batch` 与 `groups`，因此该端点不能翻页。
- 房间不存在返回 404；房间存在但调用方无权查看返回 403。

### `POST /search` 请求体

- `search_categories.room_events` 字段：
    - `search_term`：必填，长度上限 256，`trim()` 后不得为空。
    - `keys`：字符串数组，缺省为空。
    - `filter`：`limit`（≤100，缺省 10）、`rooms`（≤50）、`not_rooms`、`types`（≤20）、`not_types`、`senders`（≤50）、`not_senders`。
    - `groupings.group_by[].key`：分组键，可传但不影响当前返回。
    - `order_by`：缺省 `rank`；`recent` 可传，但当前 handler 不据此改变排序，结果 `rank` 固定为 `0.5`。
    - `next_batch`：增量游标，可放在请求体，也可用 query `?next_batch=`；两者同时存在时请求体优先。
- `search_categories.users` 字段：`search_term`（长度上限 256）、`limit`（≤100，缺省 10）。
- `limit` **不在 query 上**：查询串只识别 `next_batch`；房间事件条数请传 `search_categories.room_events.filter.limit`。
- `event_context`（`before_limit` / `after_limit` / `include_profile`）当前被后端忽略，结果不携带 `context`；需要上下文请另行调用 `/rooms/{room_id}/context/{event_id}`。

### `POST /search` 响应形状

- `search_categories.room_events`：`results`（每项为 `{result:{event_id,room_id,sender,type,content,origin_server_ts}, rank:0.5}`）、`count`、`highlights: []`、`state: {"rooms":{}}`、`groups: {"room_id":{},"sender":{}}`、`next_batch`。
- `groups` 恒存在但内容为空对象，按房间/发送者分组尚未实现。
- `next_batch` 是 `origin_server_ts|event_id` 形态的游标，不是 offset；翻页时原样回传。
- `search_categories.users`：`{results, limited}`，`limited` 表示结果数是否已达 `limit`。

### 事件上下文

- `GET /_matrix/client/{v1,v3}/rooms/{room_id}/context/{event_id}`。
- `limit` 是 query 参数，缺省 10、夹在 1..100。
- 响应为 `{event, events_before, events_after, state: [], start, end}`；`start` / `end` 取前后窗口最后一条事件的 `event_id`，窗口为空时回退为目标 `event_id`。
- 仅房间成员可调用（否则 403）；若目标事件早于调用方加入房间，按不存在处理（404）。
