# Space 模块契约

> 审查来源: `synapse-rust/src/web/routes/space.rs`

## 挂载版本

| 前缀                 | 说明                             |
| -------------------- | -------------------------------- |
| `/_matrix/client/v1` | 与 `r0/v3` 使用同一组 space 路由 |
| `/_matrix/client/r0` | 与 `v1/v3` 使用同一组 space 路由 |
| `/_matrix/client/v3` | 与 `v1/r0` 使用同一组 space 路由 |

## Space 端点

| 方法   | 路径                                                                 | 主要请求参数                                                                                        | 主要响应字段              |
| ------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| POST   | `/_matrix/client/{v1,r0,v3}/spaces`                                  | `room_id` `name?` `topic?` `avatar_url?` `join_rule?` `visibility?` `is_public?` `parent_space_id?` | 创建结果                  |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/public`                           | 查询参数                                                                                            | 公开 space 列表           |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/search`                           | 查询参数                                                                                            | 搜索结果                  |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/statistics`                       | 无                                                                                                  | 统计信息                  |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/user`                             | 无                                                                                                  | 当前用户可见的 space 列表 |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}`                       | `space_id`                                                                                          | space 对象                |
| PUT    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}`                       | 更新 body                                                                                           | 更新后的 space / 空对象   |
| DELETE | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}`                       | `space_id`                                                                                          | 空对象                    |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/children`              | 查询参数                                                                                            | 子房间列表                |
| POST   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/children`              | `room_id` `via_servers?` `order?` `suggested?`                                                      | 空对象                    |
| DELETE | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/children/{room_id}`    | 路径参数                                                                                            | 空对象                    |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/members`               | 查询参数                                                                                            | 成员列表                  |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/rooms`                 | 查询参数                                                                                            | room 列表                 |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/state`                 | 无                                                                                                  | state 快照                |
| POST   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/invite`                | `user_id` 等                                                                                        | 空对象                    |
| POST   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/join`                  | join body                                                                                           | 空对象 / `room_id`        |
| POST   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/leave`                 | leave body                                                                                          | 空对象                    |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/hierarchy`             | `from?` `limit?` `max_depth?` `suggested_only?`                                                     | hierarchy 响应            |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/hierarchy/v1`          | 同上                                                                                                | hierarchy v1 响应         |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/summary`               | 查询参数                                                                                            | summary                   |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/summary/with_children` | 查询参数                                                                                            | summary + children        |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/tree_path`             | 查询参数                                                                                            | tree path                 |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/room/{room_id}`                   | `room_id`                                                                                           | room 对应的 space         |
| GET    | `/_matrix/client/{v1,r0,v3}/spaces/room/{room_id}/parents`           | `room_id`                                                                                           | parent spaces             |

## 认证与状态码

- 默认需要用户 access token。
- 常见错误码: `400` 参数错误、`401` 未认证、`403` 无权限、`404` space/room 不存在。

## 错误语义对齐（BaseManager）

| 场景                | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                               |
| ------------------- | -------------------------------------- | ---------------- | ---------------------------------------- |
| 未认证或 token 失效 | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 触发登录态恢复，不继续执行空间写操作     |
| space/room 不存在   | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 视为目标已失效，刷新空间树并中止当前流程 |
| 无权限访问或修改    | `403` / `M_FORBIDDEN`                  | `ApiError`       | 终止重试并提示权限不足                   |
| 参数非法            | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正请求参数后重试                       |
| 限流或短暂服务异常  | `429` / `M_LIMIT_EXCEEDED`，`5xx`      | `RetryableError` | 使用指数退避重试                         |
| 其他 API 错误       | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 统一兜底       |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                          |
| ------------------ | --------- | ----------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失 |
| `M_NOT_FOUND`      | `404`     | 目标 space/room 不存在        |
| `M_FORBIDDEN`      | `403`     | 无权限进行读取或写入          |
| `M_BAD_JSON`       | `400`     | body 结构不合法               |
| `M_INVALID_PARAM`  | `400`     | 路径参数或查询参数非法        |
| `M_LIMIT_EXCEEDED` | `429`     | 触发限流                      |

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/space.rs`
