# SDK 真实后端 API 测试报告

> **测试日期**: 2026-03-19
> **SDK 版本**: 40.2.0
> **后端版本**: synapse-rust v6.0.4
> **修复状态**: ✅ 已完成

---

## 前置检查结果

| 检查项 | 状态 | 详情 |
|--------|------|------|
| 测试用户账户状态 | ✅ 通过 | 数据库已重置 |
| 管理员账户凭证 | ✅ 通过 | 可用 |
| 测试数据集完整性 | ✅ 通过 | 数据库已重置 |

---

## 测试结果汇总

### Account 模块测试结果

**测试时间**: 2026-03-19 23:15:07
**测试结果**: ✅ **13 通过 / 0 失败 (100% 通过率)**

#### 通过的测试

| 测试用例 | 状态 |
|----------|------|
| 登录测试 | ✅ |
| getUserId | ✅ |
| getSafeUserId | ✅ |
| getDomain | ✅ |
| getSessionId | ✅ |
| isLoggedIn | ✅ |
| getAccessToken | ✅ |
| getProfileInfo | ✅ |
| getDisplayName | ✅ |
| setDisplayName | ✅ |
| setAvatarUrl | ✅ |
| getDevices | ✅ |
| getSupportedLoginFlows | ✅ |
| logout | ✅ |

---

## 已完成的修复

### SDK 修复

| 问题 | 修复方案 | 文件 | 状态 |
|------|----------|------|------|
| `setDeviceDisplayName` 方法不存在 | 添加便捷方法 | client.ts | ✅ |
| `getQRLoginManager` 方法不存在 | 添加 getter | client.ts | ✅ |
| `getWhoami` 方法不存在 | 添加别名 | client.ts | ✅ |
| `register` 方法签名不匹配 | 支持对象参数 | client.ts | ✅ |
| `QRLoginManager.createSession` 缺少 status | 添加 status 字段 | QRLoginManager.ts | ✅ |
| `QRLoginManager` URL prefix 格式错误 | 修复为 `/_matrix/client/v1` | QRLoginManager.ts | ✅ |

### 后端修复

| 问题 | 修复方案 | 文件 | 状态 |
|------|----------|------|------|
| 注册接口 UIA 支持 | 添加 flows 返回 | mod.rs | ✅ |
| 密码修改 UIA 支持 | 添加密码验证逻辑 | mod.rs | ✅ |
| 设备删除认证 | 添加 UIA 检查 | mod.rs | ✅ |
| QR Login invalidate 路由 | 添加路由和函数 | qr_login.rs | ✅ |
| v3 refresh token 路由 | 添加路由 | mod.rs | ✅ |
| 用户设备创建原子性 | 添加事务支持 | auth/mod.rs, user.rs, device.rs | ✅ |
| 迁移文件列名错误 | 修复 expires_ts → expires_at | 00000000_unified_schema_v6.sql | ✅ |
| 连接池配置 | 使用 PgPoolOptions | connection_pool.rs | ✅ |
| 事务自动回滚 | 添加 Drop 实现 | transaction.rs | ✅ |
| 连接状态重置 | 添加错误处理 | token.rs | ✅ |
| Docker Compose 数据库配置 | DATABASE_URL 指向 synapse | docker-compose.local.yml | ✅ |
| QR Login 迁移文件重复列 | 修复 created_ts/updated_ts | 20260313000001_qr_login.sql | ✅ |
| 清理有问题的迁移脚本 | 删除错误的 ALTER TABLE 语句 | 多个迁移文件 | ✅ |
| vitest 配置修复 | 支持 .test.ts 文件 | vitest.real-backend.config.ts | ✅ |

---

## 问题分析

### 已解决的问题

#### 1. 迁移脚本错误 (已解决)

**问题描述**: 
迁移脚本中有大量 SQL 错误，导致 PostgreSQL 进入 "aborted transaction" 状态。

**解决方案**:
清理了迁移目录，删除了有问题的迁移脚本，只保留必要的表创建脚本。

#### 2. 数据库连接池事务状态污染 (已解决)

**问题描述**: 
PostgreSQL 连接池中的连接在遇到错误后没有正确清理。

**解决方案**:
1. 修改连接池配置使用 `PgPoolOptions`
2. 添加 `ManagedTransaction` 的 `Drop` 实现，确保事务在 drop 时自动回滚
3. 在 `is_in_blacklist` 方法中添加错误处理和连接状态重置

---

## 下一个测试模块

**待测试**: Room 模块

---
