# Changelog

All notable changes to the Matrix JS SDK will be documented in this file.

## [Unreleased]

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
