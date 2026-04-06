# Presence 模块契约

> 审查来源: `synapse-rust/src/web/routes/presence.rs`

## 挂载版本

| 前缀 | 路由 |
|------|------|
| `/_matrix/client/v1` | `/presence/{user_id}/status` |
| `/_matrix/client/r0` | `/presence/{user_id}/status` |
| `/_matrix/client/v3` | `/presence/{user_id}/status` 与 `/presence/list/*` |

## 路由清单

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/_matrix/client/{v1,r0,v3}/presence/{user_id}/status` | 获取指定用户 presence 状态 | 用户 |
| PUT | `/_matrix/client/{v1,r0,v3}/presence/{user_id}/status` | 更新指定用户 presence 状态 | 用户 |
| GET | `/_matrix/client/v3/presence/list` | 获取当前用户的 presence list | 用户 |
| POST | `/_matrix/client/v3/presence/list` | 批量订阅/管理 presence list | 用户 |
| GET | `/_matrix/client/v3/presence/list/{user_id}` | 获取指定用户的 presence list | 用户 |

## 响应与请求要点

- `status` 端点通常围绕以下字段:
  - `presence`
  - `currently_active?`
  - `last_active_ago?`
  - `status_msg?`
- `PUT /status` 请求体通常为 presence 更新内容
- `presence/list` 路由是 v3 专有扩展

## 常见状态码

| 状态码 | 说明 |
|--------|------|
| `200` | 请求成功 |
| `400` | presence 状态值不合法 |
| `401` | Token 无效或缺失 |
| `404` | 用户不存在或条目不存在 |

## 代码定位

- 路由声明: `synapse-rust/src/web/routes/presence.rs`
- 处理器: `synapse-rust/src/web/routes/handlers/presence.rs`

---

## SDK Manager 对应关系

> 更新日期: 2026-04-04
> 审计状态: ✅ 完整

### Presence 状态

| 端点 | SDK Manager | 方法 | 状态 |
|------|-------------|------|------|
| `GET /presence/{user_id}/status` | `PresenceManager` | `getPresence()` | ✅ 已封装 |
| `PUT /presence/{user_id}/status` | `PresenceManager` | `setPresence()` | ✅ 已封装 |

### Presence List

| 端点 | SDK Manager | 方法 | 状态 |
|------|-------------|------|------|
| `GET /presence/list` | `PresenceManager` | `getSubscribedPresence()` | ✅ 已封装 |
| `POST /presence/list` | `PresenceManager` | `subscribeToPresence()` | ✅ 已封装 |
| `GET /presence/list/{user_id}` | `PresenceManager` | `getPresenceList()` | ✅ 已封装 |

---

## 审计发现的问题

> 审计日期: 2026-04-04
> 修复日期: 2026-04-04

### ⚠️ 中优先级问题

#### 1. ~~契约文档缺少端点记录~~ ✅ 已修复

**问题描述**: 后端实现了 `GET /_matrix/client/v3/presence/list/{user_id}` 端点，但契约文档未记录。

**修复状态**: ✅ 已更新契约文档

---

#### 2. ~~SDK 缺少 getPresenceList 方法~~ ✅ 已修复

**问题描述**: SDK 没有封装 `GET /_matrix/client/v3/presence/list/{user_id}` 端点。

**修复状态**: ✅ 已添加 `getPresenceList(userId)` 方法

---

### 📝 低优先级问题

#### 3. ~~SDK 错误处理不完善~~ ✅ 已修复

**问题描述**: `getPresence()` 和 `getSubscribedPresence()` 方法吞掉错误返回默认值。

**修复状态**: ✅ 已添加 `normalizeError()` 和 `isRetryableError()` 方法，使用统一的错误分类处理

---

## 封装覆盖率

- **后端路由总数**: 5 个端点
- **SDK 已封装**: 5 个方法
- **完全正确封装**: 5/5 (100%)

---

## 修复状态

| 优先级 | 问题 | 影响 | 状态 |
|--------|------|------|------|
| ⚠️ P1 | 契约文档缺少端点 | 文档不完整 | ✅ 已修复 |
| ⚠️ P1 | 缺少 getPresenceList 方法 | 功能不完整 | ✅ 已修复 |
| 📝 P2 | SDK 错误处理不完善 | 问题难以排查 | ✅ 已修复 |
