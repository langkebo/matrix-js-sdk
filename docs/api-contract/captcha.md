# CAPTCHA API 契约文档

> 后端代码: `synapse-rust/src/web/routes/captcha.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `r0`

## 一、模块概述

### 1.1 功能描述

CAPTCHA API 提供验证码功能，用于注册时的人机验证。

### 1.2 路由前缀

- `/_matrix/client/r0/register/captcha/*`
- `/_synapse/admin/v1/captcha/cleanup`

### 1.3 认证要求

- 客户端端点：公开或注册流程中
- 管理端点：`AdminUser`

## 二、端点详情

### 2.1 发送验证码

**路径**: `POST /_matrix/client/r0/register/captcha/send`  
**认证**: 公开  
**挂载版本**: `r0`

**请求体**:
```json
{
  "session": "session_id"
}
```

**响应**: `200 OK`
```json
{
  "captcha_url": "https://..."
}
```

### 2.2 验证验证码

**路径**: `POST /_matrix/client/r0/register/captcha/verify`  
**认证**: 公开  
**挂载版本**: `r0`

**请求体**:
```json
{
  "session": "session_id",
  "response": "captcha_response"
}
```

**响应**: `200 OK`
```json
{
  "success": true
}
```

### 2.3 查询验证码状态

**路径**: `GET /_matrix/client/r0/register/captcha/status`  
**认证**: 公开  
**挂载版本**: `r0`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session` | string | 是 | 会话 ID |

**响应**: `200 OK`
```json
{
  "verified": false
}
```

### 2.4 清理过期验证码（Admin）

**路径**: `POST /_synapse/admin/v1/captcha/cleanup`  
**认证**: `AdminUser`  
**挂载版本**: `v1`

**响应**: `200 OK`
```json
{
  "cleaned": 42
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 4
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期 | 变更 | 影响 |
|------|------|------|
| 2026-04-27 | 初版 | - |
