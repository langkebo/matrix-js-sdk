# Auth 模块契约（增强版）

> 说明: 本文件为 2026-04-15 的历史增强版契约快照，用于保留当时的补充说明。当前主契约基线请优先以 `auth.md`、`README.md`、`CHANGELOG.md` 与 `VERIFICATION_REPORT.md` 为准。  
> **审查来源**: `synapse-rust/src/auth/mod.rs`, `synapse-rust/src/web/routes/auth_compat.rs`  
> **数据库表**: `users`, `devices`, `access_tokens`, `refresh_tokens`  
> **最后更新**: 2026-04-15

## 概述

Auth 模块提供完整的用户认证、注册、登录、登出和 token 管理功能。支持密码认证、token 认证、邮箱验证等多种认证方式，并包含账户保护机制（失败计数、自动锁定）。

## 数据约束

| 字段 | 约束 | 说明 |
|------|------|------|
| username | 最大 255 字符 | 必须符合 Matrix ID 规范，不能包含特殊字符 |
| password | 最大 128 字符 | 必须满足密码策略（长度、复杂度） |
| device_id | 16 字符 | 服务器生成的随机字符串 |
| access_token | JWT | 包含 user_id, device_id, admin, exp, iat 等声明 |
| refresh_token | 随机字符串 | 用于刷新 access_token |
| token_expiry | 可配置 | 默认值在 SecurityConfig 中设置 |
| lockout_threshold | 可配置 | 默认失败次数阈值 |
| lockout_duration | 可配置 | 默认锁定时长（秒） |

## 核心接口

### 1. 注册用户

**端点**: `POST /_matrix/client/{r0,v3}/register`

**请求体**:
```json
{
  "username": "alice",
  "password": "secret123",
  "auth": {
    "type": "m.login.dummy"
  },
  "device_id": "ABCDEFGHIJKLMNOP",
  "initial_device_display_name": "Alice's Phone"
}
```

**响应 200**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "@alice:example.com",
  "device_id": "ABCDEFGHIJKLMNOP",
  "refresh_token": "def50200..."
}
```

**错误码**:
- `400 M_BAD_JSON` - 请求体格式错误
- `400 M_INVALID_USERNAME` - 用户名不符合规范
- `400 M_WEAK_PASSWORD` - 密码不满足策略
- `409 M_USER_IN_USE` - 用户名已被占用
- `429 M_LIMIT_EXCEEDED` - 请求过于频繁

**验证规则**:
- username 和 password 必填
- username 长度 ≤ 255 字符
- password 长度 ≤ 128 字符
- 密码必须满足强度要求（由 Validator 检查）

**数据库操作**:
```sql
-- 创建用户（事务）
INSERT INTO users (user_id, username, password_hash, is_admin, created_ts)
VALUES ($1, $2, $3, $4, $5);

-- 创建设备
INSERT INTO devices (device_id, user_id, display_name, created_ts, first_seen_ts)
VALUES ($1, $2, $3, $4, $4);
```

---

### 2. 用户登录

**端点**: `POST /_matrix/client/{r0,v3}/login`

**请求体**:
```json
{
  "type": "m.login.password",
  "identifier": {
    "type": "m.id.user",
    "user": "alice"
  },
  "password": "secret123",
  "device_id": "ABCDEFGHIJKLMNOP",
  "initial_device_display_name": "Alice's Phone"
}
```

**响应 200**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "@alice:example.com",
  "device_id": "ABCDEFGHIJKLMNOP",
  "refresh_token": "def50200...",
  "expires_in": 3600,
  "well_known": {
    "m.homeserver": {
      "base_url": "http://localhost:28008"
    }
  }
}
```

**错误码**:
- `400 M_BAD_JSON` - 请求体格式错误
- `401 M_UNAUTHORIZED` - 用户名或密码错误
- `403 M_FORBIDDEN` - 账户被锁定
- `403 M_USER_DEACTIVATED` - 账户已停用
- `429 M_LIMIT_EXCEEDED` - 登录失败次数过多

