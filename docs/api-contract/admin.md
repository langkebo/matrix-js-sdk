# Admin 模块 API 契约

> 管理员相关 API 的 SDK 与后端接口契约

## 用户列表 / List Users

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_synapse/admin/v1/users` (v1) / `/_synapse/admin/v2/users` (v2) |
| HTTP 方法 | GET |
| SDK 方法 | `adminManager.getUsers(from?, limit?)` |
| SDK 模块 | `matrix-js-sdk/src/admin/index.ts` |
| 认证要求 | 是 (Admin Token) |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `from` | `string` | 否 | 分页偏移 (v2 使用 `from`，v1 使用 `offset`) |
| `limit` | `number` | 否 | 每页数量 (默认 100) |
| `offset` | `number` | 否 | 分页偏移 (v1 专用) |
| `name` | `string` | 否 | 用户名搜索 (v2 专用) |

### 响应结构

```typescript
interface ListUsersResponse {
    users: UserInfo[];
    total: number;
    next_token?: string;  // v2 专用，v1 不返回
}

interface UserInfo {
    user_id?: string;      // v2 返回
    name?: string;         // v1 返回用户名
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    is_guest?: boolean;
    user_type?: string;
    creation_ts?: number;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 非管理员用户 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/admin/user.rs` (`get_users` / `get_users_v2`)
- **SDK 封装**: `matrix-js-sdk/src/admin/index.ts` (`AdminManager.getUsers()`)
- **前端调用**: `hula/src/services/matrix/MatrixAdminService.ts` (`adminService.getUsers()`)

---

## 用户信息 / Get User

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_synapse/admin/v1/users/{user_id}` (v1) / `/_synapse/admin/v2/users/{user_id}` (v2) |
| HTTP 方法 | GET |
| SDK 方法 | `adminManager.getUser(userId)` |
| SDK 模块 | `matrix-js-sdk/src/admin/index.ts` |
| 认证要求 | 是 (Admin Token) |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | `string` | 是 | 用户 ID，URL 路径参数，需编码 |

### 响应结构

```typescript
interface GetUserResponse {
    user_id: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    is_guest?: boolean;
    user_type?: string;
    creation_ts?: number;
    devices?: DeviceInfo[];    // v2 返回
    threepids?: any[];          // v2 返回
    external_ids?: any[];       // v2 返回
}

interface DeviceInfo {
    device_id: string;
    display_name?: string;
    last_seen_ts?: number;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 非管理员用户 |
| 404 | 用户不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/admin/user.rs` (`get_user` / `get_user_v2`)
- **SDK 封装**: `matrix-js-sdk/src/admin/index.ts` (`AdminManager.getUser()`)
- **前端调用**: `hula/src/services/matrix/MatrixAdminService.ts` (`adminService.getUser()`)

---

## 房间统计 / Room Statistics

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_synapse/admin/v1/room_stats/{room_id}` |
| HTTP 方法 | GET |
| SDK 方法 | `adminManager.getRoomStats(roomId)` |
| SDK 模块 | `matrix-js-sdk/src/admin/index.ts` |
| 认证要求 | 是 (Admin Token) |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID，URL 路径参数，需编码 |

### 响应结构

```typescript
interface RoomStatsResponse {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    member_count?: number;
    message_count?: number;
    last_message_ts?: number;
    is_encrypted?: boolean;
    admin_count?: number;
    created_ts?: number;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 非管理员用户 |
| 404 | 房间不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/admin/room.rs` (`get_single_room_stats`)
- **SDK 封装**: `matrix-js-sdk/src/admin/index.ts` (`AdminManager.getRoomStats()`)
- **前端调用**: `hula/src/services/matrix/MatrixAdminService.ts` (未直接使用)

---

## 删除房间 / Delete Room

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_synapse/admin/v1/rooms/{room_id}` |
| HTTP 方法 | DELETE |
| SDK 方法 | `adminManager.deleteRoom(roomId, options?)` |
| SDK 模块 | `matrix-js-sdk/src/admin/index.ts` |
| 认证要求 | 是 (Admin Token) |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `room_id` | `string` | 是 | 房间 ID，URL 路径参数，需编码 |
| `options.purge` | `boolean` | 否 | 是否彻底清除 (默认 false) |
| `options.force_purge` | `boolean` | 否 | 是否强制清除 (默认 false) |

### 响应结构

```typescript
interface DeleteRoomResponse {
    room_id: string;
    deleted: boolean;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 删除成功 |
| 401 | 未认证或 Token 无效 |
| 403 | 非管理员用户 |
| 404 | 房间不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/admin/room.rs` (`delete_room`)
- **SDK 封装**: `matrix-js-sdk/src/admin/index.ts` (`AdminManager.deleteRoom()`)
- **前端调用**: `hula/src/services/matrix/MatrixAdminService.ts` (`adminService.deleteRoom()`)

---

## 用户注册 Nonce / Registration Nonce

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_synapse/admin/v1/register/nonce` |
| HTTP 方法 | GET |
| SDK 方法 | `adminManager.registerNonce()` |
| SDK 模块 | `matrix-js-sdk/src/admin/index.ts` |
| 认证要求 | 否 (但仅限 localhost 或配置 allow_external_access) |

### 请求参数

无。

### 响应结构

```typescript
interface NonceResponse {
    nonce: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 400 | 管理员注册未启用或 shared_secret 未配置 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/admin/register.rs` (`get_nonce`)
- **SDK 封装**: `matrix-js-sdk/src/admin/index.ts` (`AdminManager.registerNonce()`)
- **前端调用**: 无

---

## 管理员注册 / Admin Register

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_synapse/admin/v1/register` |
| HTTP 方法 | POST |
| SDK 方法 | `adminManager.adminRegister(options)` |
| SDK 模块 | `matrix-js-sdk/src/admin/index.ts` |
| 认证要求 | 否 (HMAC-SHA256 签名验证) |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `nonce` | `string` | 是 | 从 `/register/nonce` 获取的随机数 |
| `username` | `string` | 是 | 用户名 (1-255 字符) |
| `password` | `string` | 是 | 密码 (8-512 字符) |
| `admin` | `boolean` | 是 | 是否为管理员 |
| `displayname` | `string` | 否 | 显示名称 |
| `mac` | `string` | 是 | HMAC-SHA256 签名 |
| `user_type` | `string` | 否 | 用户类型 |

### HMAC 签名计算

```
message = nonce + "\x00" + username + "\x00" + password + "\x00" + admin_flag + "\x00" + user_type
mac = HMAC-SHA256(shared_secret, message).hex()
```

其中 `admin_flag` 为:
- 管理员: `"admin\x00\x00\x00"`
- 非管理员: `"notadmin"`

### 响应结构

```typescript
interface AdminRegisterResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    device_id: string;
    user_id: string;
    home_server: string;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 注册成功 |
| 400 | 参数错误、nonce 无效、HMAC 验证失败、用户已存在 |
| 401 | 需要额外认证 |
| 403 | 非管理员用户 (已存在管理员时) |
| 429 | 请求过于频繁 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/admin/register.rs` (`register`)
- **SDK 封装**: `matrix-js-sdk/src/admin/index.ts` (`AdminManager.adminRegister()`)
- **前端调用**: 无

---

## 附录：SDK AdminManager 完整方法列表

### 用户管理

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getUsers(from?, limit?)` | `/_synapse/admin/v1/v2/users` | 获取用户列表 | ✅ |
| `getUser(userId)` | `/_synapse/admin/v1/v2/users/{user_id}` | 获取用户信息 | ✅ |
| `createUser(userId, options)` | `/_synapse/admin/v1/v2/users/{user_id}` | 创建用户 | ✅ |
| `deactivateUser(userId)` | `/_synapse/admin/v1/deactivate/{user_id}` | 停用用户 | ✅ |
| `resetPassword(userId, password)` | `/_synapse/admin/v1/reset_password/{user_id}` | 重置密码 | ✅ |
| `setAdmin(userId, admin)` | `/_synapse/admin/v1/v2/users/{user_id}` | 设置管理员权限 | ✅ |
| `getUserDevices(userId)` | `/_synapse/admin/v1/v2/users/{user_id}/devices` | 获取用户设备列表 | ✅ |
| `deleteUserDevices(userId, deviceIds)` | `/_synapse/admin/v1/v2/users/{user_id}/delete_devices` | 删除用户设备 | ✅ |

### Shadow Ban

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `shadowBanUser(userId)` | `/_synapse/admin/v1/users/{user_id}/shadow_ban` | 影子封禁用户 | ✅ |
| `unshadowBanUser(userId)` | `DELETE /_synapse/admin/v1/users/{user_id}/shadow_ban` | 取消影子封禁 | ✅ |
| `getShadowBanStatus(userId)` | `/_synapse/admin/v1/users/{user_id}/shadow_ban` | 获取影子封禁状态 | ✅ |

### Rate Limit

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getRateLimit(userId)` | `/_synapse/admin/v1/users/{user_id}/rate_limit` | 获取用户速率限制 | ✅ |
| `setRateLimit(userId, config)` | `/_synapse/admin/v1/users/{user_id}/rate_limit` | 设置用户速率限制 | ✅ |
| `deleteRateLimit(userId)` | `DELETE /_synapse/admin/v1/users/{user_id}/rate_limit` | 删除用户速率限制 | ✅ |

### 房间管理

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getRooms(from?, limit?, searchTerm?)` | `/_synapse/admin/v1/rooms` | 获取房间列表 | ✅ |
| `getRoom(roomId)` | `/_synapse/admin/v1/rooms/{room_id}` | 获取房间信息 | ✅ |
| `deleteRoom(roomId, options?)` | `DELETE /_synapse/admin/v1/rooms/{room_id}` | 删除房间 | ✅ |
| `blockRoom(roomId, block)` | `/_synapse/admin/v1/rooms/{room_id}/block` | 封禁/解封房间 | ✅ |
| `getRoomMembers(roomId)` | `/_synapse/admin/v1/rooms/{room_id}/members` | 获取房间成员列表 | ✅ |
| `joinRoom(roomId, userId)` | `/_synapse/admin/v1/join/{room_id}` | 强制用户加入房间 | ✅ |
| `getRoomStats(roomId)` | `/_synapse/admin/v1/room_stats/{room_id}` | 获取房间统计 | ✅ 新增 |
| `makeRoomAdmin(roomId, userId?)` | `/_synapse/admin/v1/rooms/{room_id}/make_room_admin` | 设置房间管理员 | ✅ |

### 服务器管理

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getServerVersion()` | `/_synapse/admin/v1/server_version` | 获取服务器版本 | ✅ |
| `getServerStats()` | `/_synapse/admin/v1/statistics` | 获取服务器统计 | ✅ |
| `getServerConfig()` | `/_synapse/admin/v1/config` | 获取服务器配置 | ✅ |
| `whois(userId)` | `/_synapse/admin/v1/whois/{user_id}` | 获取用户 WHOIS | ✅ |

### 注册令牌

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getRegistrationTokens()` | `/_synapse/admin/v1/registration_tokens` | 获取注册令牌列表 | ✅ |
| `createRegistrationToken(options)` | `/_synapse/admin/v1/registration_tokens` | 创建注册令牌 | ✅ |
| `updateRegistrationToken(token, options)` | `POST /_synapse/admin/v1/registration_tokens/{token}` | 更新注册令牌 | ✅ |
| `deleteRegistrationToken(token)` | `DELETE /_synapse/admin/v1/registration_tokens/{token}` | 删除注册令牌 | ✅ |

### 管理员注册

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `registerNonce()` | `/_synapse/admin/v1/register/nonce` | 获取注册 Nonce | ✅ 新增 |
| `adminRegister(options)` | `/_synapse/admin/v1/register` | 管理员注册用户 | ✅ 新增 |

### 媒体管理

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getMedia(limit?, from?)` | `/_synapse/admin/v1/media` | 获取媒体列表 | ✅ |
| `deleteMedia(mediaId)` | `DELETE /_synapse/admin/v1/media/{media_id}` | 删除媒体 | ✅ |
| `quarantineMedia(mediaId)` | `/_synapse/admin/v1/media/quarantine/{media_id}` | 隔离媒体 | ✅ |
| `purgeMediaCache(beforeTs?)` | `/_synapse/admin/v1/purge_media_cache` | 清理媒体缓存 | ✅ |

### 联邦管理

| 方法 | 路由 | 说明 | 状态 |
|------|------|------|------|
| `getFederationDestinations()` | `/_synapse/admin/v1/federation/destinations` | 获取联邦目的地列表 | ✅ |
| `getFederationDestination(destination)` | `/_synapse/admin/v1/federation/destinations/{destination}` | 获取联邦目的地状态 | ✅ |
| `resetFederationConnection(destination)` | `/_synapse/admin/v1/federation/destinations/{destination}/reset_connection` | 重置联邦连接 | ✅ |

---

## 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0.0 | 2026-03-29 | 初始版本，包含 Admin API 契约文档 |
| v1.1.0 | 2026-03-29 | 新增 `getRoomStats()`, `registerNonce()`, `adminRegister()` 方法 |
