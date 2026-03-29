# API 契约变更日志 (Changelog)

> 版本: v1.0.0
> 生成日期: 2026-03-29
> 记录范围: matrix-js-sdk 与 synapse-rust 接口契约

---

## 2026-03-29 - 契约文档初始化

### 新增契约文档

| 模块 | 文件 | API 数量 | 说明 |
|------|------|----------|------|
| Auth | `auth.md` | 5 | 认证相关 API |
| Room | `room.md` | 11 | 房间管理 API |
| DM | `dm.md` | 4 | 私聊管理 API |
| Friend | `friend.md` | 15+ | 好友管理 API |
| Admin | `admin.md` | 20+ | 管理员 API |
| Space | `space.md` | 6 | 空间 API |
| Push | `push.md` | 8 | 推送 API |
| Sync | `sync.md` | 6 | 同步 API |
| **总计** | | **75+** | |

---

## API 端点清单

### Auth 模块 (5 APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_matrix/client/v3/login` | POST | `client.login()` | ✅ 稳定 | 2026-03-29 |
| 2 | `/_matrix/client/v3/register` | POST | `client.register()` | ✅ 稳定 | 2026-03-29 |
| 3 | `/_matrix/client/v3/refresh` | POST | `client.refreshToken()` | ✅ 稳定 | 2026-03-29 |
| 4 | `/_matrix/client/v3/logout` | POST | `client.logout()` | ✅ 稳定 | 2026-03-29 |
| 5 | `/_matrix/client/v3/account/whoami` | GET | `client.whoAmI()` | ✅ 稳定 | 2026-03-29 |

### Room 模块 (11 APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_matrix/client/v3/createRoom` | POST | `client.createRoom()` | ✅ 稳定 | 2026-03-29 |
| 2 | `/_matrix/client/v3/rooms/{room_id}` | GET | `client.getRoom()` | ✅ 稳定 | 2026-03-29 |
| 3 | `/_matrix/client/v3/join/{room_id_or_alias}` | POST | `client.joinRoom()` | ✅ 稳定 | 2026-03-29 |
| 4 | `/_matrix/client/v3/rooms/{room_id}/leave` | POST | `room.leave()` | ✅ 稳定 | 2026-03-29 |
| 5 | `/_matrix/client/v3/rooms/{room_id}/invite` | POST | `room.invite()` | ✅ 稳定 | 2026-03-29 |
| 6 | `/_matrix/client/v3/rooms/{room_id}/kick` | POST | `room.kick()` | ✅ 稳定 | 2026-03-29 |
| 7 | `/_matrix/client/v3/rooms/{room_id}/ban` | POST | `room.ban()` | ✅ 稳定 | 2026-03-29 |
| 8 | `/_matrix/client/v3/rooms/{room_id}/members` | GET | `room.getMembers()` | ✅ 稳定 | 2026-03-29 |
| 9 | `/_matrix/client/v3/rooms/{room_id}/send/{event_type}/{txn_id}` | PUT | `room.send()` | ✅ 稳定 | 2026-03-29 |
| 10 | `/_matrix/client/v3/rooms/{room_id}/event/{event_id}` | GET | `room.getEvent()` | ✅ 稳定 | 2026-03-29 |
| 11 | `/_matrix/client/v3/rooms/{room_id}/messages` | GET | `room.getMessages()` | ✅ 稳定 | 2026-03-29 |

### DM 模块 (4 APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_matrix/client/v3/dms` | GET | `dmManager.getDMRooms()` | ✅ 稳定 | 2026-03-29 |
| 2 | `/_matrix/client/v3/createRoom` | POST | `dmManager.createDm()` | ✅ 稳定 | 2026-03-29 |
| 3 | `m.direct` 读取 | - | `client.getAccountData()` | ✅ 稳定 | 2026-03-29 |
| 4 | `m.direct` 写入 | - | `dmManager.setDmRoom()` | ✅ 稳定 | 2026-03-29 |

