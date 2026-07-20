---
module: oidc
generated_from: docs/api-contract/generated/modules/oidc.json
generated_hash: sha256-29464a108bbbfe3af647f0a1cce70835535e6d431f7e84714424122fec7f5c1e
ledger_schema: 1
last_reviewed: 2026-05-03
---

# OIDC 契约

> 审查来源: `synapse-rust/src/web/routes/oidc.rs`

## 真实后端路由

| 方法 | 路径                                    | 说明              | 认证 |
| ---- | --------------------------------------- | ----------------- | ---- |
| GET  | `/.well-known/openid-configuration`     | OIDC discovery    | 公开 |
| GET  | `/.well-known/jwks.json`                | JWKS 公钥集合     | 公开 |
| GET  | `/_matrix/client/r0/login/sso/redirect` | r0 SSO 重定向     | 公开 |
| GET  | `/_matrix/client/r0/login/sso/userinfo` | r0 SSO 用户信息   | 用户 |
| GET  | `/_matrix/client/r0/oidc/authorize`     | r0 授权端点       | 公开 |
| GET  | `/_matrix/client/r0/oidc/callback`      | r0 回调端点       | 公开 |
| POST | `/_matrix/client/r0/oidc/logout`        | r0 登出端点       | 用户 |
| POST | `/_matrix/client/r0/oidc/register`      | r0 动态客户端注册 | 公开 |
| POST | `/_matrix/client/r0/oidc/token`         | r0 令牌端点       | 公开 |
| GET  | `/_matrix/client/r0/oidc/userinfo`      | r0 userinfo       | 用户 |
| GET  | `/_matrix/client/v3/login/sso/redirect` | v3 SSO 重定向     | 公开 |
| GET  | `/_matrix/client/v3/login/sso/userinfo` | v3 SSO 用户信息   | 用户 |
| GET  | `/_matrix/client/v3/oidc/authorize`     | v3 授权端点       | 公开 |
| GET  | `/_matrix/client/v3/oidc/callback`      | v3 回调端点       | 公开 |
| POST | `/_matrix/client/v3/oidc/login`         | 内置 OIDC 登录    | 公开 |
| POST | `/_matrix/client/v3/oidc/logout`        | v3 登出端点       | 用户 |
| POST | `/_matrix/client/v3/oidc/register`      | v3 动态客户端注册 | 公开 |
| POST | `/_matrix/client/v3/oidc/token`         | v3 令牌端点       | 公开 |
| GET  | `/_matrix/client/v3/oidc/userinfo`      | v3 userinfo       | 用户 |

## SDK 对齐状态

| 端点                                    | SDK Manager   | 方法                         | 状态          |
| --------------------------------------- | ------------- | ---------------------------- | ------------- |
| `GET /.well-known/openid-configuration` | `OidcManager` | `discover()`                 | ✅            |
| `GET /.well-known/jwks.json`            | `OidcManager` | `getJwks()`                  | ✅            |
| `GET /v3/oidc/authorize`                | `OidcManager` | `authorize()`                | ✅            |
| `GET /v3/oidc/callback`                 | `OidcManager` | `buildCallbackUrl()`         | ✅ URL helper |
| `POST /v3/oidc/register`                | `OidcManager` | `registerClient()`           | ✅            |
| `POST /v3/oidc/token`                   | `OidcManager` | `token()` / `refreshToken()` | ✅            |
| `GET /v3/oidc/userinfo`                 | `OidcManager` | `getUserInfo()`              | ✅            |
| `POST /v3/oidc/logout`                  | `OidcManager` | `logout()`                   | ✅            |
| `POST /v3/oidc/login`                   | `OidcManager` | `builtinLogin()`             | ✅            |
| `GET /v3/login/sso/redirect`            | `OidcManager` | `ssoRedirect()`              | ✅            |
| `GET /v3/login/sso/userinfo`            | `OidcManager` | `ssoUserInfo()`              | ✅            |

## 覆盖率口径

- **后端 Ledger 路由总数**: 19
- **SDK 已封装路由数**: 11 (主干端点与 URL helpers)
- **已绑定生成路由模板**: 11
- **契约覆盖率**: 100%
- **说明**:
    - `OidcManager` 选择 `v3` 作为 canonical 封装面。
    - 后端保留的 8 条 `r0` 路径（如 `POST /r0/oidc/token`）在逻辑上与 `v3` 完全一致，SDK 统一采用 `v3` 封装，视为逻辑覆盖 100%。
    - `callback` 端点主要由浏览器跳转触发，SDK 通过 `buildCallbackUrl()` 提供 URL 构造能力。

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

## DTO Definitions

> Source: `src/oidc/__generated__/dto.ts`

```typescript
export interface OidcWellKnownResponse {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint?: string;
    jwks_uri?: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
    response_types_supported?: string[];
    code_challenge_methods_supported?: string[];
    revocation_endpoint?: string;
    grant_types_supported?: string[];
    account_management_uri?: string;
    account_management_actions_supported?: string[];
    prompt_values_supported?: string[];
    device_authorization_endpoint?: string;
}
export interface OidcJwks {
    keys: Array<{ kty: string; kid: string; use?: string; alg?: string; n?: string; e?: string }>;
}
export interface OidcAuthRequest {
    client_id: string;
    redirect_uri: string;
    response_type: string;
    scope: string;
    state?: string;
    nonce?: string;
    code_challenge?: string;
    code_challenge_method?: string;
}
export interface OidcAuthResponse {
    url?: string;
    code?: string;
}
export interface OidcTokenRequest {
    grant_type: string;
    code?: string;
    redirect_uri?: string;
    code_verifier?: string;
    refresh_token?: string;
    client_id?: string;
    client_secret?: string;
}
export interface OidcTokenResponse {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    token_type: string;
    expires_in: number;
}
export interface OidcUserInfoResponse {
    sub: string;
    name?: string;
    picture?: string;
    email?: string;
}
export interface OidcRegisterRequest {
    client_name?: string;
    redirect_uris: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
}
export interface OidcClientRegistration {
    client_id: string;
    client_secret?: string;
    client_name?: string;
    redirect_uris: string[];
}
export interface OidcLoginRequest {
    client_id: string;
    redirect_uri: string;
    scope?: string;
    state?: string;
    nonce?: string;
    code_verifier?: string;
    username: string;
    password: string;
}
export interface OidcLoginResponse {
    code: string;
}
export interface OidcLogoutRequest {
    client_id?: string;
    post_logout_redirect_uri?: string;
    id_token_hint?: string;
}
export interface OidcCallbackRequest {
    code: string;
    state: string;
}
export interface SsoRedirectResponse {
    url: string;
}
```
