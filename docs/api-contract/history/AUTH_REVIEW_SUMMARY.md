# Auth 模块快速评审总结

> 说明: 本文件保留 2026-04-15 的阶段性审查快照。当前主契约请优先以 `auth.md`、`README.md`、`CHANGELOG.md` 与 `VERIFICATION_REPORT.md` 为准；`auth-enhanced.md` 仅作为历史增强版补充材料。

**评审日期**: 2026-04-15  
**评审状态**: ✅ 已完成基础审查

---

## 执行摘要

已完成 synapse-rust 后端 auth 模块的代码审查，并对比了现有契约文档。主要发现：

### 后端实现审查结果

**核心文件**:

- `src/auth/mod.rs` - AuthService 核心实现
- `src/web/routes/auth_compat.rs` - 认证路由处理器
- `src/services/registration_service.rs` - 注册服务
- `src/services/refresh_token_service.rs` - Token 刷新服务

**关键发现**:

1. **认证流程**:
    - ✅ 支持 `m.login.password` 和 `m.login.token` 两种登录方式
    - ✅ 实现了 JWT token 机制
    - ✅ 支持 refresh token 刷新
    - ✅ 包含账户锁定机制（失败次数限制）

2. **注册流程**:
    - ✅ 支持 `m.login.dummy` 和 `m.login.password` 两种注册方式
    - ✅ 用户名和密码验证
    - ✅ 邮箱验证流程（requestToken + submitToken）
    - ✅ 用户名可用性检查

3. **数据约束**:
    - Username 最大长度: 255 字符
    - Password 最大长度: 128 字符
    - Token 过期时间: 可配置（默认值在 SecurityConfig 中）
    - 账户锁定阈值: 可配置

4. **安全特性**:
    - ✅ Argon2 密码哈希
    - ✅ 支持旧密码哈希迁移
    - ✅ 登录失败计数和账户锁定
    - ✅ MFA 支持（管理员登录）
    - ✅ 安全审计日志

### 契约文档状态

**当前文档**: `docs/api-contract/auth.md`

**优点**:

- ✅ 路由清单完整
- ✅ 包含 SDK Manager 映射关系
- ✅ 覆盖了主要认证端点

**需要改进**:

- ⚠️ 缺少详细的请求/响应示例
- ⚠️ 缺少数据约束说明（用户名/密码长度限制）
- ⚠️ 缺少错误码详细映射
- ⚠️ 缺少安全特性说明（账户锁定、密码策略）
- ⚠️ 缺少数据库表结构说明

---

## 建议的优化方向

### 1. 补充数据约束

```markdown
## 数据约束

| 字段          | 约束          | 说明                                  |
| ------------- | ------------- | ------------------------------------- |
| username      | 最大 255 字符 | 必须符合 Matrix ID 规范               |
| password      | 最大 128 字符 | 必须满足密码策略                      |
| device_id     | 16 字符       | 服务器生成                            |
| access_token  | JWT           | 包含 user_id, device_id, admin 等信息 |
| refresh_token | 随机字符串    | 用于刷新 access_token                 |
```

### 2. 补充错误码

```markdown
## 错误码

| 错误码             | HTTP 状态码 | 场景             |
| ------------------ | ----------- | ---------------- |
| M_USER_IN_USE      | 409         | 用户名已被占用   |
| M_INVALID_USERNAME | 400         | 用户名不符合规范 |
| M_WEAK_PASSWORD    | 400         | 密码不满足策略   |
| M_FORBIDDEN        | 403         | 账户被锁定       |
| M_LIMIT_EXCEEDED   | 429         | 登录失败次数过多 |
| M_USER_DEACTIVATED | 403         | 账户已停用       |
```

### 3. 补充安全特性

```markdown
## 安全特性

### 密码策略

- 使用 Argon2 哈希算法
- 支持旧密码哈希自动迁移
- 可配置的密码强度要求

### 账户保护

- 登录失败计数
- 自动账户锁定（可配置阈值）
- 锁定时长可配置
- 管理员 MFA 强制要求

### Token 管理

- JWT access token（可配置过期时间）
- Refresh token 机制
- 设备级别的 token 管理
- 支持单设备登出和全设备登出
```

---

## SDK 实现建议

基于后端审查，SDK 应该：

1. **添加数据验证**:

```typescript
// 客户端验证
if (username.length > 255) {
    throw new Error("Username too long (max 255 characters)");
}
if (password.length > 128) {
    throw new Error("Password too long (max 128 characters)");
}
```

2. **完善错误处理**:

```typescript
// 处理账户锁定
if (error.errcode === "M_FORBIDDEN" && error.error.includes("locked")) {
    // 显示账户锁定提示
}
```

3. **Token 刷新机制**:

```typescript
// 自动刷新 token
if (tokenExpired) {
    await client.refreshAccessToken(refreshToken);
}
```

---

## 后续工作

由于时间限制，建议后续完成：

1. ✅ **已完成**: 基础代码审查
2. ⏳ **待完成**: 详细契约文档优化
3. ⏳ **待完成**: SDK 实现优化
4. ⏳ **待完成**: 自动化验证脚本
5. ⏳ **待完成**: 完整评审报告

---

## 快速参考

### 关键接口

**注册**:

```
POST /_matrix/client/r0/register
Body: { username, password, auth?, device_id? }
Response: { access_token, user_id, device_id, refresh_token? }
```

**登录**:

```
POST /_matrix/client/r0/login
Body: { type: "m.login.password", identifier: { user }, password, device_id? }
Response: { access_token, user_id, device_id, refresh_token?, well_known? }
```

**登出**:

```
POST /_matrix/client/r0/logout
Headers: Authorization: Bearer <access_token>
Response: {}
```

**刷新 Token**:

```
POST /_matrix/client/r0/refresh
Body: { refresh_token }
Response: { access_token, refresh_token?, expires_in? }
```

---

**评审人**: SDK 开发工程师  
**状态**: 基础审查完成，建议后续深入优化
