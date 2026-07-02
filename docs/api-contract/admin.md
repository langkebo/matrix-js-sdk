---
module: admin
generated_from: docs/api-contract/generated/modules/admin.json
generated_hash: sha256-152f2cd98553caf8ca7ee2f70f0e20fabed2ec86f6d9b4e1f3cda515911531b8
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Admin 模块契约

> 审查来源: `synapse-rust/src/web/routes/admin/mod.rs` 及其子模块
> 挂载版本: `/_synapse/admin/v1`
> 更新日期: 2026-05-11

## 认证要求

- 管理端大多数端点使用 `AdminUser` 提取器，要求有效管理员 token。
- `/_synapse/admin/v1/register/nonce` 与 `/_synapse/admin/v1/register` 为管理员注册特例，不走普通管理员 token。

## 用户管理

| 方法   | 路径                                                            | 说明               |
| ------ | --------------------------------------------------------------- | ------------------ |
| GET    | `/_synapse/admin/v1/users`                                      | v1 用户列表        |
| GET    | `/_synapse/admin/v1/users/{user_id}`                            | v1 用户详情        |
| DELETE | `/_synapse/admin/v1/users/{user_id}`                            | 删除用户           |
| PUT    | `/_synapse/admin/v1/users/{user_id}/admin`                      | 设置管理员         |
| POST   | `/_synapse/admin/v1/users/{user_id}/evict`                      | 从全部房间逐出用户 |
| POST   | `/_synapse/admin/v1/users/{user_id}/deactivate`                 | 停用用户           |
| POST   | `/_synapse/admin/v1/users/{user_id}/password`                   | 重置密码           |
| GET    | `/_synapse/admin/v1/users/{user_id}/rooms`                      | 查看用户房间       |
| POST   | `/_synapse/admin/v1/users/{user_id}/login`                      | 以用户身份登录     |
| POST   | `/_synapse/admin/v1/users/{user_id}/logout`                     | 登出用户全部设备   |
| GET    | `/_synapse/admin/v1/users/{user_id}/devices`                    | 查看用户设备       |
| POST   | `/_synapse/admin/v1/users/{user_id}/devices/delete`             | 批量删除用户设备   |
| DELETE | `/_synapse/admin/v1/users/{user_id}/devices/{device_id}`        | 删除单设备         |
| POST   | `/_synapse/admin/v1/users/{user_id}/devices/{device_id}/delete` | 删除单设备兼容路由 |
| GET    | `/_synapse/admin/v2/users`                                      | v2 用户列表        |
| GET    | `/_synapse/admin/v2/users/{user_id}`                            | v2 用户详情        |
| PUT    | `/_synapse/admin/v2/users/{user_id}`                            | v2 创建或更新用户  |
| GET    | `/_synapse/admin/v1/user_stats`                                 | 用户统计列表       |
| GET    | `/_synapse/admin/v1/users/{user_id}/stats`                      | 单用户统计         |
| POST   | `/_synapse/admin/v1/users/batch`                                | 批量创建用户       |
| POST   | `/_synapse/admin/v1/users/batch_deactivate`                     | 批量停用用户       |
| GET    | `/_synapse/admin/v1/user_sessions/{user_id}`                    | 查询会话           |
| POST   | `/_synapse/admin/v1/user_sessions/{user_id}/invalidate`         | 失效会话           |
| GET    | `/_synapse/admin/v1/account/{user_id}`                          | 账户详情           |
| POST   | `/_synapse/admin/v1/account/{user_id}`                          | 更新账户详情       |

## 房间与 Space 管理

