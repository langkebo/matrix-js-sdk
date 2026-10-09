---
module: admin
generated_from: docs/api-contract/generated/modules/admin.json
generated_hash: sha256-8543d2c406ba7e0946a2e389f3e9384857e7103c770fbe7faee0853585db6e17
ledger_schema: 4
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

| 方法       | 路径                                                          | 说明                                                          |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| GET        | `/_synapse/admin/v1/rooms`                                    | 房间列表                                                      |
| GET/DELETE | `/_synapse/admin/v1/rooms/{room_id}`                          | 房间详情 / 删除房间                                           |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/delete`                   | 兼容删除房间                                                  |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/members`                  | 房间成员                                                      |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/state`                    | 房间状态                                                      |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/messages`                 | 房间消息                                                      |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/aliases`                  | 房间别名                                                      |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/version`                  | 房间版本                                                      |
| POST/GET   | `/_synapse/admin/v1/rooms/{room_id}/block`                    | 封禁 / 查询封禁状态                                           |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/unblock`                  | 解封房间                                                      |
| POST/PUT   | `/_synapse/admin/v1/rooms/{room_id}/make_admin`               | 设置房间管理员                                                |
| POST       | `/_synapse/admin/v1/purge_history`                            | 清理历史；响应含 `purge_id` 和可选 `audit_id`（v10 审计字段） |
| POST       | `/_synapse/admin/v1/purge_room`                               | 清空房间                                                      |
| POST       | `/_synapse/admin/v1/shutdown_room`                            | 关闭房间                                                      |
| GET        | `/_synapse/admin/v1/spaces`                                   | space 列表                                                    |
| GET/DELETE | `/_synapse/admin/v1/spaces/{space_id}`                        | space 详情 / 删除                                             |
| GET        | `/_synapse/admin/v1/spaces/{space_id}/users`                  | space 用户                                                    |
| GET        | `/_synapse/admin/v1/spaces/{space_id}/rooms`                  | space 房间                                                    |
| GET        | `/_synapse/admin/v1/spaces/{space_id}/stats`                  | space 统计                                                    |
| GET        | `/_synapse/admin/v1/room_stats`                               | 房间统计列表                                                  |
| GET        | `/_synapse/admin/v1/room_stats/{room_id}`                     | 单房间统计                                                    |
| PUT/DELETE | `/_synapse/admin/v1/rooms/{room_id}/members/{user_id}`        | 加入 / 移除成员                                               |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/ban/{user_id}`            | 封禁指定用户                                                  |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/ban`                      | 封禁请求体指定用户                                            |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/unban/{user_id}`          | 解封指定用户                                                  |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/kick/{user_id}`           | 踢出指定用户                                                  |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/kick`                     | 踢出请求体指定用户                                            |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/listings`                 | 房间公开列表项                                                |
| PUT/DELETE | `/_synapse/admin/v1/rooms/{room_id}/listings/public`          | 设置/移除公开列表                                             |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/event_context/{event_id}` | 事件上下文                                                    |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/token_sync`               | token 同步                                                    |
| POST       | `/_synapse/admin/v1/rooms/{room_id}/search`                   | 房间内搜索                                                    |
| POST       | `/_synapse/admin/v1/rooms/search`                             | 全局房间搜索                                                  |
| GET        | `/_synapse/admin/v1/rooms/{room_id}/forward_extremities`      | extremities                                                   |

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

| SDK 方法                                                     | 变更                                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setAdmin`                                                   | `PUT /v2/users/{id}` body `{admin}` → **`PUT /v1/users/{id}/admin`** body `{admin}`                                                                                   |
| `addToFederationBlacklist`                                   | `POST /v1/federation/blacklist/add` → **`POST /v1/federation/blacklist/{server_name}`** body `{reason}`                                                               |
| `removeFromFederationBlacklist`                              | `POST /v1/federation/blacklist/remove` → **`DELETE /v1/federation/blacklist/{server_name}`**                                                                          |
| `getRoomStats(roomId)`                                       | `/v1/rooms/{id}/statistics` → **`/v1/room_stats/{id}`**                                                                                                               |
| `getAccountStatus`                                           | `/v1/account_status/{id}` → **`/v1/account/{id}`**                                                                                                                    |
| `getServerInfo`                                              | **`GET /_synapse/admin/info`**（**无 `/v1` 段**，必须走 `v2Request` 前缀 `/_synapse/admin`）。原 `/v1/info` + `404 -> /v1/server_info` 已删除：后端两个路径都从未注册 |
| `getServerHealth`                                            | 主路径 **`GET /v1/health`**；原 `404 -> /v1/server_health` 回退已删除（后端从未注册 `/server_health`）                                                                |
| `getServerStats`                                             | 主路径 **`GET /v1/statistics`**；原 `404 -> /v1/server_stats` 回退已删除（后端从未注册 `/server_stats`）                                                              |
| `getRateLimit` / `setRateLimit` / `deleteRateLimit`          | 主路径统一为 **`/v1/users/{user_id}/rate_limit`**，兼容旧路径 `/override_ratelimit` 回退                                                                              |
| `deleteUserDevice`                                           | 主路径 **`DELETE /v1/users/{user_id}/devices/{device_id}`**，兼容旧路径 `POST .../devices/{device_id}/delete` 回退                                                    |
| `getUserDevices`                                             | 主路径 **`GET /v1/users/{user_id}/devices`**，兼容旧路径 `GET /v2/users/{user_id}/devices` 回退                                                                       |
| `getUsersPaginated` / `getUser`                              | 主路径 **`/v2/users...`**，对仅暴露 v1 的部署保留 `404 -> /v1/users...` 兼容回退                                                                                      |
| `resetPassword(userId, pw)`                                  | 移除 `logout_devices` 参数（后端忽略）                                                                                                                                |
| `deactivateUser(userId)`                                     | 移除 `erase` body 参数（后端无 body extractor）                                                                                                                       |
| `disconnectFederation`                                       | `@deprecated`，代理到 `resetFederationConnection`（原路径 `/v1/federation/disconnect` 不存在）                                                                        |
| `getFederationAdmissionList` / `getPendingFederationServers` | 统一主路径到 **`GET /v1/federation/pending`**，并保留对旧路径 `/v1/federation/admissions`、`/v1/federation/pending_servers` 的 404 兼容回退                           |

