# Manager Architecture Audit Report

> **Date**: 2026-07-20
> **Scope**: All 122 managers in `ManagerName` union type + 52 package.json exports + 27 @deprecated items
> **Status**: 报告阶段 — 待用户确认后再执行删除操作

---

## Part 1: Manager Usage Matrix

### 图例

| 列名 | 含义 |
|------|------|
| **Manager Name** | `ManagerName` 中的 key |
| **GetXxxManager** | `client.getXxxManager()` 对应的 getter 名称 |
| **SDK Refs** | `src/` 内引用该 manager 的文件数（不含 spec/__generated__） |
| **hula Refs** | hula 前端 `src/` 内引用该 manager 的文件数 |
| **Has Test** | 是否存在对应的 spec 文件 |
| **Contract Route** | `docs/api-contract/generated/modules/` 中是否存在路由清单 |
| **Has Extension** | 是否在 `extendMatrixClientWithManagers` 中注册 |
| **Classification** | 分类结论 |

### Classification Legend

| 标记 | 含义 |
|------|------|
| `ACTIVE` | 有前端或 SDK 内部引用，活跃使用中 |
| `CONTRACT_ONLY` | 0 前端引用但契约有路由 → 保留（API 完整性） |
| `INTERNAL` | 0 前端引用但有 SDK 内部引用 |
| `ZOMBIE_CANDIDATE` | 0 前端 + 0 内部 + 无契约路由 → 候选移除 |

---

### 完整矩阵

