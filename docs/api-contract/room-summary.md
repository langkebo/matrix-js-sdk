# Room Summary 模块契约

> 审查来源: `synapse-rust/src/web/routes/room_summary.rs`

## 挂载版本

| 前缀                        | 说明                   |
| --------------------------- | ---------------------- |
| `/_matrix/client/r0`        | 只读 summary 路由      |
| `/_matrix/client/v3`        | 读写与维护路由         |
| `/_synapse/room_summary/v1` | 内部汇总与更新处理接口 |

## 客户端路由

| 方法   | 路径                                                                        | 说明             |
| ------ | --------------------------------------------------------------------------- | ---------------- |
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary`                           | 获取房间摘要；要求调用方为房间成员或管理员，越权返回 `403`     |
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/members`                   | 获取摘要成员；要求调用方为房间成员或管理员，越权返回 `403`     |
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/state`                     | 获取摘要状态；要求调用方为房间成员或管理员，越权返回 `403`     |
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/stats`                     | 获取摘要统计；要求调用方为房间成员或管理员，越权返回 `403`     |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary`                                | 创建或刷新摘要；要求调用方为房间成员或管理员，越权返回 `403`   |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/summary`                                | 更新摘要；要求调用方为房间成员或管理员，越权返回 `403`         |
| DELETE | `/_matrix/client/v3/rooms/{room_id}/summary`                                | 删除摘要；要求调用方为房间成员或管理员，越权返回 `403`         |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/sync`                           | 同步摘要；要求调用方为房间成员或管理员，越权返回 `403`         |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/members`                        | 批量写入成员摘要；要求调用方为房间成员或管理员，越权返回 `403` |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/summary/members/{user_id}`              | 更新单成员摘要；要求调用方为房间成员或管理员，越权返回 `403`   |
| DELETE | `/_matrix/client/v3/rooms/{room_id}/summary/members/{user_id}`              | 删除单成员摘要；要求调用方为房间成员或管理员，越权返回 `403`   |
| GET    | `/_matrix/client/v3/rooms/{room_id}/summary/state/{event_type}/{state_key}` | 获取特定状态摘要；要求调用方为房间成员或管理员，越权返回 `403` |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/summary/state/{event_type}/{state_key}` | 更新特定状态摘要；要求调用方为房间成员或管理员，越权返回 `403` |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/stats/recalculate`              | 重算统计；要求调用方为房间成员或管理员，越权返回 `403`         |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/heroes/recalculate`             | 重算 heroes；要求调用方为房间成员或管理员，越权返回 `403`      |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/unread/clear`                   | 清理未读摘要；要求调用方为房间成员或管理员，越权返回 `403`     |

## 内部路由

| 方法 | 路径                                        | 说明                  |
| ---- | ------------------------------------------- | --------------------- |
| GET  | `/_synapse/room_summary/v1/summaries`       | 获取用户摘要列表      |
| POST | `/_synapse/room_summary/v1/summaries`       | 创建内部 room summary |
| POST | `/_synapse/room_summary/v1/updates/process` | 处理待更新摘要        |

## 字段级响应审计

- `GET /rooms/{room_id}/summary` 与 `POST|PUT /rooms/{room_id}/summary` 返回 `RoomSummary`，字段包括 `room_id`、`room_type?`、`name?`、`topic?`、`avatar_url?`、`canonical_alias?`、`join_rule`、`history_visibility`、`guest_access`、`is_direct`、`is_space`、`is_encrypted`、`member_count`、`joined_member_count`、`invited_member_count`、`heroes`、`last_event_ts?`、`last_message_ts?`
- `RoomSummary.heroes[]` 项稳定字段为 `user_id`、`display_name?`、`avatar_url?`
- `GET /rooms/{room_id}/summary/members` 与 `POST /rooms/{room_id}/summary/members` 返回成员数组，列表项字段为 `user_id`、`display_name?`、`avatar_url?`、`membership`、`is_hero`
- `PUT /rooms/{room_id}/summary/members/{user_id}` 返回更新后的单成员对象；SDK 以 `Record<string, unknown>` 接收，因此除上述稳定字段外，其余 service 透传字段不在契约中承诺
- `GET /rooms/{room_id}/summary/stats` 与 `POST /rooms/{room_id}/summary/stats/recalculate` 返回 `RoomStats`，字段包括 `room_id`、`total_events`、`total_state_events`、`total_messages`、`total_media`、`storage_size`
- `GET /rooms/{room_id}/summary/state` 返回 `IRoomSummaryState[]`，每项字段为 `event_type`、`state_key`、`event_id`、`content`
- `GET|PUT /rooms/{room_id}/summary/state/{event_type}/{state_key}` 返回单个 `content` 对象；其内部键由对应 state event 决定，SDK 仅以 `Record<string, unknown>` 承接
- `POST /rooms/{room_id}/summary/sync`、`POST /rooms/{room_id}/summary/heroes/recalculate`、`POST /rooms/{room_id}/summary/unread/clear`、`POST /_synapse/room_summary/v1/summaries`、`POST /_synapse/room_summary/v1/updates/process` 均返回 service 结果对象，SDK 当前以 `Record<string, unknown>` 接收，契约层只保证“返回 JSON 对象”
- `GET /_synapse/room_summary/v1/summaries` 现返回 `RoomSummaryListResponse`，稳定字段为 `summaries`、`rooms`、`chunk`、`next_batch?`；其中列表项沿用 `RoomSummary` 字段集。SDK `listUserSummaries()` 仍兼容历史 `RoomSummary[]` 裸数组响应
- `DELETE /rooms/{room_id}/summary` 与 `DELETE /rooms/{room_id}/summary/members/{user_id}` 成功时不要求响应体，SDK 仅以成功状态码作为完成信号

## 认证与状态码

- 客户端路由默认需要用户认证
- 所有 `/_matrix/client/{r0,v3}/rooms/{room_id}/summary*` 路由现统一要求调用方为目标房间成员或管理员；非成员越权读取、刷新、重算、清理未读或写入摘要均返回 `403 M_FORBIDDEN`
- 内部 `/_synapse/room_summary/v1/*` 路由由当前服务内部逻辑使用
- 常见状态码: `200` `400` `401` `404`

## 错误语义对齐（BaseManager）

| 场景                   | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                         |
| ---------------------- | -------------------------------------- | ---------------- | ---------------------------------- |
| 未认证或 token 失效    | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 触发登录态恢复，不重试写入类接口   |
| 房间或摘要不存在       | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 视为目标缺失，触发重建或跳过       |
| 请求参数或摘要结构非法 | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正 payload 后重试                |
| 无权限访问摘要         | `403` / `M_FORBIDDEN`                  | `ApiError`       | 终止重试并提示权限不足             |
| 限流或短暂服务异常     | `429` / `M_LIMIT_EXCEEDED`，`5xx`      | `RetryableError` | 指数退避重试读写请求               |
| 其他 API 错误          | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 统一处理 |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                          |
| ------------------ | --------- | ----------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失 |
| `M_NOT_FOUND`      | `404`     | room summary 或成员摘要不存在 |
| `M_FORBIDDEN`      | `403`     | 无权限读取或更新目标摘要      |
| `M_BAD_JSON`       | `400`     | 请求体结构不合法              |
| `M_INVALID_PARAM`  | `400`     | path/query/body 参数非法      |
| `M_LIMIT_EXCEEDED` | `429`     | 触发限流                      |

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/room_summary.rs`
- `RoomSummaryManager` 还额外封装了 `synapse-rust/src/web/routes/handlers/room.rs` 中的 `GET /rooms/{room_id}/thread/{event_id}` 与 `GET /rooms/{room_id}/threads/{thread_id}`；这两条线程读取接口不属于本页 summary 路由族，且响应结构彼此不同。