### 新增封装

| 领域               | SDK 方法                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retention policy   | `getRetentionPolicy` / `setRetentionPolicy` / `getRoomRetentionPolicy` / `setRoomRetentionPolicy` / `runRetention` / `getRetentionStatus`                                                                                                                                                                                                                                  |
| Audit events       | `listAuditEvents` / `getAuditEvent` / `createAuditEvent`                                                                                                                                                                                                                                                                                                                   |
| Feature flags      | `listFeatureFlags` / `getFeatureFlag` / `createFeatureFlag` / `updateFeatureFlag`                                                                                                                                                                                                                                                                                          |
| Federation detail  | `resolveFederation` / `rewriteFederation` / `confirmFederation` / `deleteFederationDestination` / `resetFederationDestination` / `getFederationDestinationRooms` / `getFederationCache` / `clearFederationCache` / `deleteFederationCacheEntry`                                                                                                                            |
| Notifications      | `listNotifications` / `createNotification` / `listActiveNotifications` / `getNotification` / `updateNotification` / `deactivateNotification` / `deleteNotification` / `getUserNotification` / `setUserNotification`                                                                                                                                                        |
| Server notices     | `getServerNotices` / `sendServerNotice` / `deleteServerNotice` / `getServerNotice`                                                                                                                                                                                                                                                                                         |
| User pushers       | `getUserPushers` / `deleteUserPusher`                                                                                                                                                                                                                                                                                                                                      |
| Register admin     | `getRegisterNonce` / `registerAdmin`                                                                                                                                                                                                                                                                                                                                       |
| Reports            | `listReports` / `getReport` / `deleteReport` / `listRoomReports` / `getRoomReport`                                                                                                                                                                                                                                                                                         |
| Registration token | `getRegistrationToken` / `updateRegistrationToken`（主路径 `POST /v1/registration_tokens/{token}`，兼容回退 `PUT`）                                                                                                                                                                                                                                                        |
| Spaces             | `listSpaces` / `getSpace` / `deleteSpace` / `getSpaceRooms` / `getSpaceStats` / `getSpaceUsers`                                                                                                                                                                                                                                                                            |
| User media         | `getUserMedia` / `deleteUserMedia`                                                                                                                                                                                                                                                                                                                                         |
| User tokens        | `getUserTokens` / `deleteUserToken` / `getUserRefreshTokens` / `deleteUserRefreshToken`                                                                                                                                                                                                                                                                                    |
| User lifecycle     | `deleteUser`（主路径 `DELETE /v1/users/{user_id}`，404 回退 `DELETE /v2/users/{user_id}`） / `batchCreateUsers`（`POST /v1/users/batch`） / `batchDeactivateUsers`（`POST /v1/users/batch_deactivate`）                                                                                                                                                                    |
| User session/auth  | `getUserSession` / `invalidateUserSession` / `loginAsUser` / `logoutUser` / `evictUser`                                                                                                                                                                                                                                                                                    |
| User rooms/stats   | `getUserRooms` / `getUserStats` / `listUserStats`                                                                                                                                                                                                                                                                                                                          |
| Room statistics    | `getRoomStatsByRoom`（`GET /v1/room_stats/{room_id}`）                                                                                                                                                                                                                                                                                                                     |
| Room admin extra   | `getRoomEventContext` / `getRoomForwardExtremities` / `getRoomTokenSync` / `searchRoomEvents` / `getRoomListings` / `setRoomPublicListing` / `deleteRoomPublicListing` / `addRoomMember` / `removeRoomMember` / `banRoomMember` / `kickRoomMember` / `unbanRoomMember` / `banRoom` / `kickRoom` / `makeRoomAdmin` / `deleteRoomAdmin` / `purgeRoomHistory` / `unblockRoom` |
| Room global search | `searchRooms`（`GET /v1/rooms/search`） / `searchRoomsPost`（`POST /v1/rooms/search`）                                                                                                                                                                                                                                                                                     |
| Server maintenance | `getInviteAllowlist` / `getInviteBlocklist` / `getJitsiConfig` / `cleanupAll` / `cleanupRooms`（主路径 `POST /v1/rooms/cleanup`，404 回退 `/v1/cleanup/rooms`） / `cleanupTokens` / `purgeRoom` / `purgeHistory` / `shutdownRoom` / `restartServer` / `whoisByDevice` / `getAdminInfo`（`GET /info`）                                                                      |
| Modules            | `listModules` / `listModulesByType` / `getModule` / `createModule` / `updateModuleConfig` / `setModuleEnabled` / `deleteModule` / `checkModuleSpam` / `getModuleLogs`                                                                                                                                                                                                      |
| Event report limit | `checkEventReportRateLimit` / `blockEventReportUser` / `unblockEventReportUser`                                                                                                                                                                                                                                                                                            |
| Telemetry          | `listTelemetryAlerts` / `acknowledgeTelemetryAlert`                                                                                                                                                                                                                                                                                                                        |
| Media quota        | `getMediaQuota`                                                                                                                                                                                                                                                                                                                                                            |
| Account detail     | `updateAccountDetails`（`POST /v1/account/{user_id}`）                                                                                                                                                                                                                                                                                                                     |

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
    server_version?: string;
    implementation?: string;
}

