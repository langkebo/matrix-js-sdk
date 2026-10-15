---
module: cas
generated_from: docs/api-contract/generated/modules/cas.json
generated_hash: sha256-d02071e4ebafee0026366cf286ee357eaebdd18c74a72ebec0764cd66fcd2d0d
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