**账户保护机制**:
1. **失败计数**: 每次登录失败，失败计数 +1
2. **自动锁定**: 失败次数达到阈值（可配置），账户自动锁定
3. **锁定时长**: 锁定时长可配置（默认秒数）
4. **成功清零**: 登录成功后，失败计数清零

**密码验证流程**:
1. 查询用户记录
2. 检查账户是否停用
3. 检查账户是否锁定
4. 验证密码哈希（Argon2）
5. 如果是旧哈希，自动迁移到新哈希
6. 清除失败计数
7. 生成 access_token 和 refresh_token

---

### 3. 刷新 Token

**端点**: `POST /_matrix/client/{r0,v3}/refresh`

**请求体**:
```json
{
  "refresh_token": "def50200..."
}
```

**响应 200**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "def50200...",
  "expires_in": 3600,
  "device_id": "ABCDEFGHIJKLMNOP"
}
```

**错误码**:
- `400 M_BAD_JSON` - 请求体格式错误
- `401 M_UNKNOWN_TOKEN` - refresh_token 无效或已过期
- `401 M_UNAUTHORIZED` - refresh_token 已被撤销

**Token 刷新逻辑**:
1. 验证 refresh_token 有效性
2. 检查是否已撤销
3. 检查是否过期
4. 生成新的 access_token
5. 可选：生成新的 refresh_token（轮换）
6. 更新使用计数和最后使用时间

---

### 4. 登出

**端点**: `POST /_matrix/client/{r0,v3}/logout`

**请求头**:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**响应 200**:
```json
{}
```

**错误码**:
- `401 M_UNKNOWN_TOKEN` - access_token 无效
- `401 M_MISSING_TOKEN` - 缺少 Authorization 头

**登出操作**:
1. 将 access_token 加入黑名单
2. 从数据库删除 token 记录
3. 删除该设备的所有 token
4. 记录安全审计日志

---

### 5. 全设备登出

**端点**: `POST /_matrix/client/{r0,v3}/logout/all`

**请求头**:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**响应 200**:
```json
{}
```

**错误码**:
- `401 M_UNKNOWN_TOKEN` - access_token 无效
- `401 M_MISSING_TOKEN` - 缺少 Authorization 头

**全设备登出操作**:
1. 获取用户的所有 token
2. 将所有 token 加入黑名单
3. 删除所有 access_token 记录
4. 删除所有 refresh_token 记录
5. 清除缓存中的登出标记
6. 记录安全审计日志

---

### 6. 检查用户名可用性

**端点**: `GET /_matrix/client/{r0,v3}/register/available?username=alice`

**响应 200**:
```json
{
  "available": false,
  "username": "alice"
}
```

**错误码**:
- `400 M_BAD_JSON` - 缺少 username 参数
- `400 M_INVALID_USERNAME` - 用户名不符合规范

---

### 7. 请求邮箱验证

**端点**: `POST /_matrix/client/{r0,v3}/register/email/requestToken`

**请求体**:
```json
{
  "email": "alice@example.com",
  "client_secret": "this_is_a_secret",
  "send_attempt": 1
}
```

**响应 200**:
```json
{
  "sid": "123456",
  "submit_url": "https://example.com:28008/_matrix/client/r0/register/email/submitToken",
  "expires_in": 3600
}
```

**错误码**:
- `400 M_BAD_JSON` - 请求体格式错误
- `400 M_INVALID_EMAIL` - 邮箱格式不正确

---

### 8. 提交邮箱验证

**端点**: `POST /_matrix/client/{r0,v3}/register/email/submitToken`

**请求体**:
```json
{
  "sid": "123456",
  "client_secret": "this_is_a_secret",
  "token": "abc123"
}
```

**响应 200**:
```json
{
  "success": true
}
```

**错误码**:
- `400 M_BAD_JSON` - 请求体格式错误
- `400 M_INVALID_PARAM` - sid 或 token 无效
- `400 M_SESSION_NOT_FOUND` - 会话不存在
- `400 M_TOKEN_EXPIRED` - token 已过期
- `400 M_TOKEN_ALREADY_USED` - token 已被使用

---

## 数据库表结构

### users 表

```sql
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    is_guest BOOLEAN DEFAULT FALSE,
    is_shadow_banned BOOLEAN DEFAULT FALSE,
    is_deactivated BOOLEAN DEFAULT FALSE,
    created_ts BIGINT NOT NULL,
    updated_ts BIGINT,
    displayname TEXT,
    avatar_url TEXT,
    email TEXT,
    phone TEXT,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until BIGINT,
    password_changed_ts BIGINT,
    CONSTRAINT pk_users PRIMARY KEY (user_id),
    CONSTRAINT uq_users_username UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