| 方法       | 路径                                                          | 说明                |
| ---------- | ------------------------------------------------------------- | ------------------- |
| GET        | `/_synapse/admin/v1/rooms`                                    | 房间列表            |
| GET/DELETE | `/_synapse/admin/v1/rooms/{room_id}`                          | 房间详情 / 删除房间 |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/delete`                   | 兼容删除房间        |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/members`                  | 房间成员            |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/state`                    | 房间状态            |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/messages`                 | 房间消息            |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/aliases`                  | 房间别名            |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/version`                  | 房间版本            |
| POST/GET   | `/_synapse/admin/v1/rooms/{room_id}/block`                    | 封禁 / 查询封禁状态 |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/unblock`                  | 解封房间            |
| POST/PUT   | `/_synapse/admin/v1/rooms/{room_id}/make_admin`               | 设置房间管理员      |
| POST       | `/_synapse/admin/v1/purge_history`                            | 清理历史；响应含 `purge_id` 和可选 `audit_id`（v10 审计字段） |
| POST       | `/_synapse/admin/v1/purge_room`                               | 清空房间            |
| POST       | `/_synapse/admin/v1/shutdown_room`                            | 关闭房间            |
| GET        | `/_synapse/admin/v1/spaces`                                   | space 列表          |
| GET/DELETE | `/_synapse/admin/v1/spaces/{space_id}`                        | space 详情 / 删除   |
| GET        | `/_synapse/admin/v1/spaces/{space_id}/users`                  | space 用户          |
| GET        | `/_synapse/admin/v1/spaces/{space_id}/rooms`                  | space 房间          |
| GET        | `/_synapse/admin/v1/spaces/{space_id}/stats`                  | space 统计          |
| GET        | `/_synapse/admin/v1/room_stats`                               | 房间统计列表        |
| GET        | `/_synapse/admin/v1/room_stats/{room_id}`                     | 单房间统计          |
| PUT/DELETE | `/_synapse/admin/v1/rooms/{room_id}/members/{user_id}`        | 加入 / 移除成员     |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/ban/{user_id}`            | 封禁指定用户        |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/ban`                      | 封禁请求体指定用户  |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/unban/{user_id}`          | 解封指定用户        |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/kick/{user_id}`           | 踢出指定用户        |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/kick`                     | 踢出请求体指定用户  |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/listings`                 | 房间公开列表项      |
| PUT/DELETE | `/_synapse/admin/v1/rooms/{room_id}/listings/public`          | 设置/移除公开列表   |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/event_context/{event_id}` | 事件上下文          |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/token_sync`               | token 同步          |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/search`                   | 房间内搜索          |
| POST       | `/_synapse/admin/v1/rooms/search`                             | 全局房间搜索        |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/forward_extremities`      | extremities         |

## 安全、通知、媒体、服务器

| 方法                | 路径                                                        | 说明                        |
| ------------------- | ----------------------------------------------------------- | --------------------------- |
| POST/DELETE         | `/_synapse/admin/v1/users/{user_id}/shadow_ban`             | 影子封禁 / 解封             |
| GET/PUT/DELETE      | `/_synapse/admin/v1/users/{user_id}/rate_limit`             | 用户限速                    |
| GET/POST/DELETE     | `/_synapse/admin/v1/users/{user_id}/override_ratelimit`     | 覆盖限速                    |
| POST/GET/PUT/DELETE | `/_synapse/admin/v1/notifications...`                       | 系统通知 CRUD               |
| POST                | `/_synapse/admin/v1/send_server_notice`                     | 发送 server notice          |
| GET                 | `/_synapse/admin/v1/server_notices`                         | notice 列表                 |
| GET/PUT             | `/_synapse/admin/v1/users/{user_id}/notification`           | 用户通知设置                |
| GET/DELETE          | `/_synapse/admin/v1/users/{user_id}/pushers...`             | 管理用户 pushers            |
| GET/DELETE          | `/_synapse/admin/v1/media...`                               | 管理媒体与用户媒体          |
| GET                 | `/_synapse/admin/info`                                      | 管理端信息                  |
| GET                 | `/_synapse/admin/v1/server_version`                         | 服务器版本                  |
| POST                | `/_synapse/admin/v1/purge_media_cache`                      | 清理媒体缓存                |
| POST                | `/_synapse/admin/v1/restart`                                | 重启                        |
| GET                 | `/_synapse/admin/v1/statistics`                             | 服务器统计                  |
| GET                 | `/_synapse/admin/v1/status`                                 | 服务器状态                  |
| GET                 | `/_synapse/admin/v1/whois/{user_id}`                        | whois                       |
| GET                 | `/_synapse/admin/v1/health`                                 | 健康检查                    |
| GET                 | `/_synapse/admin/v1/config`                                 | 配置                        |
| GET                 | `/_synapse/admin/v1/experimental_features`                  | 实验特性                    |
| GET                 | `/_synapse/admin/v1/backups`                                | 备份信息                    |
| GET/PUT             | `/_synapse/admin/v1/saml/config`                            | 读取/更新 SAML 配置         |
| GET                 | `/_synapse/admin/v1/saml/mappings`                          | SAML 用户映射列表           |
| GET/PUT/DELETE      | `/_synapse/admin/v1/saml/mapping/{name_id}`                 | 单个 SAML 映射管理          |
| POST                | `/_synapse/admin/v1/saml/logout`                            | 发起 SAML 登出              |
| GET/POST            | `/_synapse/admin/v1/application_services`                   | 应用服务列表 / 注册应用服务 |
| GET/PUT/DELETE      | `/_synapse/admin/v1/application_services/{service_id}`      | 查询 / 更新 / 删除应用服务  |
| POST                | `/_synapse/admin/v1/application_services/{service_id}/ping` | Ping 应用服务               |

## 令牌、联邦、审计、报表、保留策略、管理员注册

| 方法            | 路径                                                     | 说明               |
| --------------- | -------------------------------------------------------- | ------------------ |
| GET/POST        | `/_synapse/admin/v1/registration_tokens`                 | 注册令牌列表/创建  |
| GET/DELETE/POST | `/_synapse/admin/v1/registration_tokens/{token}`         | 查看/删除/更新令牌 |
| GET/POST        | `/_synapse/admin/v1/audit/events`                        | 审计事件列表/记录  |
| GET             | `/_synapse/admin/v1/audit/events/{event_id}`             | 审计详情           |
| GET             | `/_synapse/admin/v1/federation/blacklist`                | 获取联邦黑名单     |
| POST            | `/_synapse/admin/v1/federation/blacklist/add`            | 添加到联邦黑名单   |
| POST            | `/_synapse/admin/v1/federation/blacklist/remove`         | 从联邦黑名单移除   |
| GET             | `/_synapse/admin/v1/federation/destinations`             | 获取联邦目的地列表 |
| GET             | `/_synapse/admin/v1/federation/status/{server_name}`     | 获取联邦服务器状态 |
| POST            | `/_synapse/admin/v1/federation/disconnect/{server_name}` | 断开联邦连接       |
| POST            | `/_synapse/admin/v1/federation/reconnect/{server_name}`  | 重连联邦服务器     |
| GET/DELETE      | `/_synapse/admin/v1/reports...`                          | 举报与房间举报     |
| GET/POST        | `/_synapse/admin/v1/retention/policy...`                 | retention 策略     |
| POST            | `/_synapse/admin/v1/retention/run`                       | 执行保留策略任务   |
| GET             | `/_synapse/admin/v1/retention/status`                    | retention 状态     |
| GET             | `/_synapse/admin/v1/register/nonce`                      | 管理员注册 nonce   |
| POST            | `/_synapse/admin/v1/register`                            | 管理员注册用户     |

## 用户 Admin 状态与登录失败

| 方法 | 路径                                          | 说明                               |
| ---- | --------------------------------------------- | ---------------------------------- |
| GET  | `/_synapse/admin/v1/users/{user_id}/admin`    | 检查用户是否是管理员               |
| PUT  | `/_synapse/admin/v1/users/{user_id}/admin`    | 设置用户管理员状态                 |
| GET  | `/_synapse/admin/v1/account_status/{user_id}` | 获取用户账户状态（锁定/暂停/验证） |
| GET  | `/_synapse/admin/v1/login/failures`           | 获取登录失败记录                   |
| POST | `/_synapse/admin/v1/deactivate/{user_id}`     | 停用用户（兼容路由）               |

## 常见状态码

- `200` / `201`: 查询、修改、创建成功
- `400`: 参数不合法、分页或过滤条件无效
- `401` / `403`: 缺少管理员认证、token 无效或当前用户无管理员权限
- `404`: 用户、房间、任务、媒体或令牌不存在
- `409`: 重复创建资源、冲突性更新或当前状态不允许执行该管理操作
- `500`: 存储层、通知投递或后台任务执行失败

## 常见响应

- 列表接口: `users`、`rooms`、`spaces`、`reports`、`notifications` 等数组
- 统计接口: `total`、计数或统计对象
- 写接口: 通常返回空对象、状态对象或刚创建的资源标识
- 管理员注册:
    - `nonce` 接口返回 `{ "nonce": "..." }`
    - `register` 返回登录结果，包含 `access_token` `user_id` `device_id` 等

## 代码定位

- 聚合入口: `synapse-rust/src/web/routes/admin/mod.rs`
- 用户: `admin/user.rs`
- 房间: `admin/room.rs`
- 安全: `admin/security.rs`
- 通知: `admin/notification.rs`
- 媒体: `admin/media.rs`
- 服务器: `admin/server.rs`
- 令牌: `admin/token.rs`
- 联邦: `admin/federation.rs`
- 审计: `admin/audit.rs`
- 报表: `admin/report.rs`
- 保留策略: `admin/retention.rs`
- 注册: `admin/register.rs`

## SDK 契约对齐（2026-04-23 更新）

下列 SDK 方法与后端一一校对，均有单测覆盖（`spec/unit/admin.spec.ts` / `admin-extended.spec.ts` / `admin-new-endpoints.spec.ts`）：

### 修正（breaking）

| SDK 方法                        | 变更                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `setAdmin`                      | `PUT /v2/users/{id}` body `{admin}` → **`PUT /v1/users/{id}/admin`** body `{admin}`                     |
| `addToFederationBlacklist`      | `POST /v1/federation/blacklist/add` → **`POST /v1/federation/blacklist/{server_name}`** body `{reason}` |
| `removeFromFederationBlacklist` | `POST /v1/federation/blacklist/remove` → **`DELETE /v1/federation/blacklist/{server_name}`**            |
| `getRoomStats(roomId)`          | `/v1/rooms/{id}/statistics` → **`/v1/room_stats/{id}`**                                                 |
| `getAccountStatus`              | `/v1/account_status/{id}` → **`/v1/account/{id}`**                                                      |
| `getServerInfo`                 | 主路径 **`GET /v1/info`**，对旧部署保留 `404 -> /v1/server_info` 兼容回退                               |
| `getServerHealth`               | 主路径 **`GET /v1/health`**，对旧部署保留 `404 -> /v1/server_health` 兼容回退                            |
| `getServerStats`                | 主路径 **`GET /v1/statistics`**，对旧部署保留 `404 -> /v1/server_stats` 兼容回退                         |
| `getRateLimit` / `setRateLimit` / `deleteRateLimit` | 主路径统一为 **`/v1/users/{user_id}/rate_limit`**，兼容旧路径 `/override_ratelimit` 回退 |
| `deleteUserDevice`              | 主路径 **`DELETE /v1/users/{user_id}/devices/{device_id}`**，兼容旧路径 `POST .../devices/{device_id}/delete` 回退 |
| `getUserDevices`                | 主路径 **`GET /v1/users/{user_id}/devices`**，兼容旧路径 `GET /v2/users/{user_id}/devices` 回退 |
| `getUsersPaginated` / `getUser` | 主路径 **`/v2/users...`**，对仅暴露 v1 的部署保留 `404 -> /v1/users...` 兼容回退 |
| `resetPassword(userId, pw)`     | 移除 `logout_devices` 参数（后端忽略）                                                                  |
| `deactivateUser(userId)`        | 移除 `erase` body 参数（后端无 body extractor）                                                         |
| `disconnectFederation`          | `@deprecated`，代理到 `resetFederationConnection`（原路径 `/v1/federation/disconnect` 不存在）          |
| `getFederationAdmissionList` / `getPendingFederationServers` | 统一主路径到 **`GET /v1/federation/pending`**，并保留对旧路径 `/v1/federation/admissions`、`/v1/federation/pending_servers` 的 404 兼容回退 |

### 新增封装

| 领域               | SDK 方法                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retention policy   | `getRetentionPolicy` / `setRetentionPolicy` / `getRoomRetentionPolicy` / `setRoomRetentionPolicy` / `runRetention` / `getRetentionStatus`                             |
| Audit events       | `listAuditEvents` / `getAuditEvent` / `createAuditEvent`                                                                                                              |
| Feature flags      | `listFeatureFlags` / `getFeatureFlag` / `createFeatureFlag` / `updateFeatureFlag`                                                                                     |
| Federation detail  | `resolveFederation` / `rewriteFederation` / `confirmFederation` / `deleteFederationDestination` / `resetFederationDestination` / `getFederationDestinationRooms` / `getFederationCache` / `clearFederationCache` / `deleteFederationCacheEntry` |
| Notifications      | `listNotifications` / `createNotification` / `listActiveNotifications` / `getNotification` / `updateNotification` / `deactivateNotification` / `deleteNotification` / `getUserNotification` / `setUserNotification` |
| Server notices     | `getServerNotices` / `sendServerNotice` / `deleteServerNotice` / `getServerNotice`                                                                                 |
| User pushers       | `getUserPushers` / `deleteUserPusher`                                                                                                                                 |
| Register admin     | `getRegisterNonce` / `registerAdmin`                                                                                                                                   |
| Reports            | `listReports` / `getReport` / `deleteReport` / `listRoomReports` / `getRoomReport`                                                                                   |
| Registration token | `getRegistrationToken` / `updateRegistrationToken`（主路径 `POST /v1/registration_tokens/{token}`，兼容回退 `PUT`）                                                 |
| Spaces             | `listSpaces` / `getSpace` / `deleteSpace` / `getSpaceRooms` / `getSpaceStats` / `getSpaceUsers`                                                                     |
| User media         | `getUserMedia` / `deleteUserMedia`                                                                                                                                     |
| User tokens        | `getUserTokens` / `deleteUserToken` / `getUserRefreshTokens` / `deleteUserRefreshToken`                                                                               |
| User lifecycle     | `deleteUser`（主路径 `DELETE /v1/users/{user_id}`，404 回退 `DELETE /v2/users/{user_id}`） / `batchCreateUsers`（`POST /v1/users/batch`） / `batchDeactivateUsers`（`POST /v1/users/batch_deactivate`） |
| User session/auth  | `getUserSession` / `invalidateUserSession` / `loginAsUser` / `logoutUser` / `evictUser`                                                                               |
| User rooms/stats   | `getUserRooms` / `getUserStats` / `listUserStats`                                                                                                                      |
| Room statistics    | `getRoomStatsByRoom`（`GET /v1/room_stats/{room_id}`）                                                                                                                 |
| Room admin extra   | `getRoomEventContext` / `getRoomForwardExtremities` / `getRoomTokenSync` / `searchRoomEvents` / `getRoomListings` / `setRoomPublicListing` / `deleteRoomPublicListing` / `addRoomMember` / `removeRoomMember` / `banRoomMember` / `kickRoomMember` / `unbanRoomMember` / `banRoom` / `kickRoom` / `makeRoomAdmin` / `deleteRoomAdmin` / `purgeRoomHistory` / `unblockRoom` |
| Room global search | `searchRooms`（`GET /v1/rooms/search`） / `searchRoomsPost`（`POST /v1/rooms/search`）                                                                                |
| Server maintenance | `getInviteAllowlist` / `getInviteBlocklist` / `getJitsiConfig` / `cleanupAll` / `cleanupRooms`（主路径 `POST /v1/rooms/cleanup`，404 回退 `/v1/cleanup/rooms`） / `cleanupTokens` / `purgeRoom` / `purgeHistory` / `shutdownRoom` / `restartServer` / `whoisByDevice` / `getAdminInfo`（`GET /info`） |
| Modules            | `listModules` / `listModulesByType` / `getModule` / `createModule` / `updateModuleConfig` / `setModuleEnabled` / `deleteModule` / `checkModuleSpam` / `getModuleLogs` |
| Event report limit | `checkEventReportRateLimit` / `blockEventReportUser` / `unblockEventReportUser`                                                                                       |
| Telemetry          | `listTelemetryAlerts` / `acknowledgeTelemetryAlert`                                                                                                                   |
| Media quota        | `getMediaQuota`                                                                                                                                                       |
| Account detail     | `updateAccountDetails`（`POST /v1/account/{user_id}`）                                                                                                               |

### 分页规范

`PaginatedResponse<T>` 现在包含 `total` 字段；`getUsersPaginated` / `getRoomsPaginated` 为真实现，`getUsers` / `getRooms` 为 `@deprecated` 委托层。

### 相关文档

Worker admin（独立前缀 `/_synapse/worker/v1`）参见 [`worker-admin.md`](./worker-admin.md)。

## DTO Definitions

> The types below describe the canonical request/response shapes for the admin API surface.
> They are extracted by `scripts/sdk-contract-codegen.mjs` into `src/admin/__generated__/dto.ts`.

### Server info & health

```typescript
export interface AdminServerInfoDto {
    server_name?: string;
    version?: string;
    python_version?: string;
    uptime?: number;
    federation_enabled?: boolean;
    registration_enabled?: boolean;
}

