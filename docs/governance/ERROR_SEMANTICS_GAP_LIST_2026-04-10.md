# Error Semantics Gap List (2026-04-10)

## 1. 概述

本文档记录了 `matrix-js-sdk` 中所有 Manager 类对 `BaseManager` 统一错误处理体系的接入情况。

> **最后更新**: 2026-04-11 (基于代码实际审查)

## 2. 覆盖率基线

- **总 Manager 类数**: 102 (本清单口径)
- **已接入 `BaseManager`**: 101
- **未接入 `BaseManager`**: 1 (内部类)
- **当前覆盖率**: **99.0%**

## 3. 详细清单

### 3.1 已接入 BaseManager ✅

共 101 个 Manager 已接入 BaseManager，完整列表：

**核心业务 Manager (已 100% 迁移)**:

- RoomManager, EventManager, PushManager, FriendManager
- DirectMessageManager, SpaceManager, FilterManager, AdminManager
- FederationManager, FederationBlacklistManager, PresenceManager
- AccountDataManager, ProfileManager, WidgetManager, RoomSummaryManager
- RelationsManager, VoiceMessageManager, AIConnectionManager, GuestManager
- DeviceKeysManager, AccountManager, SessionManager, FilteringManager
- SecretStorageManager, KeyClaimManager, AggregationsManager, MediaQuotaManager
- BeaconManager, CryptoBackupManager, SettledManager, RoomAccountDataManager
- WidgetsManager, CrossSigningManager, CryptoAlgorithmsManager, CryptoStoreManager
- CredentialsManager, TurnServerManager, TokenManager, ServerTimeManager
- RetentionManager, ReactionsManager, AuthManager, EncryptionRotationManager
- ServerCapabilitiesManager, PendingActionsManager, RoomKeySharingManager, RoomSettingsManager
- UserManager, ContentScanManager, ReportingManager, IdentityManager
- RoomMemberManager, SyncManager, TagsManager, MessageManager
- NotificationsLegacyManager, MembershipManager (client), SendingManager, NotificationsManager
- RoomJoiningManager, StoresManager, PaginationManager, UploadsManager
- ReadReceiptsManager, CapabilitiesManager, ScheduledEventsManager, SearchManager
- DirectoryManager, RoomCreationManager, RoomStateManager, RoomUpgradesManager
- LifecycleManager, VoIPCallsManager, PowerLevelsManager, PushRulesManager
- SendingQueueManager, InvitesManager, EventProcessingManager, RoomEventsManager
- HttpManager, KeyForwardingManager, UserPresenceManager, TelemetryManager
- EventStatusManager, CaptchaManager, SyncAccumulatorManager, CryptoEncryptionManager
- RoomStateManagementManager, RenderingManager, OtrManager, LoggerManager
- EditionsManager, ScheduledCallManager, SessionsManager, StickyEventManager
- OidcManager, SecurityManager, ToDeviceManager

### 3.2 未接入 BaseManager (内部类，不影响错误语义统一目标)

| 模块        | 类名              | 文件路径                    | 原因                                    |
| ----------- | ----------------- | --------------------------- | --------------------------------------- |
| rust-crypto | RustBackupManager | `src/rust-crypto/backup.ts` | Rust 加密内部类，继承 TypedEventEmitter |

**结论**: 当前仅剩 1 个内部类未迁移，不暴露给外部调用方，不影响错误语义统一目标。

## 4. 结论

**T-Q1 任务状态**: ✅ **已完成（核心目标达成，剩余 1 项内部类豁免）**

- 核心业务 Manager 已完成迁移，当前主要剩余内部/包装类
- 错误语义统一已完成验收闭环，后续仅做台账归档与周度维护
- 任务状态与 `UNFINISHED_TASKS_2026Q2.md`、`RISK_REGISTER.md` 保持一致

## 5. `any` 类型清理进展

### 5.1 清理前后对比

| 类型              | 清理前 | 清理后 | 减少 |
| ----------------- | -----: | -----: | ---: |
| `: any` 类型声明  |     22 |     10 |  -12 |
| `as any` 类型转换 |     19 |      0 |  -19 |

### 5.2 已修复的文件

| 文件                                     | 修复内容                                                            |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `src/presence/index.ts`                  | `getCacheStats(): any` → 明确返回类型                               |
| `src/profile/index.ts`                   | `getCacheStats(): any` → 明确返回类型                               |
| `src/room-summary/index.ts`              | `clientSummary as any` → `ClientRoomSummary`                        |
| `src/voice/index.ts`                     | `messageContent as any` → `as unknown as RoomMessageEventContent`   |
| `src/voice/index.ts`                     | `(window as any).AudioContext` → 类型安全访问                       |
| `src/dm/index.ts`                        | `messageContent as any` → `as unknown as RoomMessageEventContent`   |
| `src/widget/index.ts`                    | `(error as any).errcode` → `{ errcode?: string }`                   |
| `src/room/RoomManager.ts`                | `"deleteRoom" as any` → `ClientEvent.DeleteRoom`                    |
| `src/@types/global.d.ts`                 | 定时器与 Promise reject 参数由 `any` 调整为 `unknown`               |
| `src/@types/matrix-sdk-crypto-wasm.d.ts` | `requestVerification(methods?: any[])` → `methods?: unknown[]`      |
| `src/logger.ts`                          | `Debugger` 接口 `formatter/args` 使用 `unknown`，减少不必要的 `any` |

### 5.3 剩余 `any` 使用分析

**`: any` 剩余 10 处**（均为声明兼容、可解释场景）:

- 类型定义/接口中的动态索引（如 IContent）
- 日志基础接口的可变参数（兼容第三方实现）
- 事件监听器与 EventEmitter 泛型兼容声明
- 存储相关事件处理回调

**`as any` 剩余 0 处**：

已通过改用显式类型、`unknown` 转换或扩展接口声明方式消除历史 `as any` 转换点

## 6. 相关文档

- [P0 风险关闭计划](./P0_RISK_CLOSURE_PLAN.md)
- [风险台账](./RISK_REGISTER.md)
- [未完成任务清单](./UNFINISHED_TASKS_2026Q2.md)