export interface AdminServerStatsDto {
    total_users?: number;
    non_deactivated_user_count?: number;
    non_deactivated_user_count_by_app_service?: Record<string, number>;
    total_rooms?: number;
    daily_active_users?: number;
    monthly_active_users?: number;
    r30_users?: number;
    r30v2_users?: number;
    total_messages?: number;
    daily_messages?: number;
    active_rooms_7d?: number;
    total_members?: number;
    encrypted_rooms?: number;
    average_messages_per_room?: number;
}

export interface AdminServerHealthDto {
    status: "ok" | "error";
    database: "ok" | "error";
}

export interface AdminServerStatusDto {
    db_ok: boolean;
    server_ok: boolean;
    up: boolean;
}
```

#### 响应体来源（2026-10-07 逐条核对）

上面这几个 DTO 此前是**照上游 Synapse（Python）的响应形状推测**的，从未与 synapse-rust 的实际返回核过；
`quality:path-contract` 只核对**请求路径**，不核对响应字段，所以这类错误没有任何门禁兜着
（本轮是靠 `spec/integ/real-backend/` 的用例断言 `server_ok` 才发现的）。现已逐个对照后端处理器改正：

| 端点                                                      | 后端处理器                                               | 实际返回                                                               |
| --------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /_synapse/admin/info`（及 `/v1/server`，同一处理器） | `synapse-web/src/routes/admin/server.rs::get_admin_info` | `{server_name, server_version, implementation}`                        |
| `GET /_synapse/admin/v1/status`                           | `…/admin/server.rs::get_status`                          | `{db_ok, server_ok, up}`                                               |
| `GET /_synapse/admin/v1/health`                           | `…/admin/server.rs::get_health`                          | `{status: "ok"\|"error", database: "ok"\|"error"}`                     |
| `GET /_synapse/admin/v1/statistics`                       | `…/admin/server.rs::get_statistics`                      | 见 `AdminServerStatsDto`（14 个字段）                                  |
| `GET /_synapse/admin/v1/server_version`                   | `…/admin/server.rs::get_server_version`                  | `{server_version, python_version: "Rust", server_name}`                |
| `GET /_synapse/admin/v1/config`                           | `…/admin/server.rs::get_config`                          | `{server_name, public_baseurl, registration_enabled, max_upload_size}` |
| `GET /_synapse/admin/v1/experimental_features`            | `…/admin/server.rs::get_experimental_features`           | `{features: Record<flagKey, boolean>, total}`                          |

> 注：`/server_version` 的 `python_version` 在 Rust 实现里**是存在的**（固定返回字符串 `"Rust"`，为兼容 Synapse 客户端）。
> `spec/sdk-comprehensive-audit/sdk-accuracy-audit-report.json` 里那条「返回字段包含 python_version，但后端是 Rust 实现 ⚠️ 待验证」
> 由此**证伪**，可结案。

### User & account

```typescript
export interface AdminUserAccountDto {
    user_id?: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    creation_ts?: number;
    created_ts?: number;
    user_type?: string;
    is_guest?: boolean;
}

export interface AdminDeviceDto {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
}
```

**响应体来源（2026-10-07 逐条核对，后端源码为准）**

| 端点                                             | 后端处理器                      | 实际返回                                                                                                                                          |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /_synapse/admin/v2/users`                   | `…/admin/user.rs::get_users_v2` | `{users: [{name, user_id, creation_ts, admin, is_guest, user_type, deactivated, displayname, avatar_url}], total, next_batch?}`                   |
| `GET /_synapse/admin/v2/users/{user_id}`         | `…::get_user_v2`                | 同上但键是 **`created_ts`**（列表用 `creation_ts`、单项用 `created_ts`，是后端自身的不一致），另含 `devices[]` / `threepids[]` / `external_ids[]` |
| `GET /_synapse/admin/v1/users`（v2 的 404 回退） | `…::get_users`                  | 条目键 **没有 `user_id`**（标识键是 `name`）                                                                                                      |
| `GET /_synapse/admin/v1/users/{user_id}/devices` | `…::get_user_devices_admin`     | `{devices: [{device_id, display_name, last_seen_ts, last_seen_ip}], total}`                                                                       |
| `GET /_synapse/admin/v1/account/{user_id}`       | `…::get_account_details`        | `{name, user_id, displayname, admin, deactivated, creation_ts, device_count, room_count}`                                                         |

> 因此 `AdminUserAccountDto.user_id` 是**可选**的：只有 `/v2` 路径返回它，`/v1/users` 回退路径不返回
> （该路径下要用 `name`）。同理 `creation_ts` 与 `created_ts` 两者都可能出现，取决于端点。
> 原先声明的 `suspended` / `erased` / `last_seen_ts` / `last_seen_ip`（账号对象上）后端都不返回，已删除。

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
    created_ts?: number;
}

export interface AdminRegisterResultDto {
    // 后端 register.rs::RegisterResponse 只有这 6 个字段；
    // `nonce` 是请求侧参数（GET /register/nonce 取得后放进请求体），响应里不存在。
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    device_id?: string;
    user_id: string;
    home_server?: string;
}
```

