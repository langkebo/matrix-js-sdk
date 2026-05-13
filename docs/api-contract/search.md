---
module: search
generated_from: docs/api-contract/generated/modules/search.json
generated_hash: sha256-b5162a8d0dd22ff1321367cecf211b7d35bf90dd9d1143b3e7d8cdcef9bfa348
ledger_schema: 1
last_reviewed: 2026-05-11
---

# 搜索契约

> 审查来源: `synapse-rust/src/web/routes/handlers/search.rs`
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

| 方法 | 路径                        | 说明     | 认证 |
| ---- | --------------------------- | -------- | ---- |
| POST | `/_matrix/client/r0/search` | 全局搜索 | 用户 |
| POST | `/_matrix/client/r0/search_recipients` | 搜索可作为收件人的用户 | 用户 |
| POST | `/_matrix/client/r0/search_rooms` | 搜索房间 | 用户 |
| GET  | `/_matrix/client/v1/rooms/{room_id}/context/{event_id}` | 获取事件上下文 | 房间成员 |
| GET  | `/_matrix/client/v1/rooms/{room_id}/hierarchy` | 获取房间层级 | 房间可见 |
| GET  | `/_matrix/client/v1/rooms/{room_id}/timestamp_to_event` | 时间戳定位事件 | 房间成员 |
| POST | `/_matrix/client/v3/search` | 全局搜索 | 用户 |
| POST | `/_matrix/client/v3/search_recipients` | 搜索可作为收件人的用户 | 用户 |
| POST | `/_matrix/client/v3/search_rooms` | 搜索房间 | 用户 |
| GET  | `/_matrix/client/v3/rooms/{room_id}/context/{event_id}` | 获取事件上下文 | 房间成员 |
| GET  | `/_matrix/client/v3/rooms/{room_id}/hierarchy` | 获取房间层级 | 房间可见 |

## SDK 对齐状态

| 路由能力 | SDK 入口 | 方法 | 状态 |
| -------- | -------- | ---- | ---- |
| `POST /search` | `MatrixClient` / `SearchManager` | `search()` / `searchMessageText()` / `searchRoomEvents()` | ✅ 已封装 |
| `POST /search_rooms` | `MatrixClient` | `searchRooms()` | ✅ 已封装 |
| `POST /search_recipients` | `MatrixClient` / `SearchManager` | `searchRecipients()` | ✅ 已封装 |
| `GET /rooms/{room_id}/context/{event_id}` | `EventManager` | `getEventContext()` | ✅ 已封装 |
| `GET /rooms/{room_id}/hierarchy` | `RoomManager` / `MatrixClient` | `getRoomHierarchy()` | ✅ 已封装 |
| `GET /rooms/{room_id}/timestamp_to_event` | `MatrixClient` | `timestampToEvent()` | ✅ 已封装 |

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

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-05-11 | 按后端 ledger 扩展为 11 条路由口径，新增 `search_recipients` SDK 入口，并补充多入口映射与路径绑定说明 | 修复文档与 SDK 漂移 |