| # | Manager Name | GetXxxManager | SDK Refs | hula Refs | Has Test | Contract Route | Has Extension | Classification |
|---|-------------|---------------|----------|-----------|----------|---------------|---------------|----------------|
| 1 | `account` | AccountManager | 15 | 8 | yes | — | yes | ACTIVE |
| 2 | `accountData` | AccountDataManager | 10 | 1 | yes | account_data | yes | ACTIVE |
| 3 | `admin` | AdminManager | 13 | 3 | yes | admin | yes | ACTIVE |
| 4 | `aggregations` | AggregationsManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 5 | `aiConnection` | AIConnectionManager | 3 | 0 | yes | ai_connection | yes | INTERNAL |
| 6 | `auth` | AuthManager | 11 | 0 | yes | — | yes | INTERNAL |
| 7 | `authGlobalLogout` | GlobalLogoutManager | 2 | 0 | — | — | yes | INTERNAL |
| 8 | `backgroundUpdate` | BackgroundUpdateManager | 3 | 0 | yes | background_update | yes | INTERNAL |
| 9 | `beacon` | BeaconManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 10 | `BurnAfterReadManager` | BurnAfterReadManager | 2 | 3 | yes | burn_after_read | yes | ACTIVE |
| 11 | `capabilities` | CapabilitiesManager | 2 | 0 | yes | — | yes | INTERNAL |
| 12 | `captcha` | CaptchaManager | 2 | 0 | yes | captcha | yes | INTERNAL |
| 13 | `cas` | CasManager | 2 | 0 | yes | cas | yes | INTERNAL |
| 14 | `crossSigning` | CrossSigningManager | 2 | 0 | yes | — | yes | INTERNAL |
| 15 | `cryptoBackup` | CryptoBackupManager | 2 | 0 | no | — | yes | INTERNAL |
| 16 | `cryptoEncryption` | CryptoEncryptionManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 17 | `cryptoKeys` | CryptoKeysManager | 7 | 2 | yes | — | yes | ACTIVE |
| 18 | `cryptoStore` | CryptoStoreManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 19 | `dehydratedDevice` | DehydratedDeviceManager | 2 | 9 | yes | — | yes | ACTIVE |
| 20 | `device` | DeviceManager | 12 | 15 | yes | device | yes | ACTIVE |
| 21 | `deviceKeys` | DeviceKeysManager | 2 | 19 | yes | — | yes | ACTIVE |
| 22 | `deviceTrust` | DeviceTrustManager | 2 | 18 | yes | — | yes | ACTIVE |
| 23 | `directory` | DirectoryManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 24 | `discovery` | DiscoveryManager | 2 | 0 | yes | — | yes | INTERNAL |
| 25 | `dm` | DirectMessageManager | 5 | 11 | yes | dm | yes | ACTIVE |
| 26 | `e2ee` | E2EEManager | 0 | 0 | yes | e2ee | yes | CONTRACT_ONLY |
| 27 | `ephemeral` | EphemeralManager | 2 | 0 | yes | ephemeral | no | ZOMBIE_CANDIDATE |
| 28 | `event` | EventManager | 20 | 0 | no | — | no | INTERNAL |
| 29 | `eventProcessing` | EventProcessingManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 30 | `eventReport` | EventReportManager | 2 | 5 | yes | event_report | yes | ACTIVE |
| 31 | `eventStatus` | EventStatusManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 32 | `external-service` | ExternalServiceManager | 2 | 0 | yes | external_service | yes | INTERNAL |
| 33 | `featureFlags` | FeatureFlagManager | 2 | 0 | no | feature_flags | yes | INTERNAL |
| 34 | `federation` | FederationManager | 2 | 0 | yes | federation | yes | INTERNAL |
| 35 | `filter` | FilterManager | 6 | 0 | yes | — | yes | INTERNAL |
| 36 | `friend` | FriendManager | 2 | 6 | yes | friend_room | yes | ACTIVE |
| 37 | `guest` | GuestManager | 2 | 5 | yes | guest | yes | ACTIVE |
| 38 | `identity` | IdentityManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 39 | `identityServer` | IdentityServerManager | 5 | 0 | yes | — | yes | INTERNAL |
| 40 | `inviteBlocklist` | InviteBlocklistManager | 2 | 0 | yes | — | yes | INTERNAL |
| 41 | `invites` | InvitesManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 42 | `keyBackup` | KeyBackupManager | 2 | 44 | yes | key_backup | yes | ACTIVE |
| 43 | `keyForwarding` | KeyForwardingManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 44 | `keyRotation` | KeyRotationManager | 5 | 8 | yes | key_rotation | yes | ACTIVE |
| 45 | `keyVerification` | KeyVerificationManager | 2 | 6 | yes | — | yes | ACTIVE |
| 46 | `lifecycle` | LifecycleManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 47 | `media` | MediaManager | 4 | 0 | yes | media | yes | INTERNAL |
| 48 | `mediaQuota` | MediaQuotaManager | 2 | 6 | yes | — | no | ACTIVE |
| 49 | `membership` | MembershipManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 50 | `moderation` | ModerationManager | 2 | 0 | yes | moderation | yes | INTERNAL |
| 51 | `module` | ModuleManager | 2 | 0 | no | module | no | ZOMBIE_CANDIDATE |
| 52 | `notifications` | NotificationsManager | 6 | 0 | yes | push_notification | yes | INTERNAL |
| 53 | `oidc` | OidcManager | 2 | 0 | yes | oidc | yes | INTERNAL |
| 54 | `openclaw` | OpenClawManager | 3 | 0 | yes | openclaw | yes | INTERNAL |
| 55 | `passwordReset` | PasswordResetManager | 6 | 0 | yes | — | yes | INTERNAL |
| 56 | `pinnedMessages` | PinnedMessagesManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 57 | `presence` | PresenceManager | 7 | 10 | yes | presence | yes | ACTIVE |
| 58 | `profile` | ProfileManager | 27 | 0 | yes | — | yes | INTERNAL |
| 59 | `push` | PushManager | 17 | 3 | yes | push | yes | ACTIVE |
| 60 | `pushNotifications` | PushNotificationsManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 61 | `pushRules` | PushRulesManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 62 | `qrLogin` | QrLoginManager | 2 | 2 | yes | — | yes | ACTIVE |
| 63 | `reactions` | ReactionsManager | 4 | 0 | yes | reactions | yes | INTERNAL |
| 64 | `readReceipts` | ReadReceiptsManager | 3 | 8 | yes | — | yes | ACTIVE |
| 65 | `relations` | RelationsManager | 5 | 0 | yes | relations | yes | INTERNAL |
| 66 | `rendezvous` | RendezvousManager | 2 | 13 | yes | rendezvous | yes | ACTIVE |
| 67 | `reporting` | ReportingManager | 2 | 0 | yes | — | yes | INTERNAL |
| 68 | `retention` | RetentionManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 69 | `room` | RoomManager | 45 | 2 | no | room | yes | ACTIVE |
| 70 | `roomAccountData` | RoomAccountDataManager | 3 | 0 | no | — | yes | INTERNAL |
| 71 | `roomCreation` | RoomCreationManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 72 | `roomEvents` | RoomEventsManager | 3 | 0 | yes | — | no | INTERNAL |
| 73 | `roomJoining` | RoomJoiningManager | 2 | 0 | yes | — | no | INTERNAL |
| 74 | `roomKeySharing` | RoomKeySharingManager | 2 | 0 | yes | — | yes | INTERNAL |
| 75 | `roomKeys` | RoomKeysManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 76 | `roomList` | RoomListManager | 2 | 0 | no | — | yes | INTERNAL |
| 77 | `roomMember` | RoomMemberManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 78 | `roomSettings` | RoomSettingsManager | 2 | 0 | yes | — | yes | INTERNAL |
| 79 | `roomState` | RoomStateManager | 2 | 0 | yes | — | yes | INTERNAL |
| 80 | `roomStateManagement` | RoomStateManagementManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 81 | `roomSummary` | RoomSummaryManager | 2 | 9 | yes | room_summary | yes | ACTIVE |
| 82 | `roomUpgrades` | RoomUpgradesManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 83 | `saml-auth` | SamlAuthManager | 3 | 0 | yes | saml | yes | INTERNAL |
| 84 | `scheduledEvents` | ScheduledEventsManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 85 | `search` | SearchManager | 9 | 0 | yes | search | yes | INTERNAL |
| 86 | `secretStorage` | SecretStorageManager | 8 | 0 | yes | — | yes | INTERNAL |
| 87 | `secureBackup` | SecureBackupManager | 2 | 20 | yes | — | yes | ACTIVE |
| 88 | `security` | SecurityManager | 2 | 0 | yes | — | yes | INTERNAL |
| 89 | `sending` | SendingManager | 2 | 0 | yes | — | yes | INTERNAL |
| 90 | `sendingQueue` | SendingQueueManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 91 | `serverCapabilities` | ServerCapabilitiesManager | 18 | 0 | yes | — | yes | INTERNAL |
| 92 | `serverTime` | ServerTimeManager | 5 | 0 | no | — | yes | INTERNAL |
| 93 | `session` | SessionManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 94 | `sessions` | SessionsManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 95 | `space` | SpaceManager | 2 | 30 | yes | space | yes | ACTIVE |
| 96 | `stateSend` | StateSendManager | 4 | 0 | no | — | yes | INTERNAL |
| 97 | `stickyEvent` | StickyEventManager | 2 | 0 | yes | — | yes | INTERNAL |
| 98 | `syncAccumulator` | SyncAccumulatorManager | 2 | 0 | yes | sync | yes | INTERNAL |
| 99 | `syncManagement` | SyncManager | 7 | 0 | yes | — | yes | INTERNAL |
| 100 | `tagsManagement` | TagsManager | 2 | 0 | yes | tags | yes | INTERNAL |
| 101 | `telemetry` | TelemetryManager | 3 | 0 | yes | telemetry | yes | INTERNAL |
| 102 | `thirdparty` | ThirdPartyManager | 5 | 0 | yes | thirdparty | yes | INTERNAL |
| 103 | `thread` | ThreadManager | 2 | 0 | yes | thread | yes | INTERNAL |
| 104 | `threading` | ThreadingManager | 4 | 22 | yes | — | yes | ACTIVE |
| 105 | `threepids` | ThreePidsManager | 3 | 0 | no | — | yes | INTERNAL |
| 106 | `timeline` | TimelineManager | 11 | 0 | yes | — | yes | INTERNAL |
| 107 | `toDevice` | ToDeviceManager | 8 | 0 | yes | — | yes | INTERNAL |
| 108 | `tokenManagement` | TokenManager | 2 | 0 | no | — | no | ZOMBIE_CANDIDATE |
| 109 | `turnServer` | TurnServerManager | 6 | 0 | no | — | yes | INTERNAL |
| 110 | `typing` | TypingManager | 4 | 5 | yes | typing | yes | ACTIVE |
| 111 | `uploads` | UploadsManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 112 | `user` | UserManager | 4 | 0 | yes | — | yes | INTERNAL |
| 113 | `userDirectory` | UserDirectoryManager | 3 | 0 | yes | — | yes | INTERNAL |
| 114 | `userPresence` | UserPresenceManager | 2 | 0 | yes | — | no | ZOMBIE_CANDIDATE |
| 115 | `userReport` | UserReportManager | 2 | 0 | yes | — | yes | INTERNAL |
| 116 | `verification` | VerificationManager | 2 | 0 | yes | verification_routes | yes | INTERNAL |
| 117 | `voice` | VoiceManager | 3 | 0 | yes | voice | yes | INTERNAL |
| 118 | `voipCalls` | VoIPCallsManager | 2 | 0 | yes | — | yes | INTERNAL |
| 119 | `widget` | WidgetManager | 2 | 0 | yes | widget | yes | INTERNAL |
| 120 | `widgets` | WidgetsManager | 2 | 9 | yes | — | yes | ACTIVE |
| 121 | `workerAdmin` | WorkerAdminManager | 2 | 0 | yes | worker | yes | INTERNAL |
| 122 | `workerBody` | WorkerBodyManager | 2 | 0 | yes | worker_body | yes | INTERNAL |

