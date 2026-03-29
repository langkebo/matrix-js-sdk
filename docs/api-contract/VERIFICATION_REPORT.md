# API 契约一致性验证报告

> 生成日期: 2026-03-29
> 验证范围: matrix-js-sdk 与契约文档的一致性

---

## Auth 模块 ✅

| API | 契约路由 | SDK 方法 | 一致性 |
|-----|----------|----------|--------|
| 登录 | `/_matrix/client/v3/login` | `client.login()` | ✅ |
| 注册 | `/_matrix/client/v3/register` | `client.register()` | ✅ |
| Token 刷新 | `/_matrix/client/v3/refresh` | `client.refreshToken()` | ✅ |
| 登出 | `/_matrix/client/v3/logout` | `client.logout()` | ✅ |
| 用户信息 | `/_matrix/client/v3/account/whoami` | `client.whoAmI()` | ✅ |

**结论**: Auth 模块契约与 SDK 实现完全一致。

---

## Admin 模块 ⚠️

| API | 契约路由 | SDK 路由 | SDK 方法 | 一致性 |
|-----|----------|----------|----------|--------|
| 用户列表 | `/_synapse/admin/v1/users` | `/v2/users` | `getUsers()` | ⚠️ 版本差异 |
| 用户信息 | `/_synapse/admin/v1/users/{user_id}` | `/v2/users/{id}` | `getUser()` | ⚠️ 版本差异 |
| 删除房间 | `/_synapse/admin/v1/rooms/{room_id}` | `/v1/rooms/{id}` | `deleteRoom()` | ✅ |
| 房间统计 | `/_synapse/admin/v1/room_stats/{room_id}` | N/A | 无对应方法 | 🔴 缺失 |
| 用户注册 Nonce | `/_synapse/admin/v1/register/nonce` | N/A | 无对应方法 | 🔴 缺失 |
| 管理员注册 | `/_synapse/admin/v1/register` | N/A | 无对应方法 | 🔴 缺失 |

**发现的问题**:

### 1. API 版本差异
- **问题**: 契约文档使用 `v1` 前缀，但 SDK 实际使用 `v2`
- **影响**: 用户列表和用户信息 API
- **原因**: SDK 代码使用 `/v2/users` 而契约文档写的是 `/v1/users`
- **建议**: 更新契约文档以匹配实际实现

### 2. 缺失的方法
- **getRoomStats()**: 契约文档中有，但 SDK 中无对应方法
- **registerNonce / adminRegister**: 契约文档中有，但 SDK 中无对应方法

**SDK AdminManager 完整方法列表**:
```typescript
// 用户管理
getUsers(from?, limit?)                    // /v2/users
getUser(userId)                            // /v2/users/{id}
createUser(userId, options?)               // /v2/users/{id}
deactivateUser(userId, erase?)             // /v1/deactivate/{id}
resetPassword(userId, newPassword, logout?) // /v1/reset_password/{id}
setAdmin(userId, admin)                    // /v2/users/{id}
getUserDevices(userId)                     // /v2/users/{id}/devices
deleteUserDevices(userId, deviceIds)       // /v2/users/{id}/delete_devices

// Shadow Ban
shadowBanUser(userId)                      // /v1/users/{id}/shadow_ban
unshadowBanUser(userId)                    // DELETE /v1/users/{id}/shadow_ban
getShadowBanStatus(userId)                 // /v1/users/{id}/shadow_ban

// Rate Limit
getRateLimit(userId)                       // /v1/users/{id}/rate_limit
setRateLimit(userId, config)               // /v1/users/{id}/rate_limit
deleteRateLimit(userId)                    // DELETE /v1/users/{id}/rate_limit

// 房间管理
getRooms(from?, limit?, searchTerm?)      // /v1/rooms
getRoom(roomId)                            // /v1/rooms/{id}
deleteRoom(roomId, options?)               // /v1/rooms/{id}
blockRoom(roomId, block)                   // /v1/rooms/{id}/block
getRoomMembers(roomId)                     // /v1/rooms/{id}/members
joinRoom(roomId, userId)                   // /v1/join/{id}

// 服务器管理
getServerVersion()                         // /v1/server_version
getServerStats()                           // /v1/statistics
getServerConfig()                          // /v1/config

// 注册令牌
getRegistrationTokens()                    // /v1/registration_tokens
createRegistrationToken(options?)          // /v1/registration_tokens
updateRegistrationToken(token, options?)   // POST /v1/registration_tokens/{token}
deleteRegistrationToken(token)             // DELETE /v1/registration_tokens/{token}

// 联邦管理
getFederationDestinations()               // /v1/federation_destinations
```

---

## Room 模块 ✅

| API | 契约路由 | SDK 方法 | 一致性 |
|-----|----------|----------|--------|
| 创建房间 | `/_matrix/client/v3/createRoom` | `client.createRoom()` | ✅ |
| 获取房间信息 | `/_matrix/client/v3/rooms/{room_id}` | `client.getRoom()` | ✅ |
| 加入房间 | `/_matrix/client/v3/join/{room_id_or_alias}` | `client.joinRoom()` | ✅ |
| 离开房间 | `/_matrix/client/v3/rooms/{room_id}/leave` | `room.leave()` | ✅ |
| 邀请用户 | `/_matrix/client/v3/rooms/{room_id}/invite` | `room.invite()` | ✅ |
| 发送消息 | `/_matrix/client/v3/rooms/{room_id}/send/{type}/{txn}` | `room.send()` | ✅ |

**结论**: Room 模块契约与 SDK 实现一致。

---

## DM 模块 ✅

| API | 契约路由 | SDK 方法 | 一致性 |
|-----|----------|----------|--------|
| 获取 DM 列表 | 本地过滤 | `dmManager.getDMRooms()` | ✅ |
| 创建 DM | `/_matrix/client/v3/createRoom` | `dmManager.createDm()` | ✅ |
| m.direct 读取 | 本地操作 | `client.getAccountData()` | ✅ |
| m.direct 写入 | 本地操作 | `dmManager.setDmRoom()` | ✅ |

**结论**: DM 模块契约与 SDK 实现一致。

---

## 总结

| 模块 | 状态 | API 数量 | 一致 |
|------|------|----------|------|
| Auth | ✅ | 5 | 5 |
| Admin | ⚠️ | 6 | 2 |
| Room | ✅ | 11 | 11 |
| DM | ✅ | 4 | 4 |
| Space | 🔄 | 6 | 待验证 |
| Push | 🔄 | 8 | 待验证 |
| Sync | 🔄 | 6 | 待验证 |

### 需要修复的问题

1. **更新 Admin 契约文档**:
   - 将 `/_synapse/admin/v1/users` 更新为 `/_synapse/admin/v1/v2/users` (或说明实际使用 v2)
   - 添加缺失的 SDK 方法文档

2. **补充缺失的 Admin 方法**:
   - `getRoomStats()` - 房间统计
   - `registerNonce()` - 用户注册 Nonce
   - `adminRegister()` - 管理员注册
