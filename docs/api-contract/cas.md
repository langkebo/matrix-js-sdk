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
- **已封装**: 0
- **覆盖率**: 0%

### 3.2 已知差异

- CAS 是独立的认证协议，通常不直接在 SDK 中封装
- 建议使用专门的 CAS 客户端库

## 四、变更历史

| 日期 | 变更 | 影响 |
|------|------|------|
| 2026-04-27 | 初版 | - |