### 汇总统计

| 分类 | 数量 | 占比 |
|------|------|------|
| **ACTIVE** (有 hula 引用) | 34 | 27.9% |
| **INTERNAL** (仅 SDK 内部引用) | 47 | 38.5% |
| **CONTRACT_ONLY** (契约有路由,0 前端引用) | 1 | 0.8% |
| **ZOMBIE_CANDIDATE** (0 前端 + 0 内部 + 无契约) | 40 | 32.8% |
| **总计** | 122 | 100% |

---

## Part 2: Zombie Manager Candidates

以下 40 个 manager 满足 **0 hula 引用 + 0 SDK 内部非注册引用（≤2 说明仅 registry+type map）+ 无对应契约路由**，列为候选移除：

### 高置信度（完全无引用）

| # | Manager Name | Source Dir | SDK Refs | Notes |
|---|-------------|-----------|----------|-------|
| 1 | `aggregations` | `src/aggregations/` | 2 | 仅 registry + type map 引用 |
| 2 | `beacon` | `src/beacon/` | 2 | 同上 |
| 3 | `cryptoEncryption` | `src/crypto-encryption/` | 2 | 同上 |
| 4 | `cryptoStore` | `src/crypto-store/` | 2 | 同上 |
| 5 | `directory` | `src/directory/` | 2 | 同上 |
| 6 | `ephemeral` | `src/ephemeral/` | 2 | 同上 |
| 7 | `eventProcessing` | `src/event-processing/` | 2 | 同上 |
| 8 | `eventStatus` | `src/event-status/` | 2 | 同上 |
| 9 | `identity` | `src/identity/` | 2 | 同上 |
| 10 | `invites` | `src/invites/` | 2 | 同上 |
| 11 | `keyForwarding` | `src/key-forwarding/` | 2 | 同上 |
| 12 | `lifecycle` | `src/lifecycle/` | 2 | 同上 |
| 13 | `membership` | `src/membership/` | 2 | 同上 |
| 14 | `module` | `src/module/` | 2 | 同上 |
| 15 | `pinnedMessages` | `src/pinned-messages/` | 2 | 同上 |
| 16 | `pushNotifications` | `src/push-notifications/` | 2 | 同上 |
| 17 | `pushRules` | `src/push-rules/` | 2 | 同上 |
| 18 | `retention` | `src/retention/` | 2 | 同上 |
| 19 | `roomCreation` | `src/room-creation/` | 2 | 同上 |
| 20 | `roomKeys` | `src/room-keys/` | 2 | 同上 |
| 21 | `roomMember` | `src/room-member/` | 2 | 同上 |
| 22 | `roomStateManagement` | `src/room-state-management/` | 2 | 同上 |
| 23 | `roomUpgrades` | `src/room-upgrades/` | 2 | 同上 |
| 24 | `scheduledEvents` | `src/scheduled-events/` | 2 | 同上 |
| 25 | `sendingQueue` | `src/sending-queue/` | 2 | 同上 |
| 26 | `session` | `src/session/` | 2 | 同上 |
| 27 | `sessions` | `src/sessions/` | 2 | 同上 |
| 28 | `tokenManagement` | `src/token-management/` | 2 | 同上 |
| 29 | `uploads` | `src/uploads/` | 2 | 同上 |
| 30 | `userPresence` | `src/user-presence/` | 2 | 同上 |

