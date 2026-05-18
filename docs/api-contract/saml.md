---
module: saml
generated_from: docs/api-contract/generated/modules/saml.json
generated_hash: sha256-76c266331906dbbdc7960a333ac51b6eda3f2f63b8866a9971234561111d72b5
ledger_schema: 1
last_reviewed: 2026-05-03
---

# SAML 契约

> 审查来源: `synapse-rust/src/web/routes/saml.rs`

## 真实后端路由

### 公共 SSO 流程（浏览器重定向消费）

| 方法 | 路径                                         | 说明           | 认证 |
| ---- | -------------------------------------------- | -------------- | ---- |
| GET  | `/_matrix/client/r0/login/sso/redirect/saml` | SSO 重定向     | 公开 |
| POST | `/_matrix/client/r0/login/sso/redirect/saml` | SSO 重定向     | 公开 |
| GET  | `/_matrix/client/r0/login/saml/callback`     | SAML 回调      | 公开 |
| POST | `/_matrix/client/r0/login/saml/callback`     | SAML 回调      | 公开 |
| GET  | `/_matrix/client/r0/logout/saml`             | SAML 登出      | 公开 |
| GET  | `/_matrix/client/r0/logout/saml/callback`    | SAML 登出回调  | 公开 |
| GET  | `/_matrix/client/r0/saml/metadata`           | SAML 元数据    | 公开 |
| GET  | `/_matrix/client/r0/saml/sp_metadata`        | SAML SP 元数据 | 公开 |

### 管理端点（需要管理员 access token）

所有路径都挂在 `admin_auth_middleware` 之下，且受 `state.services.saml_service.is_enabled()` 门控——
未启用 SAML 的部署下整组路由不会被挂载。

| 方法   | 路径                                                | 说明                           |
| ------ | --------------------------------------------------- | ------------------------------ |
| POST   | `/_synapse/admin/v1/saml/metadata/refresh`          | 强制刷新 IdP 元数据            |
| GET    | `/_synapse/admin/v1/saml/config`                    | 读取生效 SAML 配置（脱敏）     |
| PUT    | `/_synapse/admin/v1/saml/config`                    | 应用运行时覆盖（白名单字段）   |
| GET    | `/_synapse/admin/v1/saml/mappings`                  | 分页列出 name_id → user 映射   |
| GET    | `/_synapse/admin/v1/saml/mapping/{name_id}`         | 读取单条映射（跨 issuer 首命中） |
| PUT    | `/_synapse/admin/v1/saml/mapping/{name_id}`         | 更新 user_id / attributes      |
| DELETE | `/_synapse/admin/v1/saml/mapping/{name_id}`         | 删除所有 issuer 下匹配项       |
| POST   | `/_synapse/admin/v1/saml/logout`                    | 管理员发起 SLO（body: user_id） |

## SDK 对齐状态

| 端点                                              | SDK Manager        | 方法                      | 状态      |
| ------------------------------------------------- | ------------------ | ------------------------- | --------- |
| `POST /login/sso/redirect/saml`                   | `SamlAuthManager`  | `initiateLogin()`         | ✅ 已封装 |
| `POST /login/saml/callback`                       | `SamlAuthManager`  | `handleCallback()`        | ✅ 已封装 |
| `GET /logout/saml`                                | `SamlAuthManager`  | `logout()`                | ✅ 已封装 |
| `GET /logout/saml/callback`                       | `SamlAuthManager`  | `handleLogoutCallback()`  | ✅ 已封装 |
| `GET /saml/metadata`                              | `SamlAuthManager`  | `getIdpMetadata()`        | ✅ 已封装 |
| `GET /saml/sp_metadata`                           | `SamlAuthManager`  | `getSpMetadata()`         | ✅ 已封装 |
| `POST /_synapse/admin/v1/saml/metadata/refresh`   | `SamlAuthManager`  | `refreshMetadata()`       | ✅ 已封装 |
| `GET /_synapse/admin/v1/saml/config`              | `SamlAuthManager`  | `getConfig()`             | ✅ 已封装 |
| `PUT /_synapse/admin/v1/saml/config`              | `SamlAuthManager`  | `updateConfig()`          | ✅ 已封装 |
| `GET /_synapse/admin/v1/saml/mappings`            | `SamlAuthManager`  | `getUserMappings()`       | ✅ 已封装 |
| `GET /_synapse/admin/v1/saml/mapping/{name_id}`   | `SamlAuthManager`  | `getUserMapping()`        | ✅ 已封装 |
| `PUT /_synapse/admin/v1/saml/mapping/{name_id}`   | `SamlAuthManager`  | `updateUserMapping()`     | ✅ 已封装 |
| `DELETE /_synapse/admin/v1/saml/mapping/{name_id}`| `SamlAuthManager`  | `removeUserMapping()`     | ✅ 已封装 |
| `POST /_synapse/admin/v1/saml/logout`             | `SamlAuthManager`  | `adminLogout()`           | ✅ 已封装 |

