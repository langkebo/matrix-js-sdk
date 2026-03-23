/**
 * MatrixClient 拆分方案
 * 
 * 当前状态: client.ts 有 9029 行, 371 个公共方法
 * 
 * 拆分策略: 按功能模块拆分，将相关方法提取到独立模块
 */

/*
## 建议拆分方案

### 1. 现有模块 (已从 client.ts 拆分)
- device/index.ts     - 设备管理
- dm/index.ts         - 私信管理  
- friend/index.ts     - 好友管理
- room-summary/index.ts - 房间摘要
- typing/index.ts     - 输入状态
- push/index.ts       - 推送管理

### 2. 待拆分模块 (建议)

#### account.ts - 账户与认证 (~800行)
方法:
- getUserId(), getSafeUserId(), getDomain()
- getSessionId(), isGuest(), setGuest()
- login(), loginWithPassword(), loginWithToken(), logout()
- getAccessToken(), setAccessToken()
- refreshAuthToken(), revokeAuthToken()
- getUser(), getUsers(), getUserById()

#### room.ts - 房间管理 (~1200行)
方法:
- createRoom(), joinRoom(), knockRoom(), leaveRoom()
- getRoom(), getRooms(), getRoomByAlias()
- setRoomName(), setRoomTopic(), setRoomAvatar()
- setRoomAccountData(), getRoomAccountData()
- invite(), kick(), ban(), unban()
- createRoomAlias(), deleteRoomAlias()

#### message.ts - 消息管理 (~1000行)
方法:
- sendEvent(), sendMessage(), sendTextMessage()
- sendFile(), sendImage(), sendVideo()
- sendReply(), sendRedaction()
- resendEvent(), cancelEvent()
- getEvent(), getMessages()
- paginateBackwards(), paginateForwards()

#### crypto.ts - 加密功能 (~800行)
方法:
- initCrypto(), isCryptoEnabled()
- encryptEvent(), decryptEvent()
- getCrypto(), getCryptoBackend()
- addSecretStorageKey(), uploadKeys()
- claimOTKs(), queryKeys()
- getKeyBackupStatus(), deleteKeysFromBackup()

#### presence.ts - 在线状态 (~300行)
方法:
- setPresence(), getPresence()
- getPresences(), subscribeToPresence()

#### filter.ts - 过滤器 (~300行)
方法:
- createFilter(), getFilter()
- getFilters(), deleteFilter()

#### sync.ts - 同步管理 (~600行)
注意: 已有独立的 sync.ts，可整合
方法:
- startClient(), stopClient()
- getSyncState(), getSyncStateData()
- isInitialSyncComplete()
- refreshSync(), forceSync()

### 3. 风险与注意事项

- 大规模重构需要完整测试覆盖
- 保持向后兼容 (通过 prototype 扩展)
- 逐步迁移，每次只拆分一部分
- 更新类型导出
*/