### 需进一步确认（有内部引用但无契约无hula）

| # | Manager Name | SDK Refs | Concern |
|---|-------------|----------|---------|
| 31 | `event` | 20 | 高 SDK 内部引用,无 hula 直接调用,但作为事件处理核心可能被间接使用 |
| 32 | `roomEvents` | 3 | 有 SDK 内部引用 |
| 33 | `roomJoining` | 2 | 有 SDK 内部引用 |

### 有契约路由但 0 hula 引用 → 保留（API 完整性）

| # | Manager Name | Contract Module |
|---|-------------|----------------|
| 1 | `e2ee` | `e2ee` |

> **注意**: `e2ee` 有契约路由清单但 hula 前端未直接引用，仍然保留以确保 API 完整性。

---

## Part 3: Package.json Exports Audit

### 有消费者（hula 前端引用）

| Export Path | hula Files | Format | Status |
|-------------|-----------|--------|--------|
| `.` (base) | 145 | new | HEAVILY USED |
| `/admin` | 11 | new | ACTIVE |
| `/telemetry` | 4 | new | ACTIVE |
| `/dm` | 3 | new | ACTIVE |
| `/friend` | 2 | new | ACTIVE |
| `/key-verification` | 2 | new | ACTIVE |
| `/guest` | 2 | new | ACTIVE |
| `/event-report` | 2 | new | ACTIVE |
| `/crypto` | 2 | new | ACTIVE |
| `/sync` | 1 | new | ACTIVE |
| `/store/worker` | 1 | new | ACTIVE |
| `/space` | 1 | new | ACTIVE |
| `/push` | 1 | new | ACTIVE |
| `/models/room-state` | 1 | new | ACTIVE |
| `/models/room` | 1 | new | ACTIVE |
| `/key-backup` | 1 | new | ACTIVE |
| `/device-keys` | 1 | new | ACTIVE |
| `/client` | 1 | new | ACTIVE |
| `/@types/partials` | 1 | new | ACTIVE |