export interface AdminServerStatsDto {
    total_users?: number;
    total_rooms?: number;
    user_count?: number;
    room_count?: number;
    daily_active_users?: number;
    monthly_active_users?: number;
    total_nonlocal_users?: number;
    total_room_events?: number;
    server_start_time?: number;
    r30_users?: number;
    r30v2_users?: number;
}

export interface AdminServerHealthDto {
    healthy: boolean;
    checks?: Record<string, { status: string; message?: string }>;
}
```

### User & account

```typescript
export interface AdminUserAccountDto {
    user_id: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    suspended?: boolean;
    created_ts?: number;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_type?: string;
    is_guest?: boolean;
    erased?: boolean;
}

export interface AdminDeviceDto {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id?: string;
}
```

### Room

```typescript
export interface AdminRoomInfoDto {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator?: string;
    joined_members?: number;
    joined_local_members?: number;
    invited_members?: number;
    version?: string;
    created_ts?: number;
    join_rules?: string;
    public?: boolean;
    guest_access?: string;
    history_visibility?: string;
    state_events?: number;
}

export interface AdminRoomStatsDto {
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

### Registration & tokens

```typescript
export interface AdminRegistrationTokenDto {
    token: string;
    uses_allowed?: number;
    pending?: number;
    completed?: number;
    expiry_time?: number;
}

export interface AdminRegisterResultDto {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    device_id?: string;
    user_id: string;
    home_server?: string;
    nonce?: string;
}
```

### Federation

```typescript
export interface AdminFederationBlacklistEntryDto {
    server_name: string;
    reason?: string;
    added_ts?: number;
}

export interface AdminFederationDestinationDto {
    destination: string;
    retry_last_ts?: number;
    retry_interval?: number;
    failure_ts?: number;
    last_successful_stream_ordering?: number;
    status?: "pending" | "active" | "rejected";
    updated_ts?: number;
}
```