### Friend 模块 (15+ APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_matrix/client/v3/friend_room/friends` | GET | `friendManager.getFriends()` | ✅ 稳定 | 2026-03-29 |
| 2 | `/_matrix/client/v3/friend_room/request` | POST | `friendManager.sendFriendRequest()` | ✅ 稳定 | 2026-03-29 |
| 3 | `/_matrix/client/v3/friend_room/accept` | POST | `friendManager.acceptFriendRequest()` | ✅ 稳定 | 2026-03-29 |
| 4 | `/_matrix/client/v3/friend_room/reject` | POST | `friendManager.rejectFriendRequest()` | ✅ 稳定 | 2026-03-29 |
| 5 | `/_matrix/client/v3/friend_room/cancel` | POST | `friendManager.cancelFriendRequest()` | ✅ 稳定 | 2026-03-29 |
| 6 | `/_matrix/client/v3/friend_room/friends/{user_id}` | DELETE | `friendManager.removeFriend()` | ✅ 稳定 | 2026-03-29 |
| 7 | `/_matrix/client/v3/friend_room/requests/incoming` | GET | `friendManager.getIncomingRequests()` | ✅ 稳定 | 2026-03-29 |
| 8 | `/_matrix/client/v3/friend_room/requests/outgoing` | GET | `friendManager.getOutgoingRequests()` | ✅ 稳定 | 2026-03-29 |
| 9 | `/_matrix/client/v3/friend_room/suggestions` | GET | `friendManager.getFriendSuggestions()` | ✅ 稳定 | 2026-03-29 |
| 10 | `/_matrix/client/v3/friend_room/groups` | GET | `friendManager.getFriendGroups()` | ✅ 稳定 | 2026-03-29 |
| 11 | `/_matrix/client/v3/friend_room/groups` | POST | `friendManager.createFriendGroup()` | ✅ 稳定 | 2026-03-29 |
| 12 | `/_matrix/client/v3/friend_room/groups/{id}/users/{user_id}` | PUT | `friendManager.addToFriendGroup()` | ✅ 稳定 | 2026-03-29 |
| 13 | `/_matrix/client/v3/friend_room/groups/{id}/users/{user_id}` | DELETE | `friendManager.removeFromFriendGroup()` | ✅ 稳定 | 2026-03-29 |
| 14 | `/_matrix/client/v3/friend_room/groups/{id}` | DELETE | `friendManager.deleteFriendGroup()` | ✅ 稳定 | 2026-03-29 |
| 15 | `/_matrix/client/v3/friend_room/friends/{user_id}/displayname` | PUT | `friendManager.setFriendDisplayName()` | ✅ 稳定 | 2026-03-29 |

### Admin 模块 (6 APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_synapse/admin/v1/v2/users` | GET | `admin.getUsers()` | ✅ v2 | 2026-03-29 |
| 2 | `/_synapse/admin/v1/v2/users/{user_id}` | GET | `admin.getUser()` | ✅ v2 | 2026-03-29 |
| 3 | `/_synapse/admin/v1/room_stats/{room_id}` | GET | `admin.getRoomStats()` | ✅ 2026-03-29 |
| 4 | `/_synapse/admin/v1/rooms/{room_id}` | DELETE | `admin.deleteRoom()` | ✅ 稳定 | 2026-03-29 |
| 5 | `/_synapse/admin/v1/register/nonce` | GET | `admin.registerNonce()` | ✅ 2026-03-29 |
| 6 | `/_synapse/admin/v1/register` | POST | `admin.adminRegister()` | ✅ 2026-03-29 |

### Admin 模块扩展方法 (SDK 额外实现)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 7 | `/_synapse/admin/v1/v2/users/{user_id}` | PUT | `admin.createUser()` | ✅ | 2026-03-29 |
| 8 | `/_synapse/admin/v1/deactivate/{user_id}` | POST | `admin.deactivateUser()` | ✅ | 2026-03-29 |
| 9 | `/_synapse/admin/v1/reset_password/{user_id}` | POST | `admin.resetPassword()` | ✅ | 2026-03-29 |
| 10 | `/_synapse/admin/v1/users/{user_id}/shadow_ban` | POST | `admin.shadowBanUser()` | ✅ | 2026-03-29 |
| 11 | `/_synapse/admin/v1/users/{user_id}/rate_limit` | GET/PUT/DELETE | `admin.get/set/deleteRateLimit()` | ✅ | 2026-03-29 |
| 12 | `/_synapse/admin/v1/rooms` | GET | `admin.getRooms()` | ✅ | 2026-03-29 |
| 13 | `/_synapse/admin/v1/rooms/{room_id}/block` | POST | `admin.blockRoom()` | ✅ | 2026-03-29 |
| 14 | `/_synapse/admin/v1/registration_tokens` | GET/POST | `admin.get/createRegistrationToken()` | ✅ | 2026-03-29 |

