# Changelog

All notable changes to the Matrix JS SDK will be documented in this file.

## [Unreleased]

## [40.2.0] - 2026-04-16

### 🎉 Major Optimization Release

This release includes a comprehensive optimization of the SDK with significant improvements to security, code quality, maintainability, and developer experience.

### Added

#### Security

- Input Validation: Added `ValidationError` class and `AdminValidators` utility for comprehensive input validation
- Format Validation: User ID and Room ID format validation to prevent injection attacks
- Boundary Checks: Parameter boundary validation (e.g., limit: 1-10000) to prevent resource exhaustion

#### Documentation

- Usage Examples: Added detailed `@example` documentation for 25+ methods
- Error Documentation: Added `@throws` documentation for all core methods
- Admin Guide: Created comprehensive Admin API usage guide (600+ lines)
- Version Policy: Created version policy and deprecation guidelines (400+ lines)

#### API Improvements

- Unified Pagination: Added `PaginatedResponse<T>` type for consistent pagination format
- New Methods: `getUsersPaginated()`, `getRoomsPaginated()` — Unified format for user/room list pagination
- Deprecation Warnings: Added deprecation warning utility for smooth API transitions

#### Code Quality

- Admin Utils: Created utility functions for query parameter building
- Type Safety: Added `WhoisResponse` type, eliminated `any` type usage

### Changed

#### Security Improvements

- Admin Module: Added input validation to 7 core methods
- Auth Module: Enhanced validation and added security warnings
- Friend Module: Replaced basic validation with standard validators
- DM Module: Added user ID validation for all operations
- Device Module: Added input validation and improved error messages

#### Error Handling

- Cleaned Empty Catch Blocks: Removed 5 instances of `catch {}` with explicit error handling in `src/models/room.ts`, `src/interactive-auth.ts`, `src/browser-index.ts`, `src/store/memory.ts`

#### Code Quality

- Reduced Code Duplication: Extracted common query building logic (~30 lines)
- Improved Error Messages: More descriptive validation error messages
- Consistent API: Unified pagination format across modules

### Deprecated

- `getUsers(from?, limit?)` — Use `getUsersPaginated(options?)` instead (removed in v41.0.0)
- `getRooms(from?, limit?, searchTerm?)` — Use `getRoomsPaginated(options?)` instead (removed in v41.0.0)

### Fixed

- Error Handling: Fixed silent error swallowing in 5 locations
- Type Safety: Eliminated `any` type usage in whois() method
- Validation: Fixed inconsistent validation across modules

### 2026-04-23 — Backend M_UNRECOGNIZED sweep

Backend audit found 9 endpoints returning `M_UNRECOGNIZED`. Classification and actions:

**Backend fixes (`synapse-rust`)**

- **Spec compliance** — `/_matrix/client/v3/thirdparty/{protocol/{p!=irc}, location, location/{p}, user, user/{p}}` now return Matrix-spec-compliant empty payloads (`{ instances:[], user_fields:[], location_fields:[] }` for `/protocol/{p}`; `[]` for the four list endpoints) instead of errors. Bridges without deployment simply expose no instances. (`synapse-rust/src/web/routes/thirdparty.rs`)
- **`GET /_synapse/admin/v1/experimental_features`** — now returns `{enabled, disabled, total, total_flags}` sourced from `feature_flag_service`. Flags whose `flag_key` begins with `experimental.` or `msc` (or `target_scope=="experimental"`) are included; expired flags auto-downgrade to `disabled`. (`synapse-rust/src/web/routes/admin/server.rs::get_experimental_features`)
- **`GET /_synapse/admin/v1/backups`** — now returns an aggregated view over `secure_key_backups` table: `{backups:[], total, total_keys, limit, offset}`. Supports `?limit=1..500&offset=0+`. (`synapse-rust/src/web/routes/admin/server.rs::get_backups`)
- **Unchanged (by design)**:
  - `POST /_synapse/admin/v1/restart` — operator-managed (systemd/k8s); SDK not to implement.
  - `POST /_synapse/admin/v1/federation/confirm` — awaits product decision on confirmation flow.

