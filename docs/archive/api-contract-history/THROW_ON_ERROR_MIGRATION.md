# API 变更通知：throwOnError 模式扩展

> 日期: 2026-04-11
> 影响范围: Manager 模块错误处理
> 变更类型: 错误处理默认策略收紧

## 一、变更概述

为减少吞错点并提高错误可观测性，多个 Manager 方法已统一提供
`throwOnError` 参数。当前推进方向是将读取接口默认策略逐步收紧为
`throwOnError = true`；已完成切换的方法默认抛错，尚未完成切换的方法会在
下文状态列中标记为“默认值待收紧”。

## 二、变更模式

### 2.1 方法签名变更

```typescript
// 变更前
async getSomething(id: string): Promise<Something | null>;

// 变更后
async getSomething(
    id: string,
    throwOnError = true,
): Promise<Something | null>;
```

### 2.2 行为说明

| throwOnError | 行为                                            |
| ------------ | ----------------------------------------------- |
| `true`       | 错误时抛出异常，调用方可捕获处理                |
| `false`      | 兼容降级场景下返回 `null`/`[]`/`false` 等兜底值 |

### 2.3 使用示例

```typescript
// 默认行为：错误直接抛出
try {
    const data = await manager.getSomething("id");
} catch (error) {
    console.error("获取数据失败:", error);
}

// 兼容降级用法：仅在确实需要吞错兜底时显式传 false
const data = await manager.getSomething("id", false);
```

## 三、受影响的方法列表

### 3.1 已实现 throwOnError 的方法

#### admin 模块

| 方法                         | 兼容降级返回值 | 状态      |
| ---------------------------- | -------------- | --------- |
| `getUser()`                  | `null`         | ✅ 已实现 |
| `getServerConfig()`          | `{}`           | ✅ 已实现 |
| `getServerVersion()`         | `null`         | ✅ 已实现 |
| `getShadowBanStatus()`       | `null`         | ✅ 已实现 |
| `getRateLimit()`             | `null`         | ✅ 已实现 |
| `getRoom()`                  | `null`         | ✅ 已实现 |
| `getRoomVersion()`           | `null`         | ✅ 已实现 |
| `getRoomStats()`             | `null`         | ✅ 已实现 |
| `getSpace()`                 | `null`         | ✅ 已实现 |
| `getFederationDestination()` | `null`         | ✅ 已实现 |
| `getAccountDetails()`        | `null`         | ✅ 已实现 |
| `whois()`                    | `null`         | ✅ 已实现 |

#### friend 模块

| 方法              | 兼容降级返回值 | 状态      |
| ----------------- | -------------- | --------- |
| `getFriendInfo()` | `null`         | ✅ 已实现 |

#### dm 模块

| 方法                       | 兼容降级返回值 | 状态      |
| -------------------------- | -------------- | --------- |
| `getDmRoom()`              | `null`         | ✅ 已实现 |
| `isDmRoomFromServer()`     | `false`        | ✅ 已实现 |
| `getDmPartnerFromServer()` | `null`         | ✅ 已实现 |

#### push 模块

| 方法                | 兼容降级返回值 | 状态      |
| ------------------- | -------------- | --------- |
| `getPushRule()`     | `null`         | ✅ 已实现 |
| `ackNotification()` | `void`         | ✅ 已实现 |

#### presence 模块

| 方法                     | 兼容降级返回值 | 状态      |
| ------------------------ | -------------- | --------- |
| `getPresence()`          | `null`         | ✅ 已实现 |
| `getPresenceList()`      | `[]`           | ✅ 已实现 |
| `getPresenceListByIds()` | `[]`           | ✅ 已实现 |

#### profile 模块

| 方法               | 兼容降级返回值 | 状态      |
| ------------------ | -------------- | --------- |
| `getDisplayName()` | `null`         | ✅ 已实现 |
| `getAvatarUrl()`   | `null`         | ✅ 已实现 |

#### room-alias 模块

| 方法                  | 兼容降级返回值 | 状态      |
| --------------------- | -------------- | --------- |
| `getAliasRoom()`      | `null`         | ✅ 已实现 |
| `getRoomAliases()`    | `null`         | ✅ 已实现 |
| `getCanonicalAlias()` | `null`         | ✅ 已实现 |
| `getAltAliases()`     | `[]`           | ✅ 已实现 |

#### room 模块

| 方法              | 兼容降级返回值 | 状态      |
| ----------------- | -------------- | --------- |
| `getMembership()` | `null`         | ✅ 已实现 |

#### thirdparty 模块

| 方法                | 兼容降级返回值 | 状态      |
| ------------------- | -------------- | --------- |
| `getProtocols()`    | `[]`           | ✅ 已实现 |
| `getProtocol()`     | `null`         | ✅ 已实现 |
| `searchLocations()` | `[]`           | ✅ 已实现 |
| `searchUsers()`     | `[]`           | ✅ 已实现 |

#### widget 模块

| 方法                       | 兼容降级返回值 | 状态      |
| -------------------------- | -------------- | --------- |
| `getRoomWidgets()`         | `[]`           | ✅ 已实现 |
| `getWidget()`              | `null`         | ✅ 已实现 |
| `getWidgetConfig()`        | `null`         | ✅ 已实现 |
| `getJitsiConfig()`         | `null`         | ✅ 已实现 |
| `getWidgetPermissions()`   | `null`         | ✅ 已实现 |
| `deleteWidgetPermission()` | `false`        | ✅ 已实现 |
| `getWidgetSessions()`      | `[]`           | ✅ 已实现 |
| `getWidgetSession()`       | `null`         | ✅ 已实现 |
| `terminateWidgetSession()` | `false`        | ✅ 已实现 |