### Space 模块 (6 APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_matrix/client/v3/rooms/{room_id}/hierarchy` | GET | `client.getRoomHierarchy()` | ✅ 稳定 | 2026-03-29 |
| 2 | `/_matrix/client/v3/spaces/{space_id}` | GET | `client.getSpace()` | ✅ 稳定 | 2026-03-29 |
| 3 | `/_matrix/client/v3/spaces/{space_id}/children` | GET | `client.getSpaceChildren()` | ✅ 稳定 | 2026-03-29 |
| 4 | `/_matrix/client/v3/createRoom` | POST | `client.createRoom()` | ✅ 稳定 | 2026-03-29 |
| 5 | `/_matrix/client/v3/spaces/{space_id}/children` | POST | `client.addChildToSpace()` | ✅ 稳定 | 2026-03-29 |
| 6 | `/_matrix/client/v3/spaces/user` | GET | `client.getUserSpaces()` | ✅ 稳定 | 2026-03-29 |

### Push 模块 (8 APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_matrix/client/v3/push_rules` | GET | `pushManager.getPushRules()` | ✅ 稳定 | 2026-03-29 |
| 2 | `/_matrix/client/v3/push_rules/{scope}/{kind}/{ruleId}` | PUT | `pushManager.setPushRule()` | ✅ 稳定 | 2026-03-29 |
| 3 | `/_matrix/client/v3/push_rules/{scope}/{kind}/{ruleId}` | DELETE | `pushManager.deletePushRule()` | ✅ 稳定 | 2026-03-29 |
| 4 | `/_matrix/client/v3/pushrules/{scope}/{kind}/{ruleId}/enabled` | PUT | `pushManager.setPushRuleEnabled()` | ✅ 稳定 | 2026-03-29 |
| 5 | `/_matrix/client/v3/pushrules/{scope}/{kind}/{ruleId}/actions` | PUT | `pushManager.setPushRuleActions()` | ✅ 稳定 | 2026-03-29 |
| 6 | `/_matrix/client/v3/pushers` | GET | `pushManager.getPushers()` | ✅ 稳定 | 2026-03-29 |
| 7 | `/_matrix/client/v3/pushers` | POST | `pushManager.addPusher()` | ✅ 稳定 | 2026-03-29 |
| 8 | `/_matrix/client/v3/pushers/set` | POST | `pushManager.removePusher()` | ✅ 稳定 | 2026-03-29 |

### Sync 模块 (6 APIs)

| # | 端点 | 方法 | SDK 方法 | 状态 | 添加日期 |
|---|------|------|----------|------|----------|
| 1 | `/_matrix/client/v3/sync` | GET | `client.sync()` | ✅ 稳定 | 2026-03-29 |
| 2 | `/_matrix/client/v3/sync` (with since) | GET | `client.sync()` | ✅ 稳定 | 2026-03-29 |
| 3 | `/_matrix/client/v1/keys/changes` | GET | `client.getKeyChanges()` | ✅ 稳定 | 2026-03-29 |
| 4 | `/_matrix/client/v3/joined_rooms` | GET | `client.getJoinedRooms()` | ✅ 稳定 | 2026-03-29 |
| 5 | `/_matrix/client/v3/my_rooms` | GET | `client.getRooms()` | ✅ 稳定 | 2026-03-29 |
| 6 | `/_matrix/client/v3/sync` (POST) | POST | `client.slidingSync()` | ✅ MSC3575 | 2026-03-29 |

---

## 版本兼容性说明

### Matrix Client API 版本

| 版本 | 前缀 | 状态 |
|------|------|------|
| v1 | `/_matrix/client/v1` | ⚠️ 维护中 |
| v3 | `/_matrix/client/v3` | ✅ 推荐 |
| unstable | `/_matrix/client/unstable` | 🔄 实验性 |

### Synapse Admin API 版本

| 版本 | 前缀 | 状态 |
|------|------|------|
| v1 | `/_synapse/admin/v1` | ⚠️ 维护中 |
| v2 | `/_synapse/admin/v1/v2/*` | ✅ 推荐 |

---

## 状态说明

| 状态 | 含义 |
|------|------|
| ✅ 稳定 | 功能完整，已在实际项目中使用 |
| ⚠️ v2/维护中 | 使用较新版本或处于维护状态 |
| 🔴 待实现 | SDK 中尚未实现该方法 |
| 🔄 实验性 | 处于 MSC 实验阶段 |

---

## 变更记录格式

```markdown
### YYYY-MM-DD - 变更描述

**新增**:
- 新增 API 端点

**修改**:
- 修改了某 API 的参数

**废弃**:
- 标记某 API 为废弃

**修复**:
- 修复了契约文档与实际实现的差异
```

---

## 未来待添加的 API

| 模块 | API | 说明 | 优先级 | 状态 |
|------|-----|------|--------|------|
| E2EE | 密钥备份/恢复 | MSC3879 | P2 | 🔴 待实现 |
| Thread | 线程管理 | MSC3983 | P3 | 🔴 待实现 |