### Federation

```typescript
export interface AdminFederationBlacklistEntryDto {
    server_name: string;
    /** 后端键名是 added_at（来自 row.created_ts.unwrap_or(0)），不是 added_ts */
    added_at: number;
    reason: string | null;
}

export interface AdminFederationDestinationDto {
    destination: string;
    retry_last_ts: number | null;
    /** 后端写死 None，恒为 null */
    retry_interval: number | null;
    failure_ts: number | null;
    /** 后端真实字段（上游 Synapse 的 last_successful_stream_ordering 本后端不返回） */
    last_successful_ts: number | null;
    failure_count: number;
    status: string;
    updated_ts: number | null;
}
```

### Media

⚠️ **本节的响应类型没有 DTO 代码块，因而没有 codegen 覆盖**：`MediaInfo` /
`MediaQuarantineChange` 等是手写在 `src/admin/sub-managers/admin-*-types.ts` 里的，
`quality:path-contract` 只核对请求路径、不核对响应字段。故在此以表格形式固化真实响应
（2026-10-07 逐条对照 `synapse-web/src/routes/admin/media.rs`），作为人工核对依据；
**未新增 DTO 块是有意为之** —— 手写类型才是实际被使用的那份，再造一份生成物等于多一份副本。

**响应体来源（2026-10-07 逐条核对，后端源码为准）**