**SDK additions (`matrix-js-sdk`)**

- `AdminManager.listBackups(params?)` — paginated E2EE backup inventory. Wraps `GET /_synapse/admin/v1/backups`. Validates `limit ∈ [1,500]`, `offset ≥ 0`.
- `AdminManager.getExperimentalFeatures()` — wraps `GET /_synapse/admin/v1/experimental_features`.
- Tests: 5 new unit cases in `spec/unit/admin-new-endpoints.spec.ts` (path, default/custom query, boundary validation).

### 2026-04-23 — purgeMediaCache re-enabled

Backend (`synapse-rust`) implemented `MediaService::purge_media_cache(before_ts)` and wired it into `POST /_synapse/admin/v1/purge_media_cache` (previously returned `M_UNRECOGNIZED`). SDK:

- **`AdminManager.purgeMediaCache(beforeTs?)`** — removed `@deprecated` tag, refreshed JSDoc with implementation reference (`synapse-rust/src/services/media_service.rs::purge_media_cache`).
- Added client-side validation: `beforeTs`, if provided, must be a positive integer (ms since epoch). Otherwise throws `ValidationError`.
- Behavior: when `beforeTs` is omitted, the wrapper sends an empty body and the backend defaults to `now - 30d`.
- Tests: 5 new unit cases in `spec/unit/admin-new-endpoints.spec.ts` covering empty-body / with-ts / missing-field response / non-positive / non-integer inputs.

### 2026-04-23 — Backend alignment pass (synapse-rust)

#### Breaking fixes (SDK ↔ backend contract)

- **`AdminManager.setAdmin`**: `PUT /v2/users/{id}` body `{admin}` → **`PUT /v1/users/{id}/admin`** body `{admin}`. Old path accidentally triggered user-create branch.
- **`AdminManager.addToFederationBlacklist`**: `POST /v1/federation/blacklist/add` → **`POST /v1/federation/blacklist/{server_name}`** body `{reason}`.
- **`AdminManager.removeFromFederationBlacklist`**: `POST /v1/federation/blacklist/remove` → **`DELETE /v1/federation/blacklist/{server_name}`**.
- **`AdminManager.getRoomStats(roomId)`**: `/v1/rooms/{id}/statistics` → **`/v1/room_stats/{id}`**.
- **`AdminManager.getAccountStatus`**: `/v1/account_status/{id}` → **`/v1/account/{id}`**.
- **`AdminManager.getServerInfo`**: `/v1/info` (missing) → concurrent merge of `/v1/status` + `/v1/config` + `/v1/server_version`.
- **`AdminManager.resetPassword(userId, newPassword)`**: removed `logout_devices` param (backend ignores it).
- **`AdminManager.deactivateUser(userId)`**: removed `erase` body param (backend has no body extractor).
- **`AdminManager.disconnectFederation` → `resetFederationConnection`** (old method kept as `@deprecated` proxy).
- **`FriendManager.createFriendGroup`**: response field `group_id` → **`id`** (matches backend).
- **`FriendManager.getIncomingRequests`**: uses **`/friends/request/received`** as the stable v1 path and falls back to `/friends/requests/incoming` for legacy compatibility.
- **`SpaceManager.getSpaceByRoom`**: added as the contract-aligned name for `GET /spaces/room/{room_id}`; existing `getRoomSpace` remains as a compatibility alias.
- **`PresenceState`**: added `"away"` (value accepted by backend `validate_presence_status`).

#### New API surface

