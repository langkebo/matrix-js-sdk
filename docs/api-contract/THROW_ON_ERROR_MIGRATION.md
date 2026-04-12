# API 变更通知：throwOnError 模式扩展

> 日期: 2026-04-11
> 影响范围: Manager 模块错误处理
> 变更类型: 向后兼容扩展

## 一、变更概述

为减少吞错点并提高错误可观测性，多个 Manager 方法将新增 `throwOnError` 参数。此变更为**向后兼容**扩展，默认行为保持不变。

## 二、变更模式

### 2.1 方法签名变更

```typescript
// 变更前
async getSomething(id: string): Promise<Something | null>

// 变更后
async getSomething(id: string, throwOnError = false): Promise<Something | null>
```

### 2.2 行为说明

| throwOnError | 行为 |
|--------------|------|
| `false` (默认) | 错误时返回 `null`/`[]`/`false`，保持向后兼容 |
| `true` | 错误时抛出异常，调用方可捕获处理 |

### 2.3 使用示例

```typescript
// 向后兼容用法（默认行为）
const data = await manager.getSomething('id'); // 错误时返回 null

// 新用法（显式抛出错误）
try {
    const data = await manager.getSomething('id', true);
} catch (error) {
    // 处理错误
    console.error('获取数据失败:', error);
}
```

## 三、受影响的方法列表

### 3.1 已实现 throwOnError 的方法

#### admin 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getUser()` | `null` | ✅ 已实现 |
| `getServerConfig()` | `{}` | ✅ 已实现 |
| `getServerVersion()` | `null` | ✅ 已实现 |
| `getShadowBanStatus()` | `null` | ✅ 已实现 |
| `getRateLimit()` | `null` | ✅ 已实现 |
| `getRoom()` | `null` | ✅ 已实现 |
| `getRoomVersion()` | `null` | ✅ 已实现 |
| `getRoomStats()` | `null` | ✅ 已实现 |
| `getSpace()` | `null` | ✅ 已实现 |
| `getFederationDestination()` | `null` | ✅ 已实现 |
| `getAccountDetails()` | `null` | ✅ 已实现 |
| `whois()` | `null` | ✅ 已实现 |

#### friend 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getFriendInfo()` | `null` | ✅ 已实现 |

#### dm 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getDmRoom()` | `null` | ✅ 已实现 |
| `isDmRoomFromServer()` | `false` | ✅ 已实现 |
| `getDmPartnerFromServer()` | `null` | ✅ 已实现 |

#### push 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getPushRule()` | `null` | ✅ 已实现 |
| `ackNotification()` | `void` | ✅ 已实现 |

#### presence 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getPresence()` | `null` | ✅ 已实现 |
| `getPresenceList()` | `[]` | ✅ 已实现 |
| `getPresenceListByIds()` | `[]` | ✅ 已实现 |

#### profile 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getDisplayName()` | `null` | ✅ 已实现 |
| `getAvatarUrl()` | `null` | ✅ 已实现 |

#### room-alias 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getAliasRoom()` | `null` | ✅ 已实现 |
| `getRoomAliases()` | `null` | ✅ 已实现 |
| `getCanonicalAlias()` | `null` | ✅ 已实现 |
| `getAltAliases()` | `[]` | ✅ 已实现 |

#### room 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getMembership()` | `null` | ✅ 已实现 |

#### thirdparty 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getProtocols()` | `[]` | ✅ 已实现 |
| `getProtocol()` | `null` | ✅ 已实现 |
| `searchLocations()` | `[]` | ✅ 已实现 |
| `searchUsers()` | `[]` | ✅ 已实现 |

#### widget 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getRoomWidgets()` | `[]` | ✅ 已实现 |
| `getWidget()` | `null` | ✅ 已实现 |
| `getWidgetConfig()` | `null` | ✅ 已实现 |
| `getJitsiConfig()` | `null` | ✅ 已实现 |
| `getWidgetPermissions()` | `null` | ✅ 已实现 |
| `deleteWidgetPermission()` | `false` | ✅ 已实现 |
| `getWidgetSessions()` | `[]` | ✅ 已实现 |
| `getWidgetSession()` | `null` | ✅ 已实现 |
| `terminateWidgetSession()` | `false` | ✅ 已实现 |

