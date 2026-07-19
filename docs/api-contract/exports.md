# SDK exports inventory

This document is the canonical inventory of `package.json#exports` subpaths. It is used by CI to ensure the exported surface matches the documented contract.

## Exports

| Export                     | Whitelist Scope (Managers/Types)                                | Key Exports (quality:exports)                                                              |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `.`                        | 主入口白名单：`matrix` 聚合 API（客户端创建、主客户端类型）     | `createClient`, `createRoomWidgetClient`, `MatrixClient`                                   |
| `./core`                   | Core 白名单：基础客户端能力 + HTTP/API 类型 + 核心模型类型      | `createClient`, `MatrixClient`, `ClientEvent`                                              |
| `./advanced`               | Advanced 白名单：manager 扩展能力（admin/dm/friend/push/space） | `AdminManager`, `DirectMessageManager`, `SpaceManager`                                     |
| `./legacy`                 | Legacy 白名单：filter 历史兼容类型与别名                        | `FilterManager`                                                                            |
| `./manager-extensions`     | Manager Extensions 白名单：管理器扩展生命周期                   | `extendMatrixClientWithManagers`                                                           |
| `./admin`                  | Admin 白名单：管理端 manager 与领域类型                         | `AdminManager`, `UserInfo`, `RoomInfo`                                                     |
| `./ai-connection`          | AI Connection 白名单：AI 连接 manager 与连接类型                | `AIConnectionEvent`, `AIConnection`                                                        |
| `./app-service`            | App Service 白名单：应用服务 manager 与服务类型                 | `AppServiceEvent`, `ApplicationService`                                                    |
| `./beacon`                 | Beacon 白名单：beacon manager 能力                              | `BeaconManager`, `extendMatrixClient`                                                      |
| `./cache`                  | Cache 白名单：缓存工具入口（当前仅校验子路径存在）              | `-`                                                                                        |
| `./client`                 | Client 白名单：`MatrixClient` 主类型与客户端事件/选项           | `MatrixClient`, `ClientEvent`, `ICreateClientOpts`                                         |
| `./crypto`                 | Crypto 白名单：Rust Crypto API 与解密/隔离相关类型              | `CryptoApi`, `DecryptionFailureCode`, `DeviceIsolationModeKind`                            |
| `./crypto-keys`            | Crypto Keys 白名单：设备密钥 manager 与密钥上传/查询/声明类型   | `CryptoKeysManager`, `IDeviceKeys`, `IKeysUploadRequest`                                   |
| `./device`                 | Device 白名单：设备管理 manager 与设备类型                      | `DeviceManager`, `DeviceEvent`, `IDevice`                                                  |
| `./device-keys`            | Device Keys 白名单：设备密钥类型                                | `DeviceKeys`, `OneTimeKeys`                                                                |
| `./dm`                     | DM 白名单：直聊 manager 与直聊领域类型                          | `DirectMessageManager`, `DMEvent`, `DmRoomInfo`                                            |
| `./e2ee`                   | E2EE 白名单：端到端加密 manager 与加密领域类型                  | `E2EEManager`                                                                              |
| `./errors`                 | Error 白名单：SDK 统一错误体系类型                              | `SdkError`, `AuthError`, `RetryableError`                                                  |
| `./event-report`           | Event Report 白名单：事件举报类型                               | `ReportStatus`                                                                             |
| `./external-service`       | External Service 白名单：外部服务 manager 与服务类型            | `ExternalServiceManager`                                                                   |
| `./feature-flags`          | Feature Flags 白名单：特性开关 manager 与开关类型               | `FeatureFlagManager`                                                                       |
| `./federation`             | Federation 白名单：联邦 manager 与联邦服务器类型                | `FederationManager`, `FederationEvent`                                                     |
| `./friend`                 | Friend 白名单：好友 manager 与好友领域类型                      | `FriendManager`, `FriendEvent`, `Friend`                                                   |
| `./guest`                  | Guest 白名单：访客 manager 与访客类型                           | `GuestManager`, `GuestEvent`                                                               |
| `./http-api`               | HTTP 白名单：HTTP API 基础能力与错误类型                        | `MatrixHttpApi`, `HTTPError`, `MatrixError`                                                |
| `./http-api/errors`        | HTTP 错误白名单：传输层/协议层错误类型                          | `HTTPError`, `MatrixError`, `ConnectionError`                                              |
| `./key-backup`             | Key Backup 白名单：密钥备份类型                                 | `EncryptedData`, `BackupVersion`                                                           |
| `./key-verification`       | Key Verification 白名单：密钥验证 manager 与验证类型            | `KeyVerificationManager`                                                                   |
| `./media`                  | Media 白名单：媒体 manager 与媒体类型                           | `MediaManager`                                                                             |
| `./models`                 | Models 白名单：模型聚合入口（当前仅校验子路径存在）             | `-`                                                                                        |
| `./models/event`           | Event 模型白名单：事件实体与状态相关类型                        | `EventStatus`, `IEvent`, `IContent`                                                        |
| `./models/room`            | Room 模型白名单：房间实体与状态/计数相关类型                    | `RoomEvent`, `NotificationCountType`, `KNOWN_SAFE_ROOM_VERSION`                            |
| `./models/room-state`      | Room State 模型白名单：房间状态相关类型                         | `RoomStateEvent`                                                                           |
| `./notification`           | Notification 白名单：通知入口（当前仅校验子路径存在）           | `-`                                                                                        |
| `./oidc`                   | OIDC 白名单：OIDC 认证 manager 与认证类型                       | `OidcManager`                                                                              |
| `./presence`               | Presence 白名单：在线状态 manager 与状态类型                    | `PresenceManager`, `PresenceEvent`                                                         |
| `./push`                   | Push 白名单：推送 manager 与规则/通知类型                       | `PushManager`, `PushEvent`, `IPushRules`                                                   |
| `./room`                   | Room 白名单：房间 manager 与房间领域类型                        | `RoomManager`                                                                              |
| `./room-summary`           | Room Summary 白名单：房间摘要 manager 与摘要领域类型            | `RoomSummaryManager`, `RoomSummaryEvent`                                                   |
| `./runtime-schemas`        | Runtime Schemas 白名单：运行时 zod schema 与快照解析能力        | `matrixEventWireSchema`, `parseMatrixEventWire`, `createMatrixClientSnapshot`              |
| `./saml`                   | SAML 白名单：SAML 认证 manager 与认证类型                       | `SamlAuthManager`                                                                          |
| `./space`                  | Space 白名单：空间 manager 与空间层级类型                       | `SpaceManager`, `SpaceEvent`, `SpaceHierarchy`                                             |
| `./store`                  | Store 白名单：存储接口能力                                      | `IStore`, `ISavedSync`, `UserCreator`                                                      |
| `./store/worker`           | Store Worker 白名单：IndexedDB Worker 存储                      | `IndexedDBStoreWorker`                                                                     |
| `./sync`                   | Sync 白名单：同步入口                                           | `SyncApi`                                                                                  |
| `./telemetry`              | Telemetry 白名单：遥测管理入口                                  | `TelemetryManager`                                                                         |
| `./timeline-window`        | Timeline 白名单：timeline 窗口能力                              | `TimelineWindow`, `TimelineIndex`                                                          |
| `./verification`           | Verification 白名单：密钥验证 manager 与验证类型                | `VerificationManager`                                                                      |
| `./voice`                  | Voice 白名单：语音消息 manager 与语音领域类型                   | `VoiceManager`, `VoiceEvent`, `IVoiceMessage`                                              |
| `./webrtc`                 | WebRTC 白名单：通话入口（当前仅校验子路径存在）                 | `-`                                                                                        |
| `./@types/partials`        | 类型白名单：协议 partial/type 枚举集合                          | `Visibility`, `Preset`, `JoinRule`                                                         |
| `./@types/PushRules`       | 类型白名单：push rules 枚举与动作类型                           | `PushRuleActionName`, `TweakName`, `PushRuleAction`                                        |
| `./src/filter`             | 兼容白名单：filter 权威实现入口                                 | `FilterManager`                                                                            |
| `./src/manager-extensions` | 兼容白名单：manager 扩展初始化生命周期                          | `extendMatrixClientWithManagers`, `onManagerExtensionsLifecycle`, `resetManagerExtensions` |
| `./src/telemetry`          | 兼容白名单：遥测 manager 与遥测类型                             | `TelemetryManager`, `TelemetryEvent`, `TelemetryConfig`                                    |