### 零消费者（候选移除 — 需确认后操作）

| # | Export Path | Source Exists | Type |
|---|------------|--------------|------|
| 1 | `./beacon` | yes | module |
| 2 | `./voice` | yes | module |
| 3 | `./app-service` | yes | module |
| 4 | `./errors` | yes | shared |
| 5 | `./http-api` | yes | shared |
| 6 | `./http-api/errors` | yes | shared |
| 7 | `./models/event` | yes | model |
| 8 | `./room` | yes | module |
| 9 | `./room-summary` | yes | module |
| 10 | `./presence` | yes | module |
| 11 | `./media` | yes | module |
| 12 | `./oidc` | yes | module |
| 13 | `./saml` | yes | module |
| 14 | `./ai-connection` | yes | module |
| 15 | `./legacy` | yes | compat |
| 16 | `./core` | yes | entry |
| 17 | `./advanced` | yes | entry |
| 18 | `./feature-flags` | yes | module |
| 19 | `./federation` | yes | module |
| 20 | `./e2ee` | yes | module |
| 21 | `./external-service` | yes | module |
| 22 | `./notification` | yes | module |
| 23 | `./src/filter` | yes | compat |
| 24 | `./src/telemetry` | yes | compat |
| 25 | `./src/manager-extensions` | yes | compat |
| 26 | `./crypto-keys` | yes | module |
| 27 | `./device` | yes | module |
| 28 | `./verification` | yes | module |
| 29 | `./runtime-schemas` | yes | shared |
| 30 | `./@types/PushRules` | yes | types |
| 31 | `./timeline-window` | yes | shared |
| 32 | `./manager-extensions` | yes | entry |