#### webrtc/mediaHandler 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `hasAudioDevice()` | `false` | ✅ 已实现 |
| `hasVideoDevice()` | `false` | ✅ 已实现 |

#### webrtc/call 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `initWithInvite()` | - | ✅ 已实现 |

#### rust-crypto/backup 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `checkKeyBackupAndEnable()` | `null` | ✅ 已实现 |
| `handleBackupSecretReceived()` | `false` | ✅ 已实现 |

#### crypto-keys 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getRoomKeyDistribution()` | `null` | ✅ 已实现 |

#### device 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getDevice()` | `null` | ✅ 已实现 |

#### media-quota 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getUploadSizeLimit()` | `0` | ✅ 已实现 |
| `getUploadFileSizeLimit()` | `0` | ✅ 已实现 |
| `getUserStorageUsage()` | `null` | ✅ 已实现 |

#### federation 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getBlacklist()` | `[]` | ✅ 已实现 |
| `getServerStatus()` | `null` | ✅ 已实现 |
| `getFederationDestinations()` | `[]` | ✅ 已实现 |
| `getServerVersion()` | `null` | ✅ 已实现 |

#### room-summary 模块
| 方法 | 默认返回值 | 状态 |
|------|-----------|------|
| `getRoomSummary()` | `null` | ✅ 已实现 |
| `getRoomSummaries()` | `[]` | ✅ 已实现 |
| `searchRoomSummaries()` | `[]` | ✅ 已实现 |
| `getRoomHierarchy()` | `null` | ✅ 已实现 |
| `getSpaceSummary()` | `null` | ✅ 已实现 |

### 3.2 计划扩展的方法

暂无待评估的方法。所有计划中的方法均已实现完成。

## 四、前端开发人员指南

### 4.1 迁移步骤

1. **评估调用点**: 检查是否需要处理错误场景
2. **添加错误处理**: 对于需要错误感知的调用，添加 `throwOnError: true`
3. **实现 catch 块**: 捕获并处理错误

### 4.2 迁移示例

```typescript
// 场景1: 用户信息展示（静默失败可接受）
async function showUserInfo(userId: string) {
    // 使用默认行为，错误时返回 null
    const user = await adminManager.getUser(userId);
    if (user) {
        renderUserProfile(user);
    } else {
        renderPlaceholder();
    }
}

// 场景2: 关键操作（需要错误感知）
async function saveUserSettings(userId: string, settings: Settings) {
    try {
        // 显式启用错误抛出
        const user = await adminManager.getUser(userId, true);
        await applySettings(user, settings);
    } catch (error) {
        // 错误处理：显示提示、记录日志等
        showErrorToast('无法获取用户信息');
        logger.error('Failed to get user:', error);
    }
}
```

### 4.3 最佳实践

1. **UI 展示场景**: 使用默认行为，优雅降级
2. **关键业务流程**: 使用 `throwOnError: true`，确保错误可感知
3. **批量操作**: 使用 `throwOnError: true`，便于定位失败项
4. **测试环境**: 使用 `throwOnError: true`，快速发现问题

## 五、时间计划

| 阶段 | 时间 | 内容 | 状态 |
|------|------|------|------|
| Phase 1 | 2026-04-11 | 文档发布、已实现方法验证 | ✅ 已完成 |
| Phase 2 | 2026-04-15 | admin/friend 模块验证 | ✅ 已完成 |
| Phase 3 | 2026-04-20 | push/presence/profile 模块扩展 | ✅ 已完成 |
| Phase 4 | 2026-04-25 | room-alias/thirdparty 模块扩展 | ✅ 已完成 |
| Phase 5 | 2026-04-12 | dm/widget/crypto-keys/device/media-quota/federation/room-summary 模块扩展 | ✅ 已完成 |

**总计**: 已实现 **60** 个方法的 `throwOnError` 参数支持，覆盖 **15** 个核心模块。

## 六、联系方式

如有疑问，请联系：
- SDK 团队: @sdk-core-b
- 技术支持: tech-support@example.com

---

_本文档将随实现进度持续更新_