| 端点                                                   | 后端处理器                                      | 实际返回                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/media`                                        | `media.rs::get_all_media`                       | `{media: [...8 键], total, next_batch}`；**游标键是 `next_batch`**（可空），`total` 是**本页条数**（处理器写的是 `media_list.len()`），非全局总数 |
| `GET /v1/media/{media_id}`                             | `media.rs::get_media_info`                      | 单个媒体条目（8 键）                                                                                                                              |
| `GET /v1/media/quota`                                  | `media.rs::get_media_quota`                     | `{total_size, total_count, default_size_limit, default_count_limit}`                                                                              |
| `GET /v1/users/{user_id}/media`                        | `media.rs::get_user_media`                      | `{media: [...5 键], total}`；**既不读 `limit` / `from`，也不返回游标**                                                                            |
| `DELETE /v1/users/{user_id}/media`                     | `media.rs::delete_user_media`                   | `{deleted}`                                                                                                                                       |
| `GET /v1/rooms/{room_id}/media`                        | `media.rs::get_room_media`                      | `{media: [...5 键], total, next_batch}`（SDK 尚未封装）                                                                                           |
| `POST /v1/purge_media_cache`                           | `media.rs::purge_media_cache`                   | `{deleted}`；⚠️ **`before_ts` 是 query 参数**（后端用 `axum::extract::Query` 读，缺省 `0`），放进请求体会被静默忽略                               |
| `GET /v1/quarantine_media/{media_id}/changes`          | `media.rs::get_media_quarantine_changes`        | `{changes: [...6 键], total}`；顶层**无** `media_id`（由路径决定）、**无**游标（翻页用末条 `stream_id` 作 `since`）                               |
| `GET /v1/media/quarantine_changes`                     | `media.rs::get_global_media_quarantine_changes` | `{next_batch, changes: [{origin, media_id, quarantined}]}`（SDK 尚未封装）                                                                        |
| `POST /v1/media/quarantine/{server_name}/{media_id}`   | `media.rs::quarantine_media`                    | `{changed_by, media_id, quarantined, server_name, stream_id}`                                                                                     |
| `POST /v1/media/unquarantine/{server_name}/{media_id}` | `media.rs::unquarantine_media`                  | `{changed_by, media_id, quarantined, server_name, stream_id}`                                                                                     |
| `POST /v1/media/protect/{server_name}/{media_id}`      | `media.rs::protect_media`                       | `{changed_by, media_id, protected, server_name, stream_id}`                                                                                       |
| `DELETE /v1/media/{media_id}`                          | `media.rs::delete_media`                        | `{}`                                                                                                                                              |

**媒体条目字段（`MediaInfo`）**

| 键               | 出现于                                            |
| ---------------- | ------------------------------------------------- |
| `media_id`       | 所有列表 / 详情                                   |
| `media_type`     | 所有                                              |
| `upload_name`    | 所有                                              |
| `created_ts`     | 所有                                              |
| `last_access_ts` | 仅 `get_all_media` / `get_media_info`             |
| `media_length`   | 所有（字节数）                                    |
| `user_id`        | 仅 `get_all_media` / `get_media_info`（上传者）   |
| `quarantined`    | 仅 `get_all_media` / `get_media_info`（**布尔**） |

> 此前 SDK 声明的 `quarantined_by`（string）后端**从不返回** —— 用它判断隔离状态恒为 `undefined`；
> 真实键是布尔 `quarantined`。`getMedia()` / `getUserMedia()` 原先返回的 `next_token` 同样是
> **不存在的键**（后端用 `next_batch`，用户媒体端点连游标都没有），会造成「翻页永远拿到
> `undefined`、循环在第一页就退出」的静默行为。
>
> **隔离变更条目字段（`MediaQuarantineChange`）**：`stream_id` `media_id` `server_name`
> `change_type`（`"quarantine"` \| `"unquarantine"`）`changed_by` `created_ts`。
> 原先声明的 `action` / `changed_ts` / `reason` 后端都不返回。

### Room / Space / Report

同样**没有 DTO 代码块**（原因见上节）。下表对照 `synapse-web/src/routes/admin/room/{mod,management,spaces}.rs`
与 `report.rs`（2026-10-07 核对）。

**房间与成员**

| 端点                                                  | 后端处理器                                  | 实际返回                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/rooms`                                       | `room/mod.rs::get_rooms`                    | `{rooms: [{room_id, name, topic, creator, joined_members, joined_local_members, is_public}], total, next_batch}`                         |
| `GET /v1/rooms/{room_id}`                             | `room/mod.rs::get_room`                     | `{room_id, name, topic, creator, member_count, room_version, encryption, is_public, join_rule, tombstoned, replacement_room}`            |
| `GET /v1/rooms/{room_id}/members`                     | `room/mod.rs::get_room_members_admin`       | `{members: [{user_id, displayname, avatar_url, membership}], total, next_batch}`                                                         |
| `GET /v1/rooms/{room_id}/state`                       | `room/mod.rs::get_room_state_admin`         | `{state: [{type, state_key, content, sender, event_id}]}`；⚠️ 5 个键各自 `unwrap_or(Value::Null)` ⇒ 都可能为 `null`                      |
| `GET /v1/rooms/{room_id}/messages`                    | `room/mod.rs::get_room_messages_admin`      | `{chunk: [{event_id, type, content, sender, origin_server_ts}], start, end, next_batch}`                                                 |
| `GET /v1/rooms/{room_id}/aliases`                     | `room/mod.rs::get_room_aliases_admin`       | `{aliases: []}` —— **恒为空数组**（处理器硬编码，功能未实现）                                                                            |
| `GET /v1/rooms/{room_id}/version`                     | `room/mod.rs::get_room_version`             | `{room_id, room_version}`                                                                                                                |
| `GET /v1/rooms/{room_id}/block`                       | `room/management.rs::get_room_block_status` | 已封锁 `{block: true, blocked_at}`；未封锁 `{block: false}`                                                                              |
| `GET /v1/rooms/{room_id}/forward_extremities`         | `room/mod.rs::get_room_forward_extremities` | `{room_id, forward_extremities: <整数计数>}` —— **不是对象数组**                                                                         |
| `GET /v1/rooms/{room_id}/token_sync`                  | `room/mod.rs::get_room_token_sync_admin`    | `{room_id, results: [<18 键>], total, next_batch, summary: {active_token_count, expired_token_count, distinct_users, distinct_devices}}` |
| `GET /v1/rooms/{room_id}/event_context/{event_id}`    | `room/mod.rs::get_event_context_admin`      | `{event, events_before, events_after, state}`（`state` 恒为 `[]`）                                                                       |
| `GET /v1/rooms/{room_id}/listings`                    | `room/spaces.rs::get_room_listings`         | `{room_id, public, in_directory}` —— **单个房间的目录状态**，不是房间列表                                                                |
| `POST /v1/rooms/{room_id}/purge_history`              | `room/management.rs::purge_history_by_room` | `{success, deleted_events, dry_run}`（`purge_id` 属于另一个端点 `POST /v1/purge_room`）                                                  |
| `POST /v1/rooms/search`（亦支持 `GET`）               | `room/mod.rs::search_all_rooms{,_query}`    | `{results: [{room_id, name, topic, creator, is_public, member_count, is_encrypted, creation_ts}], count, total, limit, next_batch}`      |
| `POST /v1/rooms/{room_id}/search`                     | `room/mod.rs::search_room_messages_admin`   | `{results: [<事件 + room_id>], count, room_id}`                                                                                          |
| `POST /_matrix/client/v3/admin/room/{room_id}/redact` | `room/management.rs::redact_room_events`    | `{redacted}`                                                                                                                             |
| `DELETE /v1/rooms/{room_id}`                          | `room/mod.rs::delete_room`                  | `{room_id, deleted: true}`                                                                                                               |

**统计**

| 端点                           | 后端处理器                              | 实际返回                                                                                                                                                       |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/room_stats`           | `room/spaces.rs::get_room_stats`        | **单个概览对象** `{total_rooms, encrypted_rooms, public_rooms, total_messages, total_members, active_rooms, average_messages_per_room}`；不读 `from` / `limit` |
| `GET /v1/room_stats/{room_id}` | `room/spaces.rs::get_single_room_stats` | `{room_id, member_count, message_count, last_message_ts, is_encrypted, admin_count}`（`last_message_ts` 可为 `null`）                                          |

**Space**

| 端点                              | 后端处理器                        | 实际返回                                                                   |
| --------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `GET /v1/spaces`                  | `room/spaces.rs::get_spaces`      | `{spaces: [{space_id, room_id, name, topic, creator, created_ts}], total}` |
| `GET /v1/spaces/{space_id}`       | `room/spaces.rs::get_space`       | 同上单项                                                                   |
| `GET /v1/spaces/{space_id}/stats` | `room/spaces.rs::get_space_stats` | `{space_id, member_count, child_room_count}`                               |
| `GET /v1/spaces/{space_id}/users` | `room/spaces.rs::get_space_users` | `{users: [<user id 字符串>], total}` —— ⚠️ 元素是**字符串**，不是对象      |
| `GET /v1/spaces/{space_id}/rooms` | `room/spaces.rs::get_space_rooms` | `{rooms: [<room id 字符串>], total}` —— ⚠️ 同上                            |
| `DELETE /v1/spaces/{space_id}`    | `room/spaces.rs::delete_space`    | `{deleted: true}`                                                          |

**举报**

| 端点                              | 后端处理器                    | 实际返回                                                                                                                                                                                                      |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/reports`                 | `report.rs::get_all_reports`  | `{reports, total}`；条目 `{id(整数), room_id, event_id, user_id, reported_user_id, reason, content, status, score, received_ts}`；⚠️ **无 `next_token`**，游标是请求侧 `since_ts` / `since_id`（`from` 不读） |
| `GET /v1/rooms/{room_id}/reports` | `report.rs::get_room_reports` | 同上                                                                                                                                                                                                          |