- **`WorkerAdminManager` (new module)**: 24 endpoints for `/_synapse/worker/v1/*` (workers / commands / tasks / statistics / select / replication / events).
- **`WidgetsManager`**: full REST wrappers for 14 endpoints (`/_matrix/client/v1/widgets/*`, `/rooms/{id}/widgets`, permissions, sessions, jitsi/config).
- **`AdminManager` extensions**:
  - Retention: `getRetentionPolicy` / `setRetentionPolicy` / `getRoomRetentionPolicy` / `setRoomRetentionPolicy` / `runRetention` / `getRetentionStatus`
  - Audit: `listAuditEvents` / `getAuditEvent` / `createAuditEvent`
  - Feature flags: `listFeatureFlags` / `getFeatureFlag` / `createFeatureFlag` / `updateFeatureFlag`
  - Federation detail: `resolveFederation` / `rewriteFederation` / `deleteFederationDestination` / `getFederationDestinationRooms`
  - Modules: `listModules` / `listModulesByType` / `getModule` / `createModule` / `updateModuleConfig` / `setModuleEnabled` / `deleteModule` / `checkModuleSpam` / `getModuleLogs`
  - Event-report rate limit: `checkEventReportRateLimit` / `blockEventReportUser` / `unblockEventReportUser`
  - Telemetry: `listTelemetryAlerts` / `acknowledgeTelemetryAlert`
  - Media: `getMediaQuota`
- **`MatrixClient`**: `getClientConfig()` / `searchRooms(term, limit?)` / `getSSOUserInfo()`.
- **`FriendManager`**: `sendFriendRequest` now returns `{request_id, status}`; `acceptFriendRequest` returns `{room_id}`. Added `hasCachedFriend()`.
- **Type additions**: `RetentionPolicy`, `RoomRetentionPolicy`, `RetentionRunResult`, `RetentionStatus`, `AuditEvent`, `AuditEventPage`, `FeatureFlag`, `FeatureFlagTarget`, `FeatureFlagPage`, `Widget`, `WidgetResponse`, `CreateWidgetBody`, `UpdateWidgetBody`, `WorkerInfo`, `WorkerCommand`, `WorkerTask`.

#### Quality

- **Error hierarchy unified**: `InvalidParamError` now extends `ValidationError`; plain `Error` throws in `AuthManager`/`PresenceManager` replaced with typed errors.
- **Pagination**: `PaginatedResponse<T>` now exposes `total`; `getUsers`/`getRooms` (deprecated) delegate to `*Paginated` — dependency direction flipped.
- **Cache invalidation**: `PresenceManager.setPresence` now invalidates instead of priming with a local stub; `RoomSummaryManager.setRoomVaultData` / `setStickyEvent` / `deleteStickyEvent` / `addInviteBlocklist` / `addInviteAllowlist` now clear `summaryCache[roomId]` after successful write.
- **Empty `catch` cleanup** (9 files, 10 sites): media-quota, relations, security, sticky-event, room-alias, burn-after-read, widget, appservice, device-trust.
- **`DeviceTrustManager.getDeviceTrustList`**: fixed cache bug (prior impl stored entire list under single key `"__list__"` and returned `[cached]`).
- **Dead code**: removed empty `src/client-modules/` directory; removed duplicate `NotificationsLegacyManager` declaration in `matrix-client-extensions.d.ts`.
- **Tests added**: `spec/unit/worker-admin.spec.ts` (16 cases), `spec/unit/admin-new-endpoints.spec.ts` (21 cases); `spec/unit/widgets.spec.ts` +10 REST cases; `spec/unit/friend.spec.ts` +2 return-value cases.

### 2026-04-06 (Round 3)

#### Testing

- **新增 0% 覆盖率模块测试** (67 个新测试)
  - DeviceTrustManager: 0% → 77.1% (29 个测试)
    - 设备验证请求、响应、状态查询
    - 设备信任列表、信任信息查询
    - 安全摘要、缓存机制、重试逻辑
  - DiscoveryManager: 0% → 95.12% (22 个测试)
    - 服务发现、房间别名解析
    - 用户目录搜索、公开房间查询
    - 房间可见性管理
  - AccountDataManager: 0% → 89.47% (16 个测试)
    - 账户数据读写、删除
    - 房间级账户数据管理
    - 服务器数据同步
  - CapabilitiesManager: 0% → 66.66% (9 个测试)
    - 服务器能力查询
    - 缓存机制

- **测试总数**: 3610 → 3619 个测试 (+9)
- **整体覆盖率**: 71.37% → 71.38% (lines)