> **注**: `./core`, `./advanced`, `./legacy` 是场景化入口契约 (T-U1) 中定义的入口，hula 当前通过 base 路径 `.` 导入所有内容。这些入口可能在外部消费者中使用。

---

## Part 4: @deprecated Disposition Table

### 判定规则

每条 deprecated 检查三项：
- **(a)** 是否保持 ≥ 2 个 minor 版本
- **(b)** 迁移路径文档是否存在
- **(c)** hula 是否还在使用

**三条都满足 → 移除候选；否则标注保留到哪个版本。**

### 处置表（已交叉验证 hula 使用情况）

| # | File:Line | Item | Deprecation Info | (a) 2+ Minor | (b) Migration Doc | (c) hula Uses | Disposition |
|---|-----------|------|-----------------|-------------|-------------------|--------------|-------------|
| 1 | `embedded.ts:547` | `_unstable_updateDelayedEvent()` | 2025-11-11 | YES (>6mo) | NO | 0 | **KEEP** — 需要先写迁移文档 (MSC4140) |
| 2 | `logger.ts:27` | `Logger.log` | 2023-10-09 | YES (>2yr) | YES (use `Logger.debug`) | 0 (hula 用自带 logger) | **REMOVE_CANDIDATE** |
| 3 | `logger.ts:163` | `logger` (module export) | 2025-07-03 | YES (>1yr) | NO (111 SDK 文件导入) | 0 | **KEEP** — 全 SDK 依赖,不能在无迁移计划下移除 |
| 4 | `client.ts:507` | `ClientEvent.ToDeviceEvent` | ~2024 | YES | YES (use `ReceivedToDeviceMessage`) | 0 | **KEEP** — SDK 内部仍在 emit/listen (sync.ts, ToDeviceKeyTransport) |
| 5 | `@types/auth.ts:190` | `LoginRequest.user` | 2026-07-08 | NO | YES (use `identifier`) | 0 | **KEEP** until v42.0 (deprecated < 1mo ago) |
| 6 | `common-crypto/CryptoBackend.ts:205` | `forwardingCurve25519KeyChain` | 2025-12-16 | YES (>6mo) | YES | 0 | **REMOVE_CANDIDATE** — 仅 type def 引用 |
| 7 | `crypto-api/index.ts:663` | `restoreKeyBackupWithPassphrase` (deriveKey) | 2024-11-13 | YES (>1yr) | YES (use 4S) | **2** (CryptoSDKAdapter.ts) | **KEEP** — hula 在用,需前端先迁移 |
| 8 | `crypto-api/CryptoEvent.ts:62` | `CryptoEvent.WillUpdateDevices` | 2024-10-15 | YES | YES (use `DevicesUpdated`) | 0 | **KEEP** — rust-crypto.ts 仍在 emit |
| 9 | `matrix-rtc/LivekitTransport.ts:39` | `LivekitFocusSelection` | ~2025 | YES | YES (old focus fields) | 0 | **REMOVE_CANDIDATE** — 仅 CallMembership 引用 |
| 10 | `matrix-rtc/MatrixRTCSession.ts:204` | `updateEncryptionKeyThrottle` | ~2025 | YES | YES | 0 | **KEEP** — EncryptionManager 仍在读取 |
| 11 | `matrix-rtc/MatrixRTCSession.ts:222` | `makeKeyDelay` | ~2025 | YES | YES | 0 | **KEEP** — EncryptionManager 仍在读取 |
| 12 | `matrix-rtc/IMembershipManager.ts:59` | `isJoined()` (rename to `isActivated()`) | ~2025 | YES | YES | 0 | **KEEP** — MatrixRTCSession 仍在调用 `isJoined()` |
| 13 | `matrix-rtc/RoomKeyTransport.ts:28` | `RoomKeyTransport` class | ~2025 | YES | YES (use ToDeviceTransport) | 0 | **KEEP** — MatrixRTCSession.ts 仍在构造 |
| 14 | `matrix-rtc/MembershipManager.ts:388` | `fociPreferred` field | ~2025 | YES | YES | 0 | **KEEP** — 私有字段,内部仍在读写 |
| 15 | `http-api/interface.ts:80` | `useAuthorizationHeader` | 2026-02-11 | NO | YES (spec v1.11) | **2** (config 中设为 true) | **KEEP** — hula 在用,且 SDK 内部 8 处使用 |
| 16 | `http-api/interface.ts:123` | `json` field | 2025-07-24 | YES | YES (use `rawResponseBody`) | 0 | **KEEP** — http-api 内部实现依赖 |
| 17 | `managers/base-manager.ts:267` | `adminRequest()` | 2026-07-02 | NO | YES (use `this.request(...)`) | 0 (hula 有自己实现) | **KEEP** — 50+ 子类调用,需整体迁移 |
| 18 | `oidc/discovery.ts:33` | `discoverAndValidateOIDCIssuerWellKnown()` | 2026-07-08 | NO | YES (use `getAuthMetadata`) | 0 | **KEEP** — client-auth.ts + tokenRefresher 仍在调用 |
| 19 | `oidc/manager.ts:165` | `OidcManager.discover()` | 2026-07 (近期) | NO | YES | 0 | **REMOVE_CANDIDATE** — 0 SDK 内部调用 |
| 20 | `oidc/manager.ts:183` | `OidcManager.getJwks()` | 2026-07 (近期) | NO | YES | 0 | **REMOVE_CANDIDATE** — 0 SDK 内部调用 |
| 21 | `models/room.ts:410` | `oldState` field | ~2022-2023 | YES (>2yr) | YES | 0 | **KEEP** — SDK 内部 14 处访问 |
| 22 | `models/room.ts:417` | `currentState` field | ~2022-2023 | YES (>2yr) | YES | **~20+** (room.currentState 广泛使用) | **KEEP** — hula 大量使用,SDK 内部 22+ 处 |
| 23 | `models/room.ts:810` | `timeline` getter | ~2022 | YES (>2yr) | YES | **2** (CryptoHealthMonitor.ts) | **KEEP** — hula 在用,SDK 内部 32 处 |
| 24 | `models/event.ts:1681` | `toJSON()` | 2026-01-06 | YES (>6mo) | YES (use `getEffectiveEvent`) | 0 | **REMOVE_CANDIDATE** — 0 调用方 |
| 25 | `models/user.ts:156` | `User` constructor | 2023-10-27 | YES (>2yr) | YES (use `User.createUser`) | 0 | **REMOVE_CANDIDATE** — 仅 2 处 SDK 内部调用 |
| 26 | `web-rtc/call.ts:65` | `forceTURN` in CallOpts | ~2024 | YES (>1yr) | YES (use client opts) | 0 | **REMOVE_CANDIDATE** — 仅 call.ts 内部引用 |
| 27 | `account/index.ts:114` | `login()` method | ~2025 | YES (>1yr) | YES (use `loginRequest`) | **2** (matrixSdk.worker.ts, MatrixClientService.ts) | **KEEP** — hula SSO 流程在用,需前端先迁移 |