> **两处「路径存在但语义/参数不符」且已登记豁免，勿当新缺陷**：
> `DELETE /v1/rooms/{room_id}/messages/{event_id}` 与 `POST /v1/rooms/{room_id}/join`
> 在后端**没有注册** —— 见 `scripts/quality/path-contract-waivers.json` 第 16、17 条。
> 前者对应能力是 `POST /admin/room/{room_id}/redact`（按时间范围批量撤回），
> 后者对应的真实端点是 `PUT /v1/rooms/{room_id}/members/{user_id}`。

### Federation

对照 `synapse-web/src/routes/admin/federation.rs`（2026-10-07）。

| 端点                                                  | 后端处理器                               | 实际返回                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/federation/destinations`                     | `federation.rs::get_destinations`        | `{destinations, total, total_count, next_batch}`；条目是 `DestinationInfo`（见下）                                           |
| `GET /v1/federation/destinations/{destination}`       | `federation.rs::get_destination`         | 同上的**单个** `DestinationInfo` 对象                                                                                        |
| `GET /v1/federation/destinations/{destination}/rooms` | `federation.rs::get_destination_rooms`   | `{rooms: [<room id 字符串>], total}` —— ⚠️ 元素是**字符串**，不是对象                                                        |
| `GET /v1/federation/pending`                          | `federation.rs::list_pending_federation` | `{servers, total, limit, next_batch}`                                                                                        |
| `GET /v1/federation/blacklist`                        | `federation.rs::get_blacklist`           | `{blacklist: [{server_name, added_at, reason}], total, next_batch}`                                                          |
| `GET /v1/federation/cache`                            | `federation.rs::get_federation_cache`    | `{cache: [{key, value, expiry_ts}], total}`                                                                                  |
| `POST /v1/federation/cache/clear`                     | `federation.rs::clear_federation_cache`  | `{deleted}`                                                                                                                  |
| `POST /v1/federation/confirm`                         | `federation.rs::confirm_federation`      | `{server_name, status, previous_status, updated_ts, confirmed_by}`；请求体 `{server_name, accept}`                           |
| `POST /v1/federation/resolve` / `rewrite`             | 同名处理器                               | `{server_name, resolved, blacklisted, in_destinations, resolved_by}` / `{from, to, rewritten, rooms_affected, rewritten_by}` |

**`DestinationInfo` 字段（列表与详情同形状）**：

`destination` `retry_last_ts` `retry_interval`（后端写死 `None`，恒 `null`）`failure_ts`
`last_successful_ts` `failure_count` `status` `updated_ts`

> ⚠️ 上游 Synapse 的 `last_successful_stream_ordering` **本后端不返回**；真实字段是
> `last_successful_ts` + `failure_count`。
> ⚠️ 三个**请求体**带 `#[serde(deny_unknown_fields)]`，字段名必须完全一致，否则 400：
> `ConfirmRequest {server_name, accept}`、`ResolveRequest {server_name}`、`RewriteRequest {from, to}`；
> `DestinationsQuery` / `ListPendingQuery` / `BlacklistQuery` 也只认 `limit` / `from`（`DestinationsQuery`
> 另外接受 `offset` 但**非 0 即 400**，旧 offset 分页已被显式拒绝）。

### Notification（server-notifications feature）

对照 `synapse-web/src/routes/admin/notification.rs` 与
`synapse-storage/src/server_notification/models.rs`（2026-10-07）。这些路由**仅在
`server-notifications` feature 打开时注册**（`../synapse-rust` 的 `all` profile 有、`default` profile 没有）。