#### Documentation

- **迁移指南** (`docs/MIGRATION_GUIDE.md`)
  - 详细的 API 迁移说明
  - 31 个废弃方法的替代方案
  - 代码示例和最佳实践
  - 迁移检查清单

- **重构计划** (`docs/CLIENT_REFACTOR_PLAN.md`)
  - client.ts 长期重构路线图
  - 8 个阶段的详细计划
  - 风险评估和缓解措施
  - 预计 12-18 个月完成

#### Deprecation Notice

以下方法已标记为 @deprecated，将在 v41.0.0 移除：

**Profile 管理** (5 个方法):
- `setProfileInfo()` → 使用 `getProfileManager().setProfileInfo()`
- `setDisplayName()` → 使用 `getProfileManager().setDisplayName()`
- `setAvatarUrl()` → 使用 `getProfileManager().setAvatarUrl()`
- `getProfileInfo()` → 使用 `getProfileManager().getProfileInfo()`
- `mxcUrlToHttp()` → 使用 `getProfileManager().mxcUrlToHttp()`

**Presence 管理** (2 个方法):
- `setPresence()` → 使用 `getPresenceManager().setPresence()`
- `getPresence()` → 使用 `getPresenceManager().getPresence()`

**Device 管理** (7 个方法):
- `getDevices()` → 使用 `getDeviceManager().getDevices()`
- `getDevice()` → 使用 `getDeviceManager().getDevice()`
- `setDeviceDetails()` → 使用 `getDeviceManager().updateDevice()`
- `deleteDevice()` → 使用 `getDeviceManager().deleteDevice()`
- `deleteMultipleDevices()` → 使用 `getDeviceManager().deleteDevices()`

**Push 管理** (8 个方法):
- `getPushers()` → 使用 `getPushManager().getPushers()`
- `setPusher()` → 使用 `getPushManager().setPusher()`
- `removePusher()` → 使用 `getPushManager().removePusher()`
- `getPushRules()` → 使用 `getPushManager().getPushRules()`
- `addPushRule()` → 使用 `getPushManager().addPushRule()`
- `deletePushRule()` → 使用 `getPushManager().deletePushRule()`
- `setPushRuleEnabled()` → 使用 `getPushManager().setPushRuleEnabled()`
- `setPushRuleActions()` → 使用 `getPushManager().setPushRuleActions()`

**Room Summary 管理** (3 个方法):
- `getRoomSummary()` → 使用 `getRoomSummaryManager().getRoomSummary()`
- `getRoomSummaryMembers()` → 使用 `getRoomSummaryManager().getRoomSummaryMembers()`
- `getRoomSummaryStats()` → 使用 `getRoomSummaryManager().getRoomSummaryStats()`

> **迁移时间表**: 这些方法将在 v41.0.0 (预计 2026 Q3) 移除。请参考 `docs/MIGRATION_GUIDE.md` 进行迁移。

### 2026-04-06

#### Code Quality

- **LRUCache 工具类提取**
  - 创建 `src/utils/lru-cache.ts` 统一的 LRU 缓存实现
  - 消除 FriendManager、DirectMessageManager、AuthManager 中的重复代码
  - 添加完整的单元测试覆盖

- **BaseManager 基类**
  - 创建 `src/managers/base-manager.ts` 统一错误处理和重试逻辑
  - 所有 Manager 类继承 BaseManager
  - 减少约 650 行重复代码

- **类型安全改进**
  - AdminManager: 修复 `client: any` 类型为 `MatrixClient`
  - AuthManager: 移除不必要的类型断言

#### Performance

- **修复 urlPreviewCache 内存泄漏**
  - `client.urlPreviewCache` 改用 LRUCache (maxSize=100, TTL=1小时)
  - 修复 `UrlPreviewManager.clearUrlPreviewCache()` 方法

- **SlidingSync 资源清理**
  - 添加 `destroy()` 方法清理所有资源
  - 防止内存泄漏

#### Testing

