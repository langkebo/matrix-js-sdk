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
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary`                           | 获取房间摘要     |
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/members`                   | 获取摘要成员     |
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/state`                     | 获取摘要状态     |
| GET    | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/stats`                     | 获取摘要统计     |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary`                                | 创建或刷新摘要   |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/summary`                                | 更新摘要         |
| DELETE | `/_matrix/client/v3/rooms/{room_id}/summary`                                | 删除摘要         |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/sync`                           | 同步摘要         |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/members`                        | 批量写入成员摘要 |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/summary/members/{user_id}`              | 更新单成员摘要   |
| DELETE | `/_matrix/client/v3/rooms/{room_id}/summary/members/{user_id}`              | 删除单成员摘要   |
| GET    | `/_matrix/client/v3/rooms/{room_id}/summary/state/{event_type}/{state_key}` | 获取特定状态摘要 |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/summary/state/{event_type}/{state_key}` | 更新特定状态摘要 |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/stats/recalculate`              | 重算统计         |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/heroes/recalculate`             | 重算 heroes      |
| POST   | `/_matrix/client/v3/rooms/{room_id}/summary/unread/clear`                   | 清理未读摘要     |

## 内部路由

| 方法 | 路径                                        | 说明                  |
| ---- | ------------------------------------------- | --------------------- |
| GET  | `/_synapse/room_summary/v1/summaries`       | 获取用户摘要列表      |
| POST | `/_synapse/room_summary/v1/summaries`       | 创建内部 room summary |
| POST | `/_synapse/room_summary/v1/updates/process` | 处理待更新摘要        |

## 响应形态

- 读取类接口返回 summary、members、state、stats 等 JSON 对象
- 维护类接口通常返回空对象或更新结果
- 内部列表接口返回用户相关的 summary 集合

## 认证与状态码

- 客户端路由默认需要用户认证
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