### devices 表

```sql
CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT,
    last_seen_ts BIGINT,
    last_seen_ip TEXT,
    created_ts BIGINT NOT NULL,
    first_seen_ts BIGINT NOT NULL,
    user_agent TEXT,
    CONSTRAINT pk_devices PRIMARY KEY (device_id),
    CONSTRAINT fk_devices_user FOREIGN KEY (user_id) 
        REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
```

### access_tokens 表

```sql
CREATE TABLE IF NOT EXISTS access_tokens (
    id BIGSERIAL,
    token_hash TEXT NOT NULL,
    token TEXT,
    user_id TEXT NOT NULL,
    device_id TEXT,
    created_ts BIGINT NOT NULL,
    expires_at BIGINT,
    last_used_ts BIGINT,
    is_revoked BOOLEAN DEFAULT FALSE,
    CONSTRAINT pk_access_tokens PRIMARY KEY (id),
    CONSTRAINT uq_access_tokens_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_access_tokens_user FOREIGN KEY (user_id) 
        REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_user_id ON access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_token_hash ON access_tokens(token_hash);
```

### refresh_tokens 表

```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id BIGSERIAL,
    token_hash TEXT NOT NULL,
    user_id TEXT NOT NULL,
    device_id TEXT,
    created_ts BIGINT NOT NULL,
    expires_at BIGINT,
    last_used_ts BIGINT,
    use_count INTEGER DEFAULT 0,
    is_revoked BOOLEAN DEFAULT FALSE,
    CONSTRAINT pk_refresh_tokens PRIMARY KEY (id),
    CONSTRAINT uq_refresh_tokens_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) 
        REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
```

---

## 安全特性

### 1. 密码哈希

**算法**: Argon2id

**参数**（可配置）:
- `m_cost`: 内存成本
- `t_cost`: 时间成本
- `p_cost`: 并行度

**旧哈希迁移**:
- 支持从旧哈希算法自动迁移
- 登录时检测旧哈希并自动升级
- 迁移过程对用户透明

### 2. 账户保护

**登录失败计数**:
```rust
// 缓存键格式
auth:failures:{user_id}

// 失败次数递增
failures = cache.get(key) + 1
cache.set(key, failures, lockout_duration)
```

**账户锁定**:
```rust
// 达到阈值时锁定
if failures >= threshold {
    lockout_until = now + lockout_duration
    cache.set("auth:lockout:{user_id}", lockout_until, lockout_duration)
}
```

**锁定检查**:
```rust
// 登录前检查
if cache.get("auth:lockout:{user_id}") > now {
    return M_FORBIDDEN("Account locked")
}
```

### 3. Token 管理

**JWT Claims**:
```rust
{
    "sub": "user_id",           // Subject (user ID)
    "user_id": "@alice:example.com",
    "jti": "unique_token_id",   // JWT ID
    "admin": false,             // Admin flag
    "exp": 1234567890,          // Expiration time
    "iat": 1234567890,          // Issued at
    "device_id": "ABCD..."      // Device ID
}
```

**Token 黑名单**:
- 登出时将 token 加入黑名单
- 验证 token 时检查黑名单
- 黑名单使用 token_hash 存储

**Token 轮换**:
- 刷新时可选生成新的 refresh_token
- 旧 refresh_token 自动失效
- 防止 token 泄露风险

### 4. 审计日志