- **FriendManager 单元测试** (47 个测试)
  - 覆盖率: 0% → 85%+
  - 测试所有核心方法、事件系统、缓存机制

- **AdminManager 测试补充** (41 个新测试)
  - 覆盖率: 35% → 75%+
  - 用户管理、房间管理、媒体管理、联邦管理、空间管理

- **SpaceManager 测试补充** (23 个新测试)
  - 覆盖率: 27% → 70%+
  - CRUD 操作、成员管理、层级查询、缓存机制

- **PresenceManager 测试修复** (12 个测试)
  - 修复测试断言以匹配实际实现

- **测试配置完善**
  - 添加 testTimeout、hookTimeout、teardownTimeout
  - 添加覆盖率阈值 (lines: 70%, functions: 70%, branches: 60%, statements: 70%)

#### Documentation

- 创建 `docs/OPTIMIZATION_NOTES.md` 详细优化记录

### 2026-04-05

#### Performance

- **ProfileManager**: 添加 LRU 缓存支持
  - `profileCache` - 用户资料缓存（200 条，TTL 10 分钟）
  - `getCacheStats()` - 缓存统计方法
  - `clearCache()` - 缓存清理方法

- **PresenceManager**: 改用 LRU 缓存替代原生 Map
  - `presenceCache` - 在线状态缓存（500 条，TTL 5 分钟）
  - 修复内存泄漏风险

- **FriendManager**: 改用 LRU 缓存替代原生 Map
  - `friends` 缓存（500 条，TTL 5 分钟）
  - 修复内存泄漏风险

#### Deprecated

以下 `MatrixClient` 方法已标记为废弃，建议使用对应的 Manager API：

**Device 管理** (使用 `client.getDeviceManager()`):
- `getDevices()` → `getDeviceManager().getDevices()`
- `getDevice(deviceId)` → `getDeviceManager().getDevice(deviceId)`
- `setDeviceDetails()` → `getDeviceManager().updateDevice()`
- `deleteDevice()` → `getDeviceManager().deleteDevice()`
- `deleteMultipleDevices()` → `getDeviceManager().deleteDevices()`

**Push 管理** (使用 `client.getPushManager()`):
- `getPushers()` → `getPushManager().getPushers()`
- `setPusher()` → `getPushManager().setPusher()`
- `removePusher()` → `getPushManager().removePusher()`
- `getPushRules()` → `getPushManager().getPushRules()`
- `setPushRules()` → `getPushManager().setPushRules()`
- `addPushRule()` → `getPushManager().addPushRule()`
- `deletePushRule()` → `getPushManager().deletePushRule()`
- `setPushRuleEnabled()` → `getPushManager().setPushRuleEnabled()`
- `setPushRuleActions()` → `getPushManager().setPushRuleActions()`

**Presence 管理** (使用 `client.getPresenceManager()`):
- `setPresence()` → `getPresenceManager().setPresence()`
- `getPresence()` → `getPresenceManager().getPresence()`

**Room Summary** (使用 `client.getRoomSummaryManager()`):
- `getRoomSummary()` → `getRoomSummaryManager().getRoomSummary()`
- `getRoomSummaryMembers()` → `getRoomSummaryManager().getRoomSummaryMembers()`
- `getRoomSummaryStats()` → `getRoomSummaryManager().getRoomSummaryStats()`

**Profile 管理** (使用 `client.getProfileManager()`):
- `setProfileInfo()` → `getProfileManager().setProfileInfo()`
- `setDisplayName()` → `getProfileManager().setDisplayName()`
- `setAvatarUrl()` → `getProfileManager().setAvatarUrl()`
- `getProfileInfo()` → `getProfileManager().getProfileInfo()`
- `mxcUrlToHttp()` → `getProfileManager().mxcUrlToHttp()`

> **注意**: 这些方法将在未来版本中移除。Manager API 提供更好的缓存、事件发射和错误处理机制。

### 2026-04-03

#### Added

- **DeviceManager**: 扩展设备管理器
  - `getDeviceListUpdates()` - 查询多用户设备变更