## 场景化入口契约（T-U1）

| 新用户接入场景             | 推荐主入口               | 说明                                                          |
| -------------------------- | ------------------------ | ------------------------------------------------------------- |
| 标准客户端能力             | `matrix-js-sdk/core`     | 默认入口，覆盖 `createClient`、核心模型、HTTP/API 错误类型    |
| 功能增强（admin/dm/space） | `matrix-js-sdk/advanced` | 在 core 基础上显式启用 manager 扩展能力                       |
| 历史兼容迁移               | `matrix-js-sdk/legacy`   | 仅用于 `LegacyFilterManager` 等兼容别名；不作为新功能默认入口 |

- 新用户接入路径收敛目标：最多 3 条（`core` / `advanced` / `legacy`）。
- 迁移期校验命令：`pnpm quality:contracts`（确保 `package.json#exports` 与本清单一致）。

### 模块级迁移示例

| 模块场景               | 迁移前入口                                                          | 迁移后推荐入口           |
| ---------------------- | ------------------------------------------------------------------- | ------------------------ |
| 客户端初始化与事件订阅 | `matrix-js-sdk`                                                     | `matrix-js-sdk/core`     |
| 直聊/好友/空间管理     | `matrix-js-sdk/dm` / `matrix-js-sdk/friend` / `matrix-js-sdk/space` | `matrix-js-sdk/advanced` |
| 管理端用户/房间治理    | `matrix-js-sdk/admin`                                               | `matrix-js-sdk/advanced` |
| 历史 Filter 兼容能力   | `matrix-js-sdk/src/filter-manager`                                  | `matrix-js-sdk/legacy`   |
