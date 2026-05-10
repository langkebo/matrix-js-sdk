---
module: cas
generated_from: docs/api-contract/generated/modules/cas.json
generated_hash: sha256-8b74490ce2a7680a687e8726fb1bc6e6c83fa94a506f47a739df34a4a05691d8
ledger_schema: 1
last_reviewed: 2026-05-03
---

# CAS Authentication API 契约文档

> 后端代码: `synapse-rust/src/web/routes/cas.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: CAS 协议

## 一、模块概述

### 1.1 功能描述

CAS (Central Authentication Service) API 提供单点登录功能。

### 1.2 路由前缀

- `/login`
- `/serviceValidate`
- `/proxyValidate`
- `/logout`
- `/admin/services`
- `/admin/users/{user_id}/attributes`

### 1.3 认证要求

- 客户端端点：CAS ticket
- 管理端点：CAS 管理员权限

## 二、端点详情

### 2.1 CAS 登录

**路径**: `GET /login`  
**认证**: 无

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `service` | string | 是 | 服务 URL |

**响应**: 重定向到 CAS 登录页面

### 2.2 服务验证

**路径**: `GET /serviceValidate`  
**认证**: 无

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `service` | string | 是 | 服务 URL |
| `ticket` | string | 是 | CAS ticket |

**响应**: `200 OK` (XML)

```xml
<cas:serviceResponse>
  <cas:authenticationSuccess>
    <cas:user>username</cas:user>
  </cas:authenticationSuccess>
</cas:serviceResponse>
```

### 2.3 代理验证

**路径**: `GET /proxyValidate`  
**认证**: 无

**查询参数**: 同 2.2

**响应**: `200 OK` (XML)

### 2.4 代理

**路径**: `GET /proxy`  
**认证**: CAS ticket

**响应**: `200 OK` (XML)

### 2.5 P3 服务验证

**路径**: `GET /p3/serviceValidate`  
**认证**: 无

**响应**: `200 OK` (XML)

### 2.6 登出

**路径**: `GET /logout`  
**认证**: 无

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `service` | string | 否 | 登出后重定向 URL |

**响应**: 重定向

### 2.7 管理服务（Admin）

**路径**: `GET /admin/services`  
**认证**: CAS 管理员

**响应**: `200 OK`

```json
{
    "services": []
}
```

### 2.8 查询用户属性（Admin）

**路径**: `GET /admin/users/{user_id}/attributes`  
**认证**: CAS 管理员

**响应**: `200 OK`

```json
{
    "attributes": {}
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 8
- **已封装**: 5 admin 端点 + 2 URL 助手（浏览器消费的 XML 路由保留给上层跳转，不封装 JSON API）
- **覆盖率**: admin 面 100%；公共 CAS 协议（`/login`、`/serviceValidate`、`/proxyValidate`、`/proxy`、`/p3/serviceValidate`、`/logout`）由浏览器重定向消费，返回 XML/text，不适合 JSON 客户端封装

### 3.2 SDK 入口

| 端点                                                       | SDK Manager  | 方法                     | 状态         |
| ---------------------------------------------------------- | ------------ | ------------------------ | ------------ |
| `POST /_synapse/admin/v1/cas/services`                     | `CasManager` | `registerService()`      | ✅ 已封装    |
| `GET /_synapse/admin/v1/cas/services`                      | `CasManager` | `listServices()`         | ✅ 已封装    |
| `DELETE /_synapse/admin/v1/cas/services/{service_id}`      | `CasManager` | `deleteService()`        | ✅ 已封装    |
| `POST /_synapse/admin/v1/cas/users/{user_id}/attributes`   | `CasManager` | `setUserAttribute()`     | ✅ 已封装    |
| `GET /_synapse/admin/v1/cas/users/{user_id}/attributes`    | `CasManager` | `getUserAttributes()`    | ✅ 已封装    |
| `GET /login`（浏览器 CAS 跳转）                            | `CasManager` | `buildLoginUrl()`        | ✅ URL 助手 |
| `GET /logout`（浏览器 CAS 跳转）                           | `CasManager` | `buildLogoutUrl()`       | ✅ URL 助手 |

### 3.3 已知差异

- CAS 协议 XML 端点由上层通过 `buildLoginUrl(serviceUrl)` / `buildLogoutUrl(serviceUrl?)` 拿到 URL 后发起浏览器跳转消费，不走 `MatrixClient.http.authedRequest`。
- `getCasManager()` 由 `src/cas/index.ts` 的 `extendMatrixClient()` 注册，已在 `matrix-client-extensions.d.ts` 与 `manager-extensions/index.ts` 默认扩展列表中挂载。

## 四、变更历史

| 日期       | 变更                                                                         | 影响                  |
| ---------- | ---------------------------------------------------------------------------- | --------------------- |
| 2026-04-27 | 初版                                                                         | -                     |
| 2026-05-05 | 新增 `CasManager` 覆盖 5 admin 端点 + 2 URL 助手（R2-CAS-01 闭环）          | SDK 对齐状态升级至完整 |
