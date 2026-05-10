---
module: oidc
generated_from: docs/api-contract/generated/modules/oidc.json
generated_hash: sha256-c01064777085dec4e1e70a3567b8b1b64cb9dc2e40669c1fa0242895259ec16c
ledger_schema: 1
last_reviewed: 2026-05-03
---

# OIDC 契约

> 审查来源: `synapse-rust/src/web/routes/oidc.rs`

## 真实后端路由

| 方法 | 路径                                         | 说明        | 认证 |
| ---- | -------------------------------------------- | ----------- | ---- |
| GET  | `/_matrix/client/v3/login/sso/redirect/oidc` | OIDC 重定向 | 公开 |
| POST | `/_matrix/client/v3/login/sso/redirect/oidc` | OIDC 重定向 | 公开 |
| GET  | `/_matrix/client/v3/login/oidc/callback`     | OIDC 回调   | 公开 |
| POST | `/_matrix/client/v3/login/oidc/callback`     | OIDC 回调   | 公开 |

## SDK 对齐状态

| 端点                           | SDK Manager   | 方法               | 状态      |
| ------------------------------ | ------------- | ------------------ | --------- |
| `GET /login/sso/redirect/oidc` | `OidcManager` | `getRedirectUrl()` | ✅ 已封装 |
| `POST /login/oidc/callback`    | `OidcManager` | `handleCallback()` | ✅ 已封装 |

## 常见状态码

| 状态码 | 说明                                            |
| ------ | ----------------------------------------------- |
| `200`  | 查询或回调处理成功                              |
| `302`  | 重定向到 OIDC 提供方或登录完成后的目标地址      |
| `400`  | OIDC 未启用、缺少 `code/state` 或请求参数不合法 |
| `401`  | `state` 失效、会话过期或 PKCE 校验失败          |
| `403`  | OIDC 提供方拒绝授权或用户无权完成流程           |
| `429`  | 触发限流                                        |

## 错误语义对齐（BaseManager）

| 场景                       | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                                       |
| -------------------------- | -------------------------------------- | ---------------- | ------------------------------------------------ |
| OIDC 状态失效或会话过期    | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 重新发起授权流程，不复用旧 `state`               |
| 请求参数缺失或 OIDC 未启用 | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 检查 `redirectUrl`、`code`、`state` 与服务端开关 |
| 授权被拒绝或回调校验失败   | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户重新授权，必要时更换账号                 |
| 限流或短暂服务异常         | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试                                     |
| 其他 API 错误              | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底处理             |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                                            |
| ------------------ | --------- | ----------------------------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | OIDC `state` 缺失、已过期或已被消费             |
| `M_BAD_JSON`       | `400`     | 回调参数结构不符合接口要求                      |
| `M_INVALID_PARAM`  | `400`     | `redirectUrl`、`code`、`state` 或 PKCE 参数非法 |
| `M_FORBIDDEN`      | `403`     | 提供方拒绝授权或当前用户不允许完成绑定          |
| `M_LIMIT_EXCEEDED` | `429`     | OIDC 登录链路触发限流                           |
