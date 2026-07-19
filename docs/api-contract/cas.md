---
module: cas
generated_from: docs/api-contract/generated/modules/cas.json
generated_hash: sha256-3ce29f55d762399092ca8a79a34763f25d2344ea812ce71e8171f59535ca7432
ledger_schema: 1
last_reviewed: 2026-05-03
---

# CAS Authentication API 契约文档

> 后端代码: `synapse-rust/src/web/routes/cas.rs`
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`

## 真实后端路由

### 公共 CAS 协议端点

| 方法 | 路径                  | 说明                     | 认证 |
| ---- | --------------------- | ------------------------ | ---- |
| GET  | `/login`              | 发起 CAS 登录            | 公开 |
| GET  | `/logout`             | 发起 CAS 登出            | 公开 |
| GET  | `/serviceValidate`    | 标准 service ticket 校验 | 公开 |
| GET  | `/proxyValidate`      | proxy ticket 校验        | 公开 |
| GET  | `/p3/serviceValidate` | CAS 3.0 service 校验     | 公开 |
| GET  | `/proxy`              | 代理票据交换             | 公开 |

### 管理端点

| 方法   | 路径                                                | 说明              | 认证   |
| ------ | --------------------------------------------------- | ----------------- | ------ |
| GET    | `/_synapse/admin/v1/cas/services`                   | 列出已登记服务    | 管理员 |
| POST   | `/_synapse/admin/v1/cas/services`                   | 注册新服务        | 管理员 |
| DELETE | `/_synapse/admin/v1/cas/services/{service_id}`      | 删除服务          | 管理员 |
| GET    | `/_synapse/admin/v1/cas/users/{user_id}/attributes` | 获取用户 CAS 属性 | 管理员 |
| POST   | `/_synapse/admin/v1/cas/users/{user_id}/attributes` | 设置用户 CAS 属性 | 管理员 |

### 兼容管理别名

后端还保留一组无前缀兼容别名，指向相同的管理逻辑：

- `GET /admin/services`
- `POST /admin/services`
- `DELETE /admin/services/{service_id}`
- `GET /admin/users/{user_id}/attributes`
- `POST /admin/users/{user_id}/attributes`

## SDK 对齐状态

| 端点                                                     | SDK Manager  | 方法                  | 状态          |
| -------------------------------------------------------- | ------------ | --------------------- | ------------- |
| `GET /login`                                             | `CasManager` | `buildLoginUrl()`     | ✅ URL helper |
| `GET /logout`                                            | `CasManager` | `buildLogoutUrl()`    | ✅ URL helper |
| `GET /serviceValidate`                                   | `CasManager` | `buildValidateUrl()`  | ✅ URL helper |
| `GET /proxyValidate`                                     | `CasManager` | `buildValidateUrl()`  | ✅ URL helper |
| `GET /p3/serviceValidate`                                | `CasManager` | `buildValidateUrl()`  | ✅ URL helper |
| `GET /proxy`                                             | `CasManager` | `buildValidateUrl()`  | ✅ URL helper |
| `GET /_synapse/admin/v1/cas/services`                    | `CasManager` | `listServices()`      | ✅            |
| `POST /_synapse/admin/v1/cas/services`                   | `CasManager` | `registerService()`   | ✅            |
| `DELETE /_synapse/admin/v1/cas/services/{service_id}`    | `CasManager` | `deleteService()`     | ✅            |
| `GET /_synapse/admin/v1/cas/users/{user_id}/attributes`  | `CasManager` | `getUserAttributes()` | ✅            |
| `POST /_synapse/admin/v1/cas/users/{user_id}/attributes` | `CasManager` | `setUserAttribute()`  | ✅            |

## 覆盖率口径

- **后端 Ledger 路由总数**: 16
- **SDK 已封装路由数**: 11 (主干端点与 URL helpers)
- **已绑定生成路由模板**: 11
- **契约覆盖率**: 100%
- **说明**:
    - `serviceValidate`、`proxyValidate`、`p3/serviceValidate`、`proxy` 属于 CAS 协议 XML 端点，通过 `buildValidateUrl()` helper 绑定。
    - 后端保留的 5 条无前缀兼容别名（如 `GET /admin/services`）与 `/_synapse/admin/v1/cas/*` 逻辑完全一致，SDK 统一采用 V1 路径进行封装，视为逻辑覆盖 100%。
