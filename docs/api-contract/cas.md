---
module: cas
generated_from: docs/api-contract/generated/modules/cas.json
generated_hash: sha256-285517185a320ea16b59acf60719baf27797c5ffdf44ef61310cc4e5609220f2
ledger_schema: 4
last_reviewed: 2026-05-03
---

# CAS Authentication API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/cas.rs`
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`

## 真实后端路由

### 公共 CAS 协议端点

> 后端 2026-09 已把这些端点从根级路径迁到 `/_synapse/cas` 前缀下（SDK 的
> `CAS_PROTOCOL_PREFIX` 一直按 `/_synapse/cas` 构建 URL，故 SDK 侧无需改动）。
> 根级 `/login`、`/serviceValidate` 等旧路径已下线，**不得**再写回契约表。

| 方法 | 路径                                        | 说明                     | 认证 |
| ---- | ------------------------------------------- | ------------------------ | ---- |
| GET  | `/_synapse/cas/login`                       | 发起 CAS 登录            | 公开 |
| GET  | `/_synapse/cas/logout`                      | 发起 CAS 登出            | 公开 |
| GET  | `/_synapse/cas/serviceValidate`             | 标准 service ticket 校验 | 公开 |
| GET  | `/_synapse/cas/proxyValidate`               | proxy ticket 校验        | 公开 |
| GET  | `/_synapse/cas/p3/serviceValidate`          | CAS 3.0 service 校验     | 公开 |
| GET  | `/_synapse/cas/proxy`                       | 代理票据交换             | 公开 |
| GET  | `/_matrix/client/v3/login/sso/redirect/cas` | CAS SSO 重定向           | 公开 |

### 管理端点

| 方法   | 路径                                                | 说明              | 认证   |
| ------ | --------------------------------------------------- | ----------------- | ------ |
| GET    | `/_synapse/admin/v1/cas/services`                   | 列出已登记服务    | 管理员 |
| POST   | `/_synapse/admin/v1/cas/services`                   | 注册新服务        | 管理员 |
| DELETE | `/_synapse/admin/v1/cas/services/{service_id}`      | 删除服务          | 管理员 |
| GET    | `/_synapse/admin/v1/cas/users/{user_id}/attributes` | 获取用户 CAS 属性 | 管理员 |
| POST   | `/_synapse/admin/v1/cas/users/{user_id}/attributes` | 设置用户 CAS 属性 | 管理员 |

## 结构化类型（codegen 源）

> 本节是 `scripts/sdk-contract-codegen.mjs` 的 DTO 提取源，也是 `src/cas/__generated__/dto.ts`
> 的权威来源。形状逐条对照 `synapse-rust/synapse-web/src/routes/cas.rs` 的实现，**不凭印象**。
>
> ⚠️ **本模块的 DTO 覆盖面刻意有限**，原因有二：
>
> 1. `/_synapse/cas/{login,logout,serviceValidate,proxyValidate,proxy,p3/serviceValidate}` 这 6 条
>    是 **CAS 协议端点**，后端返回 **XML**（`response.to_xml()` 或 `text/plain` 的
>    `"yes" / "no"`），**不是 JSON** ⇒ 天然不属于 JSON DTO 的建模范围。
> 2. `DELETE /_synapse/admin/v1/cas/services/{service_id}` 返回 `204 No Content`（无 body）
>    ⇒ 也没有响应类型可建模。
>
> 因此本节只覆盖 **JSON 形态**的管理端点与登录重定向。

```typescript
/** `POST /_synapse/admin/v1/cas/services` 请求体（后端 `RegisterServiceBody`）。 */
export interface CasRegisterServiceRequest {
    service_id: string;
    name: string;
    description?: string;
    service_url_pattern: string;
    allowed_attributes?: string[];
    allowed_proxy_callbacks?: string[];
    require_secure?: boolean;
    single_logout?: boolean;
}

/** CAS 服务记录（后端 `ServiceResponse`，`register_service` 与 `list_services` 共用）。 */
export interface CasServiceResponse {
    service_id: string;
    name: string;
    description?: string;
    service_url_pattern: string;
    is_enabled: boolean;
}

/** `GET /_matrix/client/v3/login/sso/redirect/cas` 的 JSON 形态响应（后端 `login_redirect`）。 */
export interface CasLoginRedirectResponse {
    redirect_url: string;
}

/** `POST /_synapse/admin/v1/cas/users/{user_id}/attributes` 请求体（后端 `SetAttributeBody`）。 */
export interface CasSetAttributeRequest {
    attribute_name: string;
    attribute_value: string;
}

/** `POST /_synapse/admin/v1/cas/users/{user_id}/attributes` 响应。 */
export interface CasSetAttributeResponse {
    user_id: string;
    attribute_name: string;
    attribute_value: string;
}
```

## SDK 对齐状态

| 端点                                                     | SDK Manager  | 方法                  | 状态              |
| -------------------------------------------------------- | ------------ | --------------------- | ----------------- |
| `GET /_synapse/cas/login`                                | `CasManager` | `buildLoginUrl()`     | ✅ URL helper     |
| `GET /_synapse/cas/logout`                               | `CasManager` | `buildLogoutUrl()`    | ✅ URL helper     |
| `GET /_synapse/cas/serviceValidate`                      | `CasManager` | `buildValidateUrl()`  | ✅ URL helper     |
| `GET /_synapse/cas/proxyValidate`                        | `CasManager` | `buildValidateUrl()`  | ✅ URL helper     |
| `GET /_synapse/cas/p3/serviceValidate`                   | `CasManager` | `buildValidateUrl()`  | ✅ URL helper     |
| `GET /_synapse/cas/proxy`                                | `CasManager` | `buildValidateUrl()`  | ✅ URL helper     |
| `GET /_matrix/client/v3/login/sso/redirect/cas`          | —            | —                     | 服务端 SSO 重定向 |
| `GET /_synapse/admin/v1/cas/services`                    | `CasManager` | `listServices()`      | ✅                |
| `POST /_synapse/admin/v1/cas/services`                   | `CasManager` | `registerService()`   | ✅                |
| `DELETE /_synapse/admin/v1/cas/services/{service_id}`    | `CasManager` | `deleteService()`     | ✅                |
| `GET /_synapse/admin/v1/cas/users/{user_id}/attributes`  | `CasManager` | `getUserAttributes()` | ✅                |
| `POST /_synapse/admin/v1/cas/users/{user_id}/attributes` | `CasManager` | `setUserAttribute()`  | ✅                |

## 覆盖率口径

- **后端 Ledger 路由总数**: 17
- **SDK 已封装路由数**: 11 (主干端点与 URL helpers)
- **已绑定生成路由模板**: 11
- **契约覆盖率**: 100%
- **说明**:
    - `/_synapse/cas/serviceValidate`、`/_synapse/cas/proxyValidate`、`/_synapse/cas/p3/serviceValidate`、`/_synapse/cas/proxy` 属于 CAS 协议 XML 端点，通过 `buildValidateUrl()` helper 绑定。
    - 后端曾保留的 5 条**无前缀**兼容别名（`/admin/services*`、`/admin/users/{user_id}/attributes`）
      已按铁律 1 连同 `cas.rs` 的 `legacy_admin_routes` 与专用 deprecation 中间件整段删除
      （2026-10-08，C6 第四批）；SDK 侧同步收敛为唯一的 `/_synapse/admin/v1/cas/*` 形态。