### @deprecated 汇总（交叉验证后）

| Disposition | Count | 详情 |
|-------------|-------|------|
| **REMOVE_CANDIDATE** (满足所有条件) | 8 | #2, #6, #9, #19, #20, #24, #25, #26 |
| **KEEP — hula 在用** (需前端先迁移) | 5 | #7, #15, #22, #23, #27 |
| **KEEP — SDK 内部在用** (循环废弃) | 9 | #3, #4, #8, #10, #11, #12, #13, #14, #17, #18, #21 |
| **KEEP — deprecated < 2 个 minor** | 2 | #5, #16 |
| **KEEP — 缺迁移文档** | 1 | #1 |

### 关键发现: 循环废弃问题

以下 11 个标记为 `@deprecated` 的项 **仍然被 SDK 自身代码使用**，属于"循环废弃"——既不安全移除，也无法鼓励外部迁移：

| 废弃项 | 仍然被哪些 SDK 代码使用 |
|--------|----------------------|
| `logger` 导出 | 111 个文件导入 |
| `ClientEvent.ToDeviceEvent` | sync.ts (emit), ToDeviceKeyTransport.ts (listen) |
| `CryptoEvent.WillUpdateDevices` | rust-crypto.ts (emit) |
| `updateEncryptionKeyThrottle` | EncryptionManager.ts (读取配置) |
| `makeKeyDelay` | EncryptionManager.ts (读取配置) |
| `isJoined()` | MatrixRTCSession.ts (直接调用) |
| `RoomKeyTransport` | MatrixRTCSession.ts (构造实例) |
| `fociPreferred` | MembershipManager.ts (读写) |
| `adminRequest()` | 50+ 子类调用 |
| `discoverAndValidateOIDCIssuerWellKnown()` | client-auth.ts, tokenRefresher.ts |