#### webrtc/mediaHandler 模块

| 方法               | 兼容降级返回值 | 状态      |
| ------------------ | -------------- | --------- |
| `hasAudioDevice()` | `false`        | ✅ 已实现 |
| `hasVideoDevice()` | `false`        | ✅ 已实现 |

#### webrtc/call 模块

| 方法               | 兼容降级返回值 | 状态      |
| ------------------ | -------------- | --------- |
| `initWithInvite()` | -              | ✅ 已实现 |

#### rust-crypto/backup 模块

| 方法                           | 兼容降级返回值 | 状态      |
| ------------------------------ | -------------- | --------- |
| `checkKeyBackupAndEnable()`    | `null`         | ✅ 已实现 |
| `handleBackupSecretReceived()` | `false`        | ✅ 已实现 |

#### crypto-keys 模块

| 方法                       | 兼容降级返回值 | 状态      |
| -------------------------- | -------------- | --------- |
| `getRoomKeyDistribution()` | `null`         | ✅ 已实现 |

#### device 模块

| 方法          | 兼容降级返回值 | 状态      |
| ------------- | -------------- | --------- |
| `getDevice()` | `null`         | ✅ 已实现 |

#### media-quota 模块

| 方法                       | 兼容降级返回值 | 状态      |
| -------------------------- | -------------- | --------- |
| `getUploadSizeLimit()`     | `0`            | ✅ 已实现 |
| `getUploadFileSizeLimit()` | `0`            | ✅ 已实现 |
| `getUserStorageUsage()`    | `null`         | ✅ 已实现 |

#### federation 模块

| 方法                          | 兼容降级返回值 | 状态      |
| ----------------------------- | -------------- | --------- |
| `getBlacklist()`              | `[]`           | ✅ 已实现 |
| `getServerStatus()`           | `null`         | ✅ 已实现 |
| `getFederationDestinations()` | `[]`           | ✅ 已实现 |
| `getServerVersion()`          | `null`         | ✅ 已实现 |

#### room-summary 模块

| 方法                      | 兼容降级返回值 | 状态      |
| ------------------------- | -------------- | --------- |
| `getRoomSummary()`        | `null`         | ✅ 已实现 |
| `getRoomSummaryMembers()` | `[]`           | ✅ 已实现 |
| `getRoomSummaryStats()`   | `null`         | ✅ 已实现 |
| `getRoomHierarchy()`      | `null`         | ✅ 已实现 |
| `getPublicRooms()`        | `null`         | ✅ 已实现 |

### 3.2 计划扩展的方法

当前公开读取接口与兼容降级入口已完成默认值收紧；若后续新增 `throwOnError`
参数接口，应继续遵循“默认抛错、显式降级”的约束。

## 四、前端开发人员指南

### 4.1 迁移步骤

1. **评估调用点**：区分“必须感知失败”与“允许兼容降级”的调用场景。
2. **补齐错误处理**：对已收紧接口，默认调用直接配套 `try/catch`、上报或 UI 提示。
3. **显式标记兼容分支**：仅在确实需要兜底值时传入 `false`。

### 4.2 迁移示例

```typescript
// 场景1: 用户信息展示（默认抛错，调用侧决定是否降级）
async function showUserInfo(userId: string) {
    try {
        const user = await adminManager.getUser(userId);
        renderUserProfile(user);
    } catch (error) {
        renderPlaceholder();
    }
}

// 场景2: 兼容读取（明确接受降级返回）
async function loadOptionalUserInfo(userId: string) {
    const user = await adminManager.getUser(userId, false);
    if (!user) {
        renderPlaceholder();
    }
}

// 场景3: 关键操作（需要错误感知）
async function saveUserSettings(userId: string, settings: Settings) {
    try {
        const user = await adminManager.getUser(userId);
        await applySettings(user, settings);
    } catch (error) {
        showErrorToast("无法获取用户信息");
        logger.error("Failed to get user:", error);
    }
}
```

### 4.3 最佳实践

1. **优先收紧默认值**：对已切换接口直接使用默认行为，避免静默吞错。
2. **兼容降级要显式声明**：只有需要兜底值时才传 `throwOnError = false`。
3. **关键业务流程**：优先抛错，确保错误可感知、可追踪。
4. **测试环境**：同步覆盖默认抛错与显式降级两条路径。

## 五、时间计划

| 阶段    | 时间       | 内容                                                                      | 状态      |
| ------- | ---------- | ------------------------------------------------------------------------- | --------- |
| Phase 1 | 2026-04-11 | 文档发布、已实现方法验证                                                  | ✅ 已完成 |
| Phase 2 | 2026-04-15 | admin/friend 模块验证                                                     | ✅ 已完成 |
| Phase 3 | 2026-04-20 | push/presence/profile 模块扩展                                            | ✅ 已完成 |
| Phase 4 | 2026-04-25 | room-alias/thirdparty 模块扩展                                            | ✅ 已完成 |
| Phase 5 | 2026-04-12 | dm/widget/crypto-keys/device/media-quota/federation/room-summary 模块扩展 | ✅ 已完成 |

**总计**：已实现 **60** 个方法的 `throwOnError` 参数支持，覆盖 **15** 个核心模块；
其中 **60** 个方法默认已收紧为抛错，**0** 个方法仍处于兼容默认阶段。

## 六、联系方式

如有疑问，请联系：

- SDK 团队: @sdk-core-b
- 技术支持: tech-support@example.com

---

_本文档将随实现进度持续更新_