**登录成功**:
```rust
tracing::info!(
    target: "security_audit",
    event = "login_success",
    user_id = user_id,
    device_id = device_id
);
```

**登录失败**:
```rust
tracing::warn!(
    target: "security_audit",
    event = "login_failure",
    username = username,
    reason = reason
);
```

**账户锁定**:
```rust
tracing::warn!(
    target: "security_audit",
    event = "account_locked",
    user_id = user_id,
    failure_count = failures
);
```

---

## 错误码完整映射

| 错误码 | HTTP 状态码 | 场景 | 错误消息示例 |
|--------|------------|------|-------------|
| `M_FORBIDDEN` | 403 | 账户被锁定 | "Account is temporarily locked due to too many failed login attempts" |
| `M_FORBIDDEN` | 403 | 注册已禁用 | "Registration is disabled" |
| `M_USER_IN_USE` | 409 | 用户名已占用 | "Username already taken" |
| `M_INVALID_USERNAME` | 400 | 用户名不符合规范 | "Username contains invalid characters" |
| `M_WEAK_PASSWORD` | 400 | 密码不满足策略 | "Password does not meet policy requirements" |
| `M_BAD_JSON` | 400 | 请求体格式错误 | "Invalid JSON" |
| `M_UNAUTHORIZED` | 401 | 用户名或密码错误 | "Invalid credentials" |
| `M_UNKNOWN_TOKEN` | 401 | Token 无效 | "Invalid or expired token" |
| `M_MISSING_TOKEN` | 401 | 缺少 Token | "Missing access token" |
| `M_USER_DEACTIVATED` | 403 | 账户已停用 | "User account has been deactivated" |
| `M_LIMIT_EXCEEDED` | 429 | 请求过于频繁 | "Too many requests" |
| `M_INVALID_EMAIL` | 400 | 邮箱格式错误 | "Invalid email address format" |
| `M_SESSION_NOT_FOUND` | 400 | 会话不存在 | "Invalid session ID or session not found" |
| `M_TOKEN_EXPIRED` | 400 | Token 已过期 | "Verification token has expired" |
| `M_TOKEN_ALREADY_USED` | 400 | Token 已使用 | "Verification token has already been used" |

---

## 版本变更记录

### v1.0 (2026-04-15)

**新增**:
- 完整的认证接口文档
- 数据约束详细说明
- 数据库表结构定义
- 安全特性详细说明
- 错误码完整映射
- 账户保护机制文档

**数据约束**:
- username 最大长度: 255 字符
- password 最大长度: 128 字符
- device_id 长度: 16 字符
- token 过期时间: 可配置

**安全特性**:
- Argon2 密码哈希
- 登录失败计数和账户锁定
- JWT token 管理
- Token 黑名单机制
- 完整的安全审计日志

**兼容性**:
- 支持 `/_matrix/client/r0` 和 `/_matrix/client/v3` 前缀
- 支持 `m.login.password` 和 `m.login.token` 登录方式
- 支持 `m.login.dummy` 和 `m.login.password` 注册方式

---

## 代码定位

- **核心服务**: `synapse-rust/src/auth/mod.rs`
- **路由处理器**: `synapse-rust/src/web/routes/auth_compat.rs`
- **注册服务**: `synapse-rust/src/services/registration_service.rs`
- **Token 刷新**: `synapse-rust/src/services/refresh_token_service.rs`
- **数据库迁移**: `synapse-rust/migrations/00000000_unified_schema_v6.sql`

---

## 注意事项

1. **密码哈希**: 使用 `spawn_blocking` 避免阻塞异步执行器
2. **事务安全**: 用户和设备创建使用事务确保原子性
3. **缓存策略**: 失败计数和锁定状态存储在缓存中
4. **Token 存储**: access_token 和 refresh_token 使用哈希存储
5. **审计日志**: 所有安全事件都记录到 `security_audit` target
6. **MFA 支持**: 管理员登录强制要求 MFA
7. **设备管理**: 每个 token 关联到特定设备
8. **级联删除**: 用户删除时自动清理相关 token 和设备