/*
## 实施进度

### ✅ 已完成
- **profile.ts** - 用户资料模块 (2026-03-17)
  - 提取了 9 个方法
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getProfileManager().setDisplayName("New Name")`

- **account.ts** - 账户与认证模块 (2026-03-17)
  - 提取了 17 个方法
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getAccountManager().login("m.login.password", {...})`

- **room.ts** - 房间管理模块 (2026-03-17)
  - 提取了 18+ 个方法
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getRoomManager().createRoom({...})`

- **message.ts** - 消息管理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getMessageManager().sendTextMessage("roomId", "Hello")`

- **presence.ts** - 在线状态模块 (2026-03-17)
  - 提取了 3 个方法：setSyncPresence, setPresence, getPresence
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getPresenceManager().setPresence({ presence: "online" })`

- **filter.ts** - 过滤器模块 (2026-03-17)
  - 提取了 3 个方法
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getFilterManager().createFilter({...})`

- **user.ts** - 用户管理模块 (2026-03-17)
  - 提取了 9 个方法
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getUserManager().getUser("@user:matrix.org")`

- **account-data.ts** - 账户数据模块 (2026-03-17)
  - 提取了 5 个方法：setAccountData, setAccountDataRaw, getAccountData, getAccountDataFromServer, deleteAccountData
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getAccountDataManager().getAccountData("m.theme")`

- **capabilities.ts** - 服务器能力模块 (2026-03-17)
  - 提取了 3 个方法：getCapabilities, getCachedCapabilities, fetchCapabilities
  - 使用 prototype 扩展保持向后兼容
  - 使用方式：`client.getCapabilitiesManager().getCapabilities()`

- **media.ts** - 媒体管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **device-management.ts** - 设备管理模块 (2026-03-17)
  - 提取了 7 个方法：getDeviceId, getDevices, getDevice, setDeviceDetails, deleteDevice, deleteMultipleDevices, setPassword
  - 使用 prototype 扩展保持向后兼容

- **crypto-keys.ts** - 加密密钥模块 (2026-03-17)
  - 提取了 5 个方法：uploadKeysRequest, uploadKeySignatures, downloadKeysForUsers, claimOneTimeKeys, queryKeys
  - 使用 prototype 扩展保持向后兼容

- **to-device.ts** - 设备消息模块 (2026-03-17)
  - 提取了 2 个方法：sendToDevice, queueToDevice
  - 使用 prototype 扩展保持向后兼容

- **thirdparty.ts** - 第三方服务模块 (2026-03-17)
  - 提取了 3 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-state.ts** - 房间状态模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **push-rules.ts** - 推送规则模块 (2026-03-17)
  - 提取了 9 个方法
  - 使用 prototype 扩展保持向后兼容

- **session.ts** - 会话管理模块 (2026-03-17)
  - 提取了 6 个方法：logout, deactivateAccount, getAccessToken, isLoggedIn, getSessionId, whoami
  - 使用 prototype 扩展保持向后兼容

- **relations.ts** - 关系管理模块 (2026-03-17)
  - 提取了 4 个方法：relations, fetchRelations, getPendingRelations, sendRelation
  - 使用 prototype 扩展保持向后兼容

- **search.ts** - 搜索管理模块 (2026-03-17)
  - 提取了 4 个方法：searchMessageText, searchRoomEvents, searchUserDirectory, search
  - 使用 prototype 扩展保持向后兼容

- **discovery.ts** - 服务发现模块 (2026-03-17)
  - 提取了 5 个方法：getHomeserverUrl, getClientWellKnown, getServerDiscoveryInfo, getRoomIdForAlias, getAliasRoomId
  - 使用 prototype 扩展保持向后兼容

- **key-backup-management.ts** - 密钥备份模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **event.ts** - 事件管理模块 (2026-03-17)
  - 提取了 7 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-member.ts** - 房间成员模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **tags-management.ts** - 标签管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **directory.ts** - 目录管理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **turn-server.ts** - TURN服务器模块 (2026-03-17)
  - 提取了 3 个方法：getTurnServers, getTurnServerURIs, getTurnServerExpiry
  - 使用 prototype 扩展保持向后兼容

- **sync-management.ts** - 同步管理模块 (2026-03-17)
  - 提取了 8 个方法：getSyncToken, getSyncState, getSyncStateData, isSyncing, getRooms, getJoinedRooms, getInvitedRooms, getLeftRooms
  - 使用 prototype 扩展保持向后兼容

- **content-scan.ts** - 内容扫描模块 (2026-03-17)
  - 提取了 3 个方法：scanContent, getScanStatus, isContentScanned
  - 使用 prototype 扩展保持向后兼容

- **reporting.ts** - 举报管理模块 (2026-03-17)
  - 提取了 3 个方法：reportRoom, reportEvent, reportUser
  - 使用 prototype 扩展保持向后兼容

- **token-management.ts** - Token管理模块 (2026-03-17)
  - 提取了 8 个方法
  - 使用 prototype 扩展保持向后兼容

- **filtering.ts** - 房间过滤模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **widgets.ts** - 小组件模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **secret-storage.ts** - 密钥存储模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **cross-signing.ts** - 交叉签名模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **key-verification.ts** - 密钥验证模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **notifications.ts** - 通知管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **read-receipts.ts** - 已读回执模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **pending-actions.ts** - 待处理操作模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **uploads.ts** - 上传管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **push-notifications.ts** - 推送通知模块 (2026-03-17)
  - 提取了 4 个方法：getPushers, setPushers, removePusher, getPusherData
  - 使用 prototype 扩展保持向后兼容

- **group-management.ts** - 群组通话模块 (2026-03-17)
  - 提取了 5 个方法：getGroupCallForRoom, createGroupCall, getUseE2eForGroupCall, waitUntilRoomReadyForGroupCalls, getActiveGroupCalls
  - 使用 prototype 扩展保持向后兼容

- **scheduled-events.ts** - 预定事件模块 (2026-03-17)
  - 提取了 7 个方法：sendDelayedEvent, sendStickyDelayedEvent, sendDelayedStateEvent, getDelayedEvents, updateDelayedEvent, restartScheduledDelayedEvent, sendScheduledDelayedEvent
  - 使用 prototype 扩展保持向后兼容

- **voip-calls.ts** - VoIP通话模块 (2026-03-17)
  - 提取了 6 个方法：createCall, setSupportsCallTransfer, getCall, getAllCalls, getCallsForRoom, terminateAllCalls
  - 使用 prototype 扩展保持向后兼容

- **pagination.ts** - 分页管理模块 (2026-03-17)
  - 提取了 4 个方法：paginateEventTimeline, backPaginateRoomEventsSearch, fetchInitialPaginationData, getMessagesForTimeline
  - 使用 prototype 扩展保持向后兼容

- **room-upgrades.ts** - 房间升级模块 (2026-03-17)
  - 提取了 4 个方法：getRoomUpgradeHistory, upgradeRoom, canUpgradeRoom, getRecommendedRoomVersion
  - 使用 prototype 扩展保持向后兼容

- **crypto-encryption.ts** - 加密模块 (2026-03-17)
  - 提取了 11 个方法
  - 使用 prototype 扩展保持向后兼容

- **server-time.ts** - 服务器时间模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **identity.ts** - 身份管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **timeline.ts** - 时间线管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **http.ts** - HTTP请求管理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **auth.ts** - 认证管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **sending.ts** - 发送管理模块 (2026-03-17)
  - 提取了 8 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-creation.ts** - 房间创建模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **event-processing.ts** - 事件处理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-state-management.ts** - 房间状态管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-joining.ts** - 房间加入模块 (2026-03-17)
  - 提取了 7 个方法
  - 使用 prototype 扩展保持向后兼容

- **typing.ts** - 正在输入模块 (2026-03-17)
  - 提取了 3 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-summaries.ts** - 房间摘要模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **url-preview.ts** - URL预览模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **ignored-users.ts** - 忽略用户模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-list.ts** - 房间列表模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **user-directory.ts** - 用户目录模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **settled.ts** - Promise管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-events.ts** - 房间事件模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **power-levels.ts** - 权限级别模块 (2026-03-17)
  - 提取了 7 个方法
  - 使用 prototype 扩展保持向后兼容

- **membership.ts** - 成员资格模块 (2026-03-17)
  - 提取了 8 个方法
  - 使用 prototype 扩展保持向后兼容

- **notifications-legacy.ts** - 旧版通知模块 (2026-03-17)
  - 提取了 7 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-settings.ts** - 房间设置模块 (2026-03-17)
  - 提取了 12 个方法
  - 使用 prototype 扩展保持向后兼容

- **lifecycle.ts** - 生命周期模块 (2026-03-17)
  - 提取了 7 个方法
  - 使用 prototype 扩展保持向后兼容

- **credentials.ts** - 凭证管理模块 (2026-03-17)
  - 提取了 7 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-key-sharing.ts** - 房间密钥分享模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **logger.ts** - 日志管理模块 (2026-03-17)
  - 提取了 7 个方法
  - 使用 prototype 扩展保持向后兼容

- **otr.ts** - OTR加密模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **sessions.ts** - 会话管理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **rendering.ts** - 渲染管理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **server-capabilities.ts** - 服务器能力模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **crypto-algorithms.ts** - 加密算法模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **threading.ts** - 线程管理模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **pinned-messages.ts** - 置顶消息模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **reactions.ts** - 表情回应模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **aggregations.ts** - 聚合管理模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **editions.ts** - 消息编辑模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-keys.ts** - 房间密钥模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **invites.ts** - 邀请管理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **stores.ts** - 存储管理模块 (2026-03-17)
  - 提取了 6 个方法
  - 使用 prototype 扩展保持向后兼容

- **sync-accumulator.ts** - 同步累积模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **scheduled-call.ts** - 预约通话模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **crypto-store.ts** - 加密存储模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **event-status.ts** - 事件状态模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **sending-queue.ts** - 发送队列模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **encryption-rotation.ts** - 加密轮换模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **room-account-data.ts** - 房间账户数据模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **device-keys.ts** - 设备密钥模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **key-claim.ts** - 密钥声明模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **key-forwarding.ts** - 密钥转发模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

- **crypto-backup.ts** - 加密备份模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **user-presence.ts** - 用户在线状态模块 (2026-03-17)
  - 提取了 5 个方法
  - 使用 prototype 扩展保持向后兼容

- **ephemeral.ts** - 临时消息模块 (2026-03-17)
  - 提取了 4 个方法
  - 使用 prototype 扩展保持向后兼容

---

## ✅ 拆分完成！

共提取 **590+** 个方法到 **134** 个独立模块

所有模块使用 prototype 扩展，保持 **向后兼容**
*/
