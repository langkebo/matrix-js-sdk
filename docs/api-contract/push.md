# Push 模块契约

> 审查来源: `synapse-rust/src/web/routes/push.rs`

## 挂载版本

| 前缀                 | 路由                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `/_matrix/client/r0` | `pushers` `pushers/set` `pushrules*` `notifications*`                |
| `/_matrix/client/v3` | `pushers` `pushers/set` `pushrules*` `notifications*`                |
| `/_matrix/client/v3` | 额外支持 `/pushrules/{scope}/{kind}/{rule_id}/actions` 与 `/enabled` |

## Pushers

| 方法 | 路径                                  | 主要请求参数                                                                                | 主要响应字段           |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------- |
| GET  | `/_matrix/client/{r0,v3}/pushers`     | 无                                                                                          | `{ "pushers": [...] }` |
| POST | `/_matrix/client/{r0,v3}/pushers`     | `pushkey` `kind` `app_id` `app_display_name` `device_display_name` `lang` `data?` `append?` | 空对象                 |
| POST | `/_matrix/client/{r0,v3}/pushers/set` | 同上，`kind: null` 时删除                                                                   | 空对象                 |

## Push Rules

| 方法   | 路径                                                            | 主要请求参数                                          | 主要响应字段                |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| GET    | `/_matrix/client/{r0,v3}/pushrules`                             | 无                                                    | 完整 push rule 集合         |
| GET    | `/_matrix/client/{r0,v3}/pushrules/{scope}`                     | `scope`                                               | scope 级规则                |
| GET    | `/_matrix/client/{r0,v3}/pushrules/{scope}/{kind}`              | `scope` `kind`                                        | kind 级规则列表             |
| GET    | `/_matrix/client/{r0,v3}/pushrules/{scope}/{kind}/{rule_id}`    | 路径参数                                              | 单条规则                    |
| POST   | `/_matrix/client/{r0,v3}/pushrules/{scope}/{kind}/{rule_id}`    | `actions` `conditions?` `pattern?` `before?` `after?` | 空对象                      |
| PUT    | `/_matrix/client/{r0,v3}/pushrules/{scope}/{kind}/{rule_id}`    | `actions` `conditions?` `pattern?`                    | 空对象                      |
| DELETE | `/_matrix/client/{r0,v3}/pushrules/{scope}/{kind}/{rule_id}`    | 路径参数                                              | 空对象                      |
| PUT    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/actions` | `actions` 数组或对象                                  | 空对象                      |
| GET    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/enabled` | 路径参数                                              | `{ "enabled": true/false }` |
| PUT    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/enabled` | `{ "enabled": boolean }`                              | 空对象                      |

## Notifications

| 方法 | 路径                                                          | 主要请求参数             | 主要响应字段                                     |
| ---- | ------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| GET  | `/_matrix/client/{r0,v3}/notifications`                       | `limit?` `from?` `only?` | `{ "notifications": [...], "next_token": null }` |
| POST | `/_matrix/client/{r0,v3}/notifications/{notification_id}/ack` | `notification_id`        | 空对象                                           |

## 已知稳定字段

- Pusher 列表项: `pushkey` `kind` `app_id` `app_display_name` `device_display_name` `profile_tag` `lang` `data`
- Push rule: `rule_id` `default` `enabled` `pattern?` `conditions?` `actions`
- Notification: `event_id` `room_id` `ts` `profile_tag` `read`

## 常见状态码

| 状态码 | 说明             |
| ------ | ---------------- |
| `200`  | 请求成功         |
| `400`  | 请求体不合法     |
| `401`  | Token 无效或缺失 |
| `404`  | 规则或通知不存在 |

## 错误语义对齐（BaseManager）

| 场景                | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                               |
| ------------------- | -------------------------------------- | ---------------- | ---------------------------------------- |
| 未认证或 token 失效 | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 触发登录态恢复流程，不继续提交规则写入   |
| 规则或通知不存在    | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 视为目标已不存在，刷新本地规则快照       |
| 参数或规则定义非法  | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正 `actions/conditions/pattern` 后重试 |
| 无权限修改目标规则  | `403` / `M_FORBIDDEN`                  | `ApiError`       | 终止重试并提示权限不足                   |
| 限流或短暂服务异常  | `429` / `M_LIMIT_EXCEEDED`，`5xx`      | `RetryableError` | 使用指数退避重试                         |
| 其他 API 错误       | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 处理兜底       |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                             |
| ------------------ | --------- | -------------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失    |
| `M_NOT_FOUND`      | `404`     | push rule 或 notification 不存在 |
| `M_FORBIDDEN`      | `403`     | 无权限写入或删除规则             |
| `M_BAD_JSON`       | `400`     | 请求体结构不合法                 |
| `M_INVALID_PARAM`  | `400`     | 参数取值非法或规则字段冲突       |
| `M_LIMIT_EXCEEDED` | `429`     | 触发限流                         |

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/push.rs`