## 覆盖率口径

- **后端 Ledger 路由总数**: 16
- **SDK 已封装路由数**: 16
- **已绑定生成路由模板**: 16
- **契约覆盖率**: 100%

### 运行时配置覆盖白名单

`PUT /saml/config` 接受的字段（由 `SamlService::MUTABLE_CONFIG_FIELDS` 定义）：
`enabled`、`metadata_url`、`attribute_mapping`、`nameid_format`、`allow_existing_users`、
`block_unknown_users`、`user_id_template`、`use_name_id_for_user_id`、`sign_requests`、
`want_response_signed`、`want_assertions_signed`、`want_assertions_encrypted`、
`authn_context_class_ref`、`session_lifetime`、`metadata_refresh_interval`、
`allowed_idp_entity_ids`、`timeout`、`sp_entity_id`、`sp_acs_url`、`sp_sls_url`。

> 白名单外的字段（特别是 `sp_private_key*`、`sp_certificate*`）会被后端 400 拒绝，
> 这些材料需要通过重启 + `homeserver.yaml` 变更注入。运行时覆盖通过 `saml_config_overrides`
> 表持久化：`PUT /saml/config` 写入后立即回写 DB，进程下次启动时由 `SamlService::hydrate_runtime_overrides()`
> 从 `saml_config_overrides` 重新加载到内存缓存，因此重启不会丢失已应用的覆盖。

## 常见状态码

| 状态码 | 说明                                           |
| ------ | ---------------------------------------------- |
| `200`  | 元数据读取、回调解析或登出回调成功             |
| `302`  | 重定向到 SAML IdP 或返回登出跳转               |
| `400`  | SAMLResponse 缺失、元数据不完整或请求格式非法  |
| `401`  | 响应签名校验失败、请求已过期或未知用户被阻止   |
| `403`  | 身份提供方拒绝认证或当前配置不允许现有用户复用 |
| `404`  | 登出会话不存在                                 |
| `429`  | 触发限流                                       |

## 错误语义对齐（BaseManager）

| 场景                          | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                                          |
| ----------------------------- | -------------------------------------- | ---------------- | --------------------------------------------------- |
| SAML 请求已过期或响应校验失败 | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 重新发起 SSO 流程，不复用旧 `RelayState`            |
| SAML 断言或元数据格式不合法   | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 检查 `SAMLResponse`、`RelayState` 与 IdP 元数据配置 |
| 身份映射被策略拒绝            | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户联系管理员确认账号映射策略                  |
| 登出会话不存在                | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 将本地会话视为已失效并刷新登录态                    |
| 限流或短暂服务异常            | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试                                        |
| 其他 API 错误                 | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底处理                |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                                              |
| ------------------ | --------- | ------------------------------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | SAML 请求已过期、签名校验失败或响应已失效         |
| `M_BAD_JSON`       | `400`     | `SAMLResponse` 或元数据结构不合法                 |
| `M_INVALID_PARAM`  | `400`     | `RelayState`、Issuer、Audience 或时间窗口校验失败 |
| `M_FORBIDDEN`      | `403`     | 当前映射策略拒绝登录或提供方拒绝认证              |
| `M_NOT_FOUND`      | `404`     | 登出回调引用的会话不存在                          |
| `M_LIMIT_EXCEEDED` | `429`     | SAML 登录链路触发限流                             |
