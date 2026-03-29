# Auth 模块 API 契约

> 认证相关 API 的 SDK 与后端接口契约

## 登录 / Login

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/login` |
| HTTP 方法 | POST |
| SDK 方法 | `client.login()` |
| SDK 模块 | 核心 SDK |
| 认证要求 | 否 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `identifier` | `AuthenticationIdentifier` | 是 | 用户标识符 |
| `device_id` | `string` | 否 | 设备 ID |
| `initial_device_display_name` | `string` | 否 | 设备显示名 |
| `password` | `string` | 否 | 密码（password 类型必填） |
| `token` | `string` | 否 | Token（token 类型必填） |
| `type` | `string` | 是 | 认证类型，如 `m.login.password` |

### 响应结构

```typescript
interface LoginResponse {
    access_token: string;
    device_id: string;
    expires_in_ms?: number;
    expires_at?: number;
    refresh_token?: string;
    room_keys_version?: string;
    user_id: string;
    well_known?: {
        "m.homeserver": { base_url: string };
        "m.identity_server": { base_url: string };
    };
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 登录成功 |
| 400 | 参数错误（缺少必填字段） |
| 401 | 认证失败（密码错误、用户不存在） |
| 403 | 账户被禁用 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/auth.rs`
- **SDK 封装**: `matrix-js-sdk/src/auth/index.ts`
- **前端调用**: `hula/src/services/MatrixAuthService.ts`

---

## 注册 / Register

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/register` |
| HTTP 方法 | POST |
| SDK 方法 | `client.register()` |
| SDK 模块 | 核心 SDK |
| 认证要求 | 否 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `auth` | `AuthenticationData` | 否 | 认证数据 |
| `device_id` | `string` | 否 | 设备 ID |
| `initial_device_display_name` | `string` | 否 | 设备显示名 |
| `password` | `string` | 否 | 密码 |
| `username` | `string` | 否 | 用户名（仅 register 时可选） |

### 响应结构

```typescript
interface RegisterResponse {
    access_token: string;
    device_id: string;
    expires_in_ms?: number;
    refresh_token?: string;
    user_id: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 注册成功 |
| 400 | 参数错误 |
| 401 | 需要额外认证（如 captcha） |
| 409 | 用户名已被占用 |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/auth.rs`
- **SDK 封装**: `matrix-js-sdk/src/auth/index.ts`
- **前端调用**: `hula/src/services/MatrixAuthService.ts`

---

## Token 刷新 / Refresh Token

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/refresh` |
| HTTP 方法 | POST |
| SDK 方法 | `client.refreshToken()` |
| SDK 模块 | 核心 SDK |
| 认证要求 | 否 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `refresh_token` | `string` | 是 | 刷新令牌 |

### 响应结构

```typescript
interface RefreshTokenResponse {
    access_token: string;
    expires_in_ms?: number;
    refresh_token?: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 刷新成功 |
| 400 | 参数错误 |
| 401 | 刷新令牌无效或过期 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/auth.rs`
- **SDK 封装**: `matrix-js-sdk/src/http-api/refresh.ts`
- **前端调用**: `hula/src/services/MatrixAuthService.ts`

---

## 登出 / Logout

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/logout` |
| HTTP 方法 | POST |
| SDK 方法 | `client.logout()` |
| SDK 模块 | 核心 SDK |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface LogoutResponse {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 登出成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/auth.rs`
- **SDK 封装**: `matrix-js-sdk/src/auth/index.ts`
- **前端调用**: `hula/src/services/MatrixAuthService.ts`

---

## 用户信息 / WhoAmI

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/account/whoami` |
| HTTP 方法 | GET |
| SDK 方法 | `client.whoAmI()` |
| SDK 模块 | 核心 SDK |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface WhoAmIResponse {
    user_id: string;
    device_id?: string;
    is_guest?: boolean;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/account_data.rs`
- **SDK 封装**: `matrix-js-sdk/src/account/index.ts`
- **前端调用**: `hula/src/services/MatrixUserService.ts`