| 端点                                    | 后端处理器                 | 实际返回                                                                                                      |
| --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /v1/notifications`                 | `list_notifications`       | `{notifications: [<ServerNotification>], next_batch}`；**无 `total`**                                         |
| `GET /v1/notifications/{id}`            | `get_notification`         | **裸 `ServerNotification` 对象**（不是 `{notification: …}` 包装）                                             |
| `POST /v1/notifications`                | `create_notification`      | 裸通知对象；请求体 `{title, content, …}`（`title`/`content` 必填）                                            |
| `PUT /v1/notifications/{id}`            | `update_notification`      | 裸通知对象；请求体同创建但全可选                                                                              |
| `PUT /v1/notifications/{id}/deactivate` | `deactivate_notification`  | `{is_enabled: false}`                                                                                         |
| `POST /v1/send_server_notice`           | `send_server_notice`       | `{event_id, room_id, notice_id}`；请求体 `{user_id, content: {msgtype, body}}`                                |
| `GET /v1/server_notices`                | `get_server_notices`       | `{notices: [{id, user_id, event_id, content, sent_ts}], total, next_batch}`                                   |
| `GET /v1/users/{user_id}/notification`  | `get_user_notification`    | `{enabled}`                                                                                                   |
| `PUT /v1/users/{user_id}/notification`  | `update_user_notification` | `{is_enabled}`；请求体 `{is_enabled}`                                                                         |
| `GET /v1/users/{user_id}/pushers`       | `get_user_pushers`         | `{pushers: [{pushkey, kind, app_id, app_display_name, device_display_name, profile_tag, lang, data}], total}` |

**`ServerNotification` 字段（16 个）**：

`id` `title` `content` `notification_type` `priority` `target_audience` `target_user_ids`
`starts_at` `expires_at` `is_enabled` `is_dismissable` `action_url` `action_text` `created_by`
`created_ts` `updated_ts`

> ⚠️ **GET 与 PUT 的键名不一致**：`GET /users/{id}/notification` 返回 `{enabled}`，
> 而 `PUT` 收/发 `{is_enabled}`（`UserNotificationRequest` 同样带 `deny_unknown_fields`）。
> SDK 的 `setUserNotification(userId, { enabled })` 保留这一更自然的入参并在内部映射为 `is_enabled`。
>
> ⚠️ `DELETE /v1/notifications/deactivate` **在后端没有注册**（真实端点是上文带 `{id}` 的 PUT），
> 该差异已登记在 `path-contract-waivers.json` 第 14 条，故 SDK 未改行为、仅补注释。

### Registration tokens & user tokens

对照 `synapse-web/src/routes/admin/token.rs`（2026-10-07）。

| 端点                                             | 后端处理器                  | 实际返回                                                              |
| ------------------------------------------------ | --------------------------- | --------------------------------------------------------------------- |
| `GET /v1/registration_tokens`                    | `get_registration_tokens`   | `{registration_tokens: [<Token>], next_batch}`                        |
| `POST /v1/registration_tokens`                   | `create_registration_token` | 裸 `<Token>`；请求体 `{token?, uses_allowed?, expiry_time?, length?}` |
| `GET /v1/registration_tokens/{token}`            | `get_registration_token`    | 裸 `<Token>`（不存在则 404）                                          |
| `POST /v1/registration_tokens/{token}`           | `update_registration_token` | 裸 `<Token>`；请求体 `{uses_allowed?, expiry_time?}`                  |
| `DELETE /v1/registration_tokens/{token}`         | `delete_registration_token` | `{}`                                                                  |
| `GET /v1/users/{user_id}/tokens`                 | `get_user_tokens`           | `{tokens: [<TokenRow>], total}`                                       |
| `DELETE /v1/users/{user_id}/tokens/{token_id}`   | `delete_user_token`         | `{}`                                                                  |
| `GET /v1/users/{user_id}/refresh_tokens`         | `get_user_refresh_tokens`   | `{refresh_tokens: [<TokenRow>], total}`                               |
| `DELETE /v1/users/{user_id}/refresh_tokens/{id}` | `delete_refresh_token`      | `{}`                                                                  |

**`<Token>`（注册令牌，6 键）**：`token` `uses_allowed` `pending` `completed` **`expiry_time`** `created_ts`

**`<TokenRow>`（用户 token / refresh token，5 键）**：`id` `device_id` `created_ts` `expires_at` `is_revoked`

> ⚠️ 过期键是 **`expiry_time`**，不是 `expiry_ts`。`CreateTokenRequest` / `UpdateTokenRequest` /
> `RegistrationTokenListQuery` 三者都带 `#[serde(deny_unknown_fields)]` —— 发 `expiry_ts` 会被**直接 400**。
> `uses_allowed` 由后端把 `max_uses == 0` 归一为 `null`。

### Retention

对照 `synapse-web/src/routes/admin/retention.rs`（2026-10-07）。

