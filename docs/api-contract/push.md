---
module: push
generated_from: docs/api-contract/generated/modules/push.json
generated_hash: sha256-8530dda47ba6d21aea634e439d499e1106ce281110dc7081bcb71d8ca3168118
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Push 模块契约

> 审查来源: `synapse-rust/src/web/routes/push.rs`、`synapse-rust/src/web/routes/push_rules.rs`
> 审计状态: ✅ PushManager 已覆盖 27 条主路径，并已绑定生成 `PushPathPattern`

## 挂载版本

| 前缀                 | 路由                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `/_matrix/client/r0` | `pushers` `pushers/set` `pushrules*` `notifications*`                |
| `/_matrix/client/v3` | `pushers` `pushers/set` `pushrules*` `notifications*`                |
| `/_matrix/client/v3` | 额外支持 `/pushrules/{scope}/{kind}/{rule_id}/actions` 与 `/enabled` |

## Pushers

| 方法 | 路径                                  | 主要请求参数                                                                                            | 主要响应字段           |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| GET  | `/_matrix/client/{r0,v3}/pushers`     | 无                                                                                                      | `{ "pushers": [...] }` |
| POST | `/_matrix/client/{r0,v3}/pushers`     | `pushkey` `kind` `app_id` `app_display_name` `device_display_name` `device_id` `lang` `data?` `append?` | 空对象                 |
| POST | `/_matrix/client/{r0,v3}/pushers/set` | 同上，`kind: null` 时删除；**device_id 必填（P2 #32 鉴权要求）**                                        | 空对象                 |

## Push Rules

| 方法   | 路径                                                            | 主要请求参数                                          | 主要响应字段                |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| GET    | `/_matrix/client/v3/pushrules/`                                 | 无                                                    | 默认 push rule 集合         |
| GET    | `/_matrix/client/v3/pushrules/global/`                          | 无                                                    | 默认 global 规则集合        |
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

## 字段级响应审计

- `GET /pushers` 返回 `{ "pushers": IPusher[] }`，列表项字段为 `pushkey`、`kind`、`app_id`、`app_display_name`、`device_display_name`、`profile_tag?`、`lang`、`data?`、`enabled?`、`device_id?`
- `POST /pushers` 与 `POST /pushers/set` 成功返回空对象；当 `kind: null` 时语义为删除 pusher
- `GET /pushrules` 返回 `IPushRules`，顶层字段为 `global`、`device?`；每个 scope 下按 `override`、`content`、`room`、`sender`、`underride` 分组
- `GET /pushrules/{scope}` 返回 `IPushRuleSet`，字段为 `override?`、`content?`、`room?`、`sender?`、`underride?`
- `GET /pushrules/{scope}/{kind}` 返回按 kind 分组的规则数组对象；SDK 当前以 `{ [key: string]: IPushRule[] }` 接收，实际稳定键仍受 `kind` 取值约束
- `GET /pushrules/{scope}/{kind}/{rule_id}` 返回 `IPushRule`，字段为 `rule_id`、`default`、`enabled`、`actions`、`pattern?`、`conditions?`
- `GET /pushrules/{scope}/{kind}/{rule_id}/enabled` 返回 `{ "enabled": true/false }`
- `PUT /pushrules/{scope}/{kind}/{rule_id}/enabled`、`PUT /pushrules/{scope}/{kind}/{rule_id}/actions`、`POST|PUT|DELETE /pushrules/{scope}/{kind}/{rule_id}` 成功时均不要求响应体，SDK 以成功状态码作为完成信号
- `/_matrix/client/v3/pushrules/` 与 `/pushrules/global/` 返回用户规则；若用户未写入 `m.push_rules`，则回退到内置默认规则

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

## SDK 对齐结论

- `src/push/index.ts` 现已将 `pushers`、`pushrules` 相关主路径绑定到生成的 `PushPathPattern`。
- `PushManager` 统一使用 `/_matrix/client/v3` 作为默认主链路；`r0` 兼容别名由后端共享处理器承接，不再视为单独 SDK 缺口。
- `getPushers()`、`setPusher()`、`getPushRules()`、`getPushRulesByScope()`、`getPushRulesByKind()`、`getPushRule()`、
  `createPushRule()`、`updatePushRule()`、`deletePushRule()`、`getPushRuleEnabled()`、`setPushRuleEnabled()`、
  `setPushRuleActions()` 均已受 codegen 路径模板约束。
- `muteRoom()`、`unmuteRoom()`、`addKeywordHighlight()`、`ignoreSender()` 等便捷方法继续复用上述 REST 主路径，不额外引入未审计的接口面。
- **v10 对齐 (2026-06-09)**: `setPusher()` 新增 `device_id` 必填校验（P2 #32），缺少时抛出 `InvalidParamError`；`IPusherRequest` 新增 `device_id?: string` 字段。

## 覆盖率口径

- **Ledger 契约端点数**: 25
- **SDK 主路径覆盖**: 25/25
- **已绑定生成路由模板**: 25/25
- **契约覆盖率**: 100%

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/push.rs`