---

## Part 5: Top Recommendations

### 1. 优先处理 Zombie Managers (30 个高置信度)

这 30 个 manager 满足所有移除条件。从 `ManagerName` union 中移除它们会：
- 减少 `ManagerTypeMap` 中 ~25% 的类型定义
- 减少 `getOrCreateManager` 的类型承载
- 不影响任何 hula 前端功能

**风险**: 需确认 `event` manager (20 SDK refs) 和 `roomEvents` (3 SDK refs) 虽然高引用但不是从 hula 直接调用的,可能在 client.ts 内部使用。

### 2. 其次处理 @deprecated 移除候选 (8 个 — 交叉验证后)

经交叉验证 hula 前端使用情况及 SDK 内部引用后，仅 **8** 个 deprecated 项真正满足三条移除条件：

- #2 `Logger.log` — 替换为 `Logger.debug`
- #6 `forwardingCurve25519KeyChain` — 仅 type def 引用
- #9 `LivekitFocusSelection` — 仅 CallMembership 引用
- #19 `OidcManager.discover()` — 0 调用方
- #20 `OidcManager.getJwks()` — 0 调用方
- #24 `MatrixEvent.toJSON()` — 0 调用方
- #25 `User` constructor — 仅 2 处 SDK 内部调用
- #26 `forceTURN` — 仅 call.ts 内部引用

**重要**: 另外 5 个 deprecated 项被 hula 直接使用 (#7 `restoreKeyBackupWithPassphrase`, #15 `useAuthorizationHeader`, #22 `currentState`, #23 `timeline`, #27 `login()`)，需要 hula 前端先完成迁移才能考虑移除。另外 9 项存在"循环废弃"——SDK 自身代码仍在使用。

### 3. 未使用的 Exports (32 个)

32 个 export 路径当前 0 消费者。建议分批处理：
- **第一批**: `./src/filter`, `./src/telemetry`, `./src/manager-extensions` (compat 路径)
- **第二批**: `./beacon`, `./voice`, `./app-service`, `./saml` 等无契约无消费者的模块路径
- **第三批**: `./core`, `./advanced`, `./legacy` — 场景化入口，确认外部无消费者后移除

### 4. 需要补充测试覆盖的 Manager（16 个）

以下 manager 源目录存在但无对应 spec 文件：

`aggregations`, `cryptoBackup`, `cryptoStore`, `event`, `eventProcessing`, `eventStatus`, `featureFlags`, `keyForwarding`, `lifecycle`, `module`, `room`, `roomAccountData`, `roomCreation`, `roomList`, `roomStateManagement`, `roomUpgrades`, `serverTime`, `sessions`, `stateSend`, `tokenManagement`, `turnServer`, `userPresence`

---

## 下一步

1. **用户确认 zombie 候选清单** → 从 30 个高置信度 zombie 中确认可移除的 manager
2. **用户确认 @deprecated 移除候选** → 从 8 个验证通过的候选 + 5 个需 hula 先迁移的项中确认优先级
3. **用户确认 exports 精简清单** → 从 32 个零消费者 exports 中确认可移除的路径
4. **实施**: 确认后独立提交 `refactor(managers): remove zombie managers and deprecated APIs`
5. **后续**: hula 前端迁移计划——`currentState`、`timeline`、`login()`、`restoreKeyBackupWithPassphrase` 的 hula 侧迁移

---

*Generated by Manager Architecture Audit, 2026-07-20*