| 端点                                  | 后端处理器                  | 实际返回                                                                                                                      |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/retention/policy`            | `get_retention_policy`      | `{max_lifetime, min_lifetime, is_expire_on_clients}`（无策略时三字段为 `null/null/false`）                                    |
| `POST /v1/retention/policy`           | `set_retention_policy`      | 同上；请求体 `{max_lifetime?, min_lifetime?, is_expire_on_clients?}`                                                          |
| `GET /v1/retention/policy/{room_id}`  | `get_room_retention_policy` | 多一个 `room_id`（房间不存在则 404）                                                                                          |
| `POST /v1/retention/policy/{room_id}` | `set_room_retention_policy` | 同上                                                                                                                          |
| `POST /v1/retention/run`              | `run_retention`             | 带 `room_id`：`{started, room_id, events_deleted, status, completed_ts}`；否则 `{started, scope:"all_rooms", events_deleted}` |
| `GET /v1/retention/status`            | `get_retention_status`      | `{server_policy_enabled, rooms_with_custom_policy, lifecycle_cleanup_enabled, audit_retention_days, last_run}`                |

`last_run`（可空）的 8 个键：`started_ts` `completed_ts` `duration_ms` `expired_events_deleted`
`expired_beacons_deleted` `expired_uploads_deleted` `expired_audit_events_deleted` `failed_tasks`

> ⚠️ 字段名是 **`is_expire_on_clients`**（不是 `expire_on_clients`）；`RetentionPolicyRequest` 带
> `deny_unknown_fields`，发错名字直接 400。
> ⚠️ `RunRetentionRequest` **只有 `room_id`** ⇒ 传 `{scope}` 会 400；响应里的 `scope` 值恒为 `"all_rooms"`。
> ⚠️ 原先声明的 `cleanup_batch_size` / `queue_retention_days` / `cleanup_queue_items_processed` /
> `cleanup_queue_rows_pruned` 后端**都不返回**。

### Security（限速与影子封禁）

对照 `synapse-web/src/routes/admin/security.rs`（2026-10-07）。`RateLimitRequest` 带
`deny_unknown_fields`，字段 `{messages_per_second, burst_count}`（省略时后端用 `5.0` / `10`）。

| 端点                                       | 后端处理器                        | 实际返回                             |
| ------------------------------------------ | --------------------------------- | ------------------------------------ |
| `GET /v1/users/{id}/rate_limit`            | `get_user_rate_limit`             | `{messages_per_second, burst_count}` |
| `PUT /v1/users/{id}/rate_limit`            | `set_user_rate_limit`             | 同上                                 |
| `DELETE /v1/users/{id}/rate_limit`         | `delete_user_rate_limit`          | `{}`                                 |
| `GET /v1/users/{id}/override_ratelimit`    | `get_user_override_rate_limit`    | 同 `rate_limit`（后端直接转发）      |
| `POST /v1/users/{id}/override_ratelimit`   | `set_user_override_rate_limit`    | 同上                                 |
| `DELETE /v1/users/{id}/override_ratelimit` | `delete_user_override_rate_limit` | `{}`                                 |
| `POST /v1/users/{id}/shadow_ban`           | `shadow_ban_user`                 | `{}`                                 |
| `DELETE /v1/users/{id}/shadow_ban`         | `unshadow_ban_user`               | `{}`                                 |

> ⚠️ 三个 override 处理器与对应的 `rate_limit` 处理器是**同一实现**（后端直接转发），
> 即"覆盖限速"与"限速"在本后端是**同一份数据**。
> ⚠️ `POST .../override_ratelimit` 走 `Json<RateLimitRequest>` ⇒ **不带 body 会被 415 拒绝**
> （SDK 只在 body 是对象时才设 `Content-Type: application/json`）。
> ⚠️ **`GET /v1/users/{id}/shadow_ban` 未注册**（只有 POST/DELETE），已登记在
> `path-contract-waivers.json` 第 19 条。

### User：sessions / rooms / batch（`user.rs` 余下部分）

对照 `synapse-web/src/routes/admin/user.rs`（2026-10-07）。

| 端点                                          | 后端处理器                 | 实际返回                                                                                                        |
| --------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /v1/users/{user_id}/rooms`               | `get_user_rooms_admin`     | `{joined_rooms: string[], total, next_batch}`                                                                   |
| `GET /v1/user_sessions/{user_id}`             | `get_user_sessions`        | `{user_id, sessions: [{session_id, device_id, display_name, last_seen_ts, last_seen_ip}], total}`               |
| `POST /v1/user_sessions/{user_id}/invalidate` | `invalidate_user_sessions` | `{invalidated, sessions_removed}`                                                                               |
| `GET /v1/user_stats`                          | `get_user_stats`           | 7 个汇总键（**不接收任何 query 参数**）                                                                         |
| `GET /v1/users/{user_id}/stats`               | `get_single_user_stats`    | `{user_id, rooms_joined, messages_sent, last_seen_ts, creation_ts, is_admin, dashboard}`                        |
| `POST /v1/users/batch`                        | `batch_create_users`       | `{created: string[], failed: string[], total}`；请求体 `{users: [{username, password?, displayname?, admin?}]}` |
| `POST /v1/users/batch_deactivate`             | `batch_deactivate_users`   | `{deactivated: string[], failed: string[], total}`；请求体 `{users: string[], erase?}`                          |
| `POST /v1/users/{user_id}/logout`             | `logout_user_devices`      | `{devices_deleted}`                                                                                             |
| `POST /v1/users/{user_id}/evict`              | `evict_user`               | `{user_id, rooms_evicted, rooms: string[], failures: [{room_id, error}]}`                                       |
| `POST /v1/users/{user_id}/login`              | `login_as_user`            | `{access_token, device_id, user_id}`                                                                            |
| `PUT /v1/users/{user_id}/admin`               | `set_admin`                | `{success: true}`                                                                                               |
| `POST /v1/users/{user_id}/deactivate`         | `deactivate_user`          | `{id_server_unbind_result}`                                                                                     |
| `POST /v1/account/{user_id}`                  | `update_account`           | `{user_id, updated}`                                                                                            |

> ⚠️ 批量两个请求体都由 `deny_unknown_fields` 结构体解析：批量创建的条目字段是 **`username`**
> （不是 `user_id`）、批量停用是 **`users`**（不是 `user_ids`）—— 发旧名字会直接 422。
> ⚠️ 批量响应里的失败项键是 **`failed`**（字符串数组），不是 `errors: [{user_id, error}]`。
> ⚠️ 会话端点是**包装对象** `{user_id, sessions, total}`，不是裸 session；会话条目也没有 `user_agent`。
> ⚠️ `GET /v1/users/{user_id}/admin` 未注册（只有 PUT），已登记在 waivers 第 18 条。