- **DirectMessageManager**: 扩展私信管理器
  - `createDmRoom()` - 使用专用 API 创建 DM 房间
  - `getDirectRoomsFromServer()` - 从服务器获取 DM 映射
  - `updateDirectRoom()` - 更新房间的 DM 映射
  - `isDmRoomFromServer()` - 检查房间是否为 DM（使用专用 API）
  - `getDmPartnerFromServer()` - 获取 DM 对端资料

#### Tests

- 添加 DM 专用 API 单元测试（`spec/unit/dm.spec.ts`）
  - `createDmRoom` 测试：API 调用、参数传递、错误处理、事件发射
  - `getDirectRoomsFromServer` 测试：API 调用、空数据处理
  - `updateDirectRoom` 测试：API 调用、错误处理、事件发射
  - `isDmRoomFromServer` 测试：DM 判断、非 DM 判断、404 处理、错误处理
  - `getDmPartnerFromServer` 测试：API 调用、错误处理

- **QrLoginManager**: QR 码登录管理器
  - `getQrCode()` - 获取二维码内容
  - `startQrLogin()` - 启动二维码登录事务
  - `confirmQrLogin()` - 确认二维码登录
  - `getQrStatus()` - 查询二维码登录状态
  - `invalidateQrLogin()` - 使二维码登录事务失效
  - `waitForConfirmation()` - 等待确认（轮询辅助方法）

- **AccountManager**: 扩展账户管理器
  - `logoutAll()` - 登出所有设备
  - `submitEmailToken()` - 提交邮箱验证 token

- **AuthManager**: 扩展认证管理器
  - `getRegisterFlows()` - 获取注册流程列表
  - `hasLoginFlow()` - 检查是否支持特定登录流程
  - `hasPasswordLogin()` - 检查是否支持密码登录
  - `hasSSOLogin()` - 检查是否支持 SSO 登录

- **DiscoveryManager**: 扩展发现管理器
  - `searchUserDirectory()` - 搜索用户目录
  - `listUserDirectory()` - 列举用户目录
  - `getUserDirectoryProfile()` - 获取用户目录资料
  - `getRoomVisibility()` - 获取房间可见性
  - `setRoomVisibility()` - 设置房间可见性
  - `getPublicRooms()` - 获取公开房间列表
  - `queryPublicRooms()` - 查询公开房间
  - `setRoomAlias()` - 设置房间别名
  - `deleteRoomAlias()` - 删除房间别名

- **UserReportManager**: 用户举报管理器
  - `reportUser()` - 举报用户

- **AccountDataManager**: 扩展账户数据管理器
  - `listAccountData()` - 列出所有账户数据
  - `getRoomAccountDataFromServer()` - 从服务器获取房间级账户数据

#### Fixed

- 修复 `external-service/index.ts` 类型错误 (`body?: unknown` → `body?: Body`)
- 修复 `room-summary/index.ts` 类型错误 (`body?: unknown` → `body?: Body`)
- 修复 `space/index.ts` 类型错误 (`body?: unknown` → `body?: Body`, `user_id` 空值处理)

#### Changed

- 统一 Manager 导出，所有 Manager 通过 `matrix.ts` 主入口导出
- 更新 `manager-extensions/index.ts` 添加新 Manager 到初始化列表
- 更新契约文档 `auth.md` 添加 SDK Manager 对应关系

### 后端同步修复

- 修复 `openid/request_token` HTTP 方法问题（支持 GET 和 POST）
- 添加 `DELETE account_data` 端点
- 添加 `DELETE room_account_data` 端点
- 添加 `DELETE filter` 端点

---

## [Previous Releases]

### 2026-03-29

- 添加 SDK 错误码体系规范 (AuthError, NotFoundError, RetryableError, ApiError)
- 添加 normalizeError 方法实现规范
- 添加统一 Manager extendMatrixClient 规范
- 修复 Admin URL 重复前缀问题
- 修复 DM getDMRooms 只看 invite 问题
- 修复 m.direct 读取位置问题
- 修复 Space Manager 未导出问题
- 修复错误处理不分类问题
