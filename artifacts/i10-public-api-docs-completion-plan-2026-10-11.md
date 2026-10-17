# I-10 公共 API 文档长期补全计划（2026-10-11）

> 配套：问题主清单 [remaining-issues-and-optimization-plan-2026-10-08.md](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/artifacts/remaining-issues-and-optimization-plan-2026-10-08.md)（§11.6）、修复报告 [sdk-issue-fix-report-2026-10-11.md](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/artifacts/sdk-issue-fix-report-2026-10-11.md)（§5）、复审源 [sdk-comprehensive-review-2026-10-11.md](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/artifacts/sdk-comprehensive-review-2026-10-11.md)（P1-5）。
> 门禁：[check-public-api-docs.mjs](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/scripts/quality/check-public-api-docs.mjs)　台账：[public-api-docs-ledger.json](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/scripts/quality/public-api-docs-ledger.json)

## 1. 现状与终点

**门禁口径**（`schemaVersion=3`）：`package.json` exports **可达**（52 个入口 / 488 个文件）中的 `*Manager` 与 `MatrixClient` 公开方法；三条缺口指标相互独立，规则 R0~R4。

**实测现状**（`capturedAt=2026-10-11`，本计划全部数字取自台账，非估算；下表为 **Epic（`MatrixClient`）完成后**的最新值，即 M5 终点）：

| 指标               | 当前值  | 含义                                     |
| ------------------ | ------- | ---------------------------------------- |
| 纳入类数           | **143** | **143 个全部全绿**（三指标均 0）         |
| `missingJsDoc`     | **0**   | 公开方法无 JSDoc 块                      |
| `missingExample`   | **0**   | 有 JSDoc 但无 `@example`                 |
| `throwsWithoutTag` | **0**   | 有 JSDoc、体内有 `throw`、却无 `@throws` |
| **残差合计**       | **0**   | 三指标之和（同一方法最多计 2 次）        |

> 进度：W0 达成后为 1135 / 713 / 210（残差 2058）；**W1 社交域完成后**降至 1053 / 662 / 186（残差 1901），净降 J −82 / E −51 / T −24；**W2 Admin 子管理器群完成后**进一步降至 984 / 561 / 151（残差 1696），净降 J −69 / E −101 / T −35；**W3 Room 域完成后**降至 787 / 472 / 127（残差 1386），净降 J −197 / E −89 / T −24，三波累计净降 672（32.6%）；**W4 Crypto / Identity 完成后**降至 656 / 392 / 111（残差 1159），净降 J −131 / E −80 / T −16，四波累计净降 899（43.7%）；**W5 Push / Widget / Voice / RTC / Worker 完成后**降至 611 / 307 / 43（残差 961），净降 J −45 / E −85 / T −68，五波累计净降 1097（53.3%）；**W6 Space / Federation 完成后**降至 578 / 284 / 30（残差 892），净降 J −33 / E −23 / T −13，六波累计净降 1166（56.7%）；**W7a 长尾头部完成后**降至 397 / 192 / 11（残差 600），净降 J −181 / E −92 / T −19，七波累计净降 1458（70.8%）；**W7b 长尾尾部完成后**降至 204 / 88 / 1（残差 293，仅余 `MatrixClient`），净降 J −193 / E −104 / T −10，八波累计净降 1854（90.1%），与 §4 出口判据逐项一致；**Epic `MatrixClient` 本体完成后**降至 0 / 0 / 0（残差 0），净降 J −204 / E −88 / T −1，九波累计净降 2058（100%），达成 M5 = 143 类全域归零，门禁由「棘轮」升级为「纯守门」。

**终点**：143 个类三指标全部归 0 ⇒ 台账整表回落至 0 ⇒ 门禁从「棘轮」升级为「纯守门」。

**已全绿的 143 个类**：W0 示范批次 `TagManager` / `EphemeralManager` / `BackgroundUpdateManager` / `GuestManager` + 既有 `AdminCleanupManager` / `AdminPolicyManager` / `SpaceChildManager` / `SpaceLifecycleManager` / `DmRoomOperationManager`；**W1 社交域** `FriendManager` / `FriendListManager` / `FriendRequestManager` / `FriendBlockManager` / `DirectMessageManager` / `DmRoomListManager` / `DmRoomCreationManager` / `InvitesManager` / `InviteBlocklistManager`；**W2 Admin 子管理器群** `AdminUserManager` / `AdminRoomManager` / `AdminServerManager` / `AdminConfigManager` / `AdminFederationManager` / `AdminMediaManager` / `AdminExternalServiceManager` / `AdminNotificationManager` / `AdminReportManager` / `AdminManager`；**W3 Room 域** `RoomManager` / `RoomSummaryManager` / `RoomSummaryEventOperationManager` / `RoomAliasManager` / `RoomSettingsManager` / `RoomEventsManager` / `RoomSummarySearchManager` / `RoomSummaryMemberManager` / `RoomStateManager` / `RoomKeysManager` / `RoomListManager` / `RoomMemberManager` / `RoomSummaryThreadManager` / `RoomSummaryKeyManager` / `RoomSummaryStatsManager` / `RoomCreationManager` / `RoomSummaryStateManager`；**W4 Crypto / Identity** `KeyBackupManager` / `DehydratedDeviceManager` / `E2EEManager` / `RustBackupManager` / `DeviceManager` / `DeviceKeysManager` / `SamlAuthManager` / `IdentityServerManager` / `OidcManager` / `CryptoKeysManager` / `SecureBackupManager` / `SecretStorageManager` / `CrossSigningManager` / `IdentityManager` / `ThreePidsManager` / `KeyRotationManager` / `KeyClaimManager` / `CryptoStoreManager` / `EncryptionManager`；**W5 Push / Widget / Voice / RTC / Worker** `PushManager` / `WidgetManager` / `VoiceManager` / `WorkerAdminManager` / `WorkerBodyManager` / `WorkerManager` / `NotificationsManager` / `FeatureFlagManager` / `PushRulesManager` / `ModerationManager` / `TurnServerManager` / `MatrixRTCSessionManager` / `RTCEncryptionManager`；**W6 Space / Federation** `SpaceManager` / `SpaceHierarchyManager` / `SpaceQueryManager` / `SpaceMemberManager` / `FederationManager` / `FederationQueryManager` / `FederationRoomManager` / `FederationServerManager` / `FederationBlacklistManager`（`SpaceChildManager` / `SpaceLifecycleManager` 已于 W0 批次清零）；**W7a 长尾头部** `ThreadManager` / `BurnAfterReadManager` / `TelemetryManager` / `ThreadingManager` / `ApplicationServiceManager` / `AuthManager` / `DiscoveryManager` / `ModuleManager` / `AccountManager` / `MediaManager` / `PresenceManager` / `ProfileManager`；**W7b 长尾尾部** `BeaconManager` / `CasManager` / `EventReportManager` / `ExternalServiceManager` / `FilterManager` / `PinnedMessagesManager` / `SearchManager` / `ServerTimeManager` / `ToDeviceManager` / `CapabilitiesManager` / `DelayedEventsManager` / `DirectoryManager` / `MembershipManager`（`membership` 与 `matrix-rtc` 两个同名类共享一份台账项）/ `ReadReceiptsManager` / `SecurityManager` / `SessionManager` / `StateSendManager` / `SyncManager` / `TimelineManager` / `AccountDataManager` / `AccountStatusManager` / `CaptchaManager` / `LifecycleManager` / `UnifiedCacheManager` / `ReactionsManager` / `ReportingManager` / `SendingManager` / `SyncAccumulatorManager` / `PushNotificationsManager` / `ServerCapabilitiesManager` / `TagsManager` / `ThirdPartyManager` / `TypingManager` / `UploadsManager` / `UserManager` / `AggregationsManager` / `EventManager` / `BaseManager` / `PasswordResetManager` / `RelationsManager` / `RendezvousManager` / `RetentionManager` / `OutgoingRequestsManager` / `UserDirectoryManager`（共 44 类）；**Epic `MatrixClient` 本体**（单类，残 293，为本计划体量最大的对象）。

## 2. 关键机制：怎么补才算「真正降棘轮」

**平移陷阱**（本批踩过）：`analyzeSourceFile()` 对「无 JSDoc」**只计 `missingJsDoc` 并 `continue`**；对「有 JSDoc 但无 `@example`」**计入 `missingExample`**。所以：

- 只补 JSDoc ⟶ `missingJsDoc` −N、`missingExample` **+N** —— 总量不降，且触发 **R2 违规**（`missingExample` 恶化）。
- 要净降，**每个方法必须 JSDoc + `@example` 同补**；若方法体内有 `throw`（`bodyThrows()` 静态扫描，不深入嵌套），还须补 `@throws`。

**标准工作单元** = 一个公开方法的「完整文档三件套」：

```ts
/**
 * <一句话职责>。
 *
 * @param x - 参数说明
 * @returns <返回说明>
 * @throws {ValidationError} <触发条件>   // 仅当方法体内有 throw
 * @example
 * const r = await client.getXxxManager().method(...);
 */
```

**台账下调命令**（唯一合法路径）：

```bash
node scripts/quality/check-public-api-docs.mjs --write-ledger   # 只在无恶化时写入，恶化则拒写
```

**生成某域的机器待补清单**：

```bash
node scripts/quality/check-public-api-docs.mjs --emit-plan artifacts/_wip-i10-plan.md
```

## 3. 分批策略

**排序原则**：`优先级 = 残差 × 下游影响`。先啃「下游 Tjg 高频 / 类群成片」的域——同一域内的访问器、DTO 风格一致，补起来边际成本最低；`MatrixClient` 因体量最大（293）且含大量委托方法，单列为 epic，可按方法族拆分并与各波次并行。

**域聚类残差分布**（按类名前缀聚类，实测）：

| 波次 | 域                                   | 类数 | 残差     | 占比  | 其中 `@example` | 其中 `@throws` |
| ---- | ------------------------------------ | ---- | -------- | ----- | --------------- | -------------- |
| W0   | 示范批次（**已完成**）               | 4    | 67       | —     | 67              | 7              |
| W1   | 社交 Friend / DM / Invite            | 10   | 157      | 7.6%  | 51              | 24             |
| W2   | Admin 子管理器群                     | 12   | 205      | 10.0% | 101             | 35             |
| W3   | Room 域                              | 17   | 310      | 15.1% | 89              | 24             |
| W4   | Crypto / Identity                    | 21   | 238      | 11.6% | 87              | 17             |
| W5   | Push / Widget / Voice / RTC / Worker | 13   | 197      | 9.6%  | 84              | 68             |
| W6   | Space / Federation                   | 11   | 69       | 3.4%  | 23              | 13             |
| W7a  | 长尾头部（Top-12 单类）              | 12   | 292      | 14.2% | —               | —              |
| W7b  | 长尾尾部                             | 46   | 297      | 14.4% | —               | —              |
| Epic | **MatrixClient 本体**                | 1    | 293      | 14.2% | 88              | 1              |
| —    | 合计                                 | 143  | **2058** | 100%  | 713             | 210            |

**头部集中度**（决定投入产出）：残差 Top-10 类占 **35.8%**、Top-20 占 **50.0%**、Top-30 占 **60.6%**、Top-50 占 **75.5%**。即**先清 50 个类即可解决约四分之三**。

## 4. 波次明细

### W0 示范批次（已完成，2026-10-11）

`TagManager`(20) + `EphemeralManager`(13) + `BackgroundUpdateManager`(19) + `GuestManager`(15) = **67 方法**。`missingJsDoc` 1202 → 1135。作为后续批次的范式模板。

### W1 社交域：Friend / DM / Invite（残 157）

| 类                       | J   | E   | T   |
| ------------------------ | --- | --- | --- |
| `FriendManager`          | 44  | 0   | 0   |
| `FriendListManager`      | 31  | 0   | 0   |
| `DmRoomListManager`      | 0   | 18  | 11  |
| `InviteBlocklistManager` | 0   | 15  | 5   |
| `FriendRequestManager`   | 0   | 9   | 3   |
| `DmRoomCreationManager`  | 1   | 4   | 4   |
| `FriendBlockManager`     | 0   | 2   | 1   |
| `InvitesManager`         | 6   | 0   | 0   |
| `DirectMessageManager`   | 0   | 3   | 0   |
| `DmRoomOperationManager` | 0   | 0   | 0   |

出口判据：10 类全部归 0；`missingJsDoc` −82、`missingExample` −51、`throwsWithoutTag` −24。

交付结果（2026-10-11）：10 类三指标全部归 0；全局 1135/713/210 → **1053/662/186**（残差 1901），净降与出口判据逐项一致。门禁 / `tsc` / 相关单测 / eslint 全绿。

### W2 Admin 子管理器群（残 205）

`AdminUserManager`(18/17/6) · `AdminRoomManager`(28/7/3) · `AdminServerManager`(0/29/9) · `AdminConfigManager`(23/4/4) · `AdminFederationManager`(0/20/7) · `AdminMediaManager`(0/7/5) · `AdminExternalServiceManager`(0/7/1) · `AdminNotificationManager`(0/4/0) · `AdminReportManager`(0/5/0) · `AdminManager`(0/1/0) · 及 `AdminCleanupManager` / `AdminPolicyManager`（已绿，仅需纳入回归）。

出口判据：12 类归 0；`missingJsDoc` −69、`missingExample` −101、`throwsWithoutTag` −35。

交付结果（2026-10-11）：12 类（10 个缺口类 + `AdminCleanupManager` / `AdminPolicyManager` 回归）三指标全部归 0；全局 1053/662/186 → **984/561/151**（残差 1696），净降与出口判据逐项一致。门禁 / `tsc` / 相关单测（259 例）/ eslint 全绿。

### W3 Room 域（残 310）

`RoomSummaryManager`(80/4/1) · `RoomManager`(49/12/1) · `RoomSummaryEventOperationManager`(1/41/11) · `RoomAliasManager`(15/4/2) · `RoomEventsManager`(9/0/0) · `RoomSettingsManager`(12/0/0) · `RoomListManager`(7/0/0) · `RoomStateManager`(7/0/0) · `RoomMemberManager`(6/1/0) · `RoomKeysManager`(2/3/2) · `RoomSummary*Manager`（Member/Search/Stats/Thread/Key/State）· `RoomCreationManager`(4/0/0)。

出口判据：17 类归 0；本域是**残差最大单域**，建议排在 Admin 之后、Crypto 之前。

交付结果（2026-10-11）：17 类三指标全部归 0；全局 984/561/151 → **787/472/127**（残差 1386），净降 J −197 / E −89 / T −24，与出口判据逐项一致。门禁 / `tsc` / 相关单测（15 文件 419 例）/ eslint / `pnpm lint` / audit-doc 哨兵全绿。

### W4 Crypto / Identity（残 238）

`KeyBackupManager`(26/3/2) · `DehydratedDeviceManager`(9/9/3) · `E2EEManager`(16/4/0) · `RustBackupManager`(1/17/2) · `DeviceManager`(9/5/3) · `DeviceKeysManager`(3/12/0) · `SamlAuthManager`(16/3/0) · `IdentityServerManager`(2/12/1) · `OidcManager`(12/1/0) · `CryptoKeysManager`(10/1/1) · `SecureBackupManager`(2/3/3) · `SecretStorageManager`(0/6/0) · `CrossSigningManager`(5/0/0) · `IdentityManager`(5/0/0) · `ThreePidsManager`(5/0/0) · `RoomKeysManager`（若 W3 未并）· `KeyRotationManager` · `KeyClaimManager` · `CryptoStoreManager` · `EncryptionManager`。

出口判据：21 类归 0。**注意**：本域方法例应贴合真实调用（`initRustCrypto()` 已初始化后再调），不要伪造 `@example`。

交付结果（2026-10-11）：实际纳入口径 **19 类**（`RoomKeysManager` 已在 W3 清账，不重复计入）三指标全部归 0；全局 787/472/127 → **656/392/111**（残差 1159），净降 J −131 / E −80 / T −16，与出口判据逐项一致（计划估数 238 与台账实测 227 差 11，以实测为准）。门禁 / `tsc` / 相关单测（21 文件 271 例）/ eslint / `pnpm lint` / audit-doc 哨兵全绿。

### W5 Push / Widget / Voice / RTC / Worker（残 197）

`PushManager`(12/17/15) · `WidgetManager`(2/16/14) · `VoiceManager`(12/5/5) · `WorkerAdminManager`(0/15/8) · `WorkerBodyManager`(0/11/10) · `WorkerManager`(0/10/6) · `NotificationsManager`(4/2/1) · `FeatureFlagManager`(0/4/4) · `PushRulesManager`(6/0/0) · `ModerationManager`(0/1/5) · `TurnServerManager`(4/1/0) · `MatrixRTCSessionManager`(2/2/0) · `RTCEncryptionManager`(3/1/0)。

出口判据：13 类归 0。本域 `throwsWithoutTag` 占比最高（68/197），**每个 Worker/Voice 方法务必核 `bodyThrows`**。

交付结果（2026-10-11）：13 类三指标全部归 0；全局 656/392/111 → **611/307/43**（残差 961），净降 J −45 / E −85 / T −68，与出口判据逐项一致（计划估数 197 与台账实测 198 差 1，以实测为准）。门禁 / `tsc` / 相关单测（16 文件 368 例）/ eslint / `pnpm lint` / audit-doc 哨兵全绿。

### W6 Space / Federation（残 69）

`SpaceManager`(4/1/0) · `SpaceHierarchyManager`(5/2/0) · `SpaceQueryManager`(8/5/0) · `SpaceMemberManager`(4/0/0) · `SpaceChildManager` / `SpaceLifecycleManager`（已绿）· `FederationManager` · `FederationQueryManager` · `FederationRoomManager` · `FederationServerManager` · `FederationBlacklistManager`。

出口判据：11 类归 0。体量最小，可作为「节奏维护波」。

交付结果（2026-10-11）：11 类三指标全部归 0（其中 `SpaceChildManager` / `SpaceLifecycleManager` 已于 W0 批次清零，本波实际新清零 9 类）；全局 611/307/43 → **578/284/30**（残差 892），净降 J −33 / E −23 / T −13，与出口判据逐项一致。门禁 / `tsc` / 相关单测（10 文件 156 例）/ eslint / `pnpm lint` / audit-doc 哨兵全绿。

### W7a 长尾头部（残 292）

`ThreadManager`(2/21/15) · `BurnAfterReadManager`(31/0/0) · `TelemetryManager`(27/0/0) · `ThreadingManager`(27/0/0) · `ApplicationServiceManager`(24/2/0) · `AuthManager`(0/23/2) · `DiscoveryManager`(24/0/0) · `ModuleManager`(21/2/0) · `AccountManager`(0/19/0) · `MediaManager`(8/11/0) · `PresenceManager`(14/3/1) · `ProfileManager`(3/11/1)。

出口判据：12 类归 0。

交付结果（2026-10-11）：12 类三指标全部归 0；全局 578/284/30 → **397/192/11**（残差 600），净降 J −181 / E −92 / T −19，与出口判据逐项一致。门禁 / `tsc` / 相关单测（19 文件 503 例）/ eslint / `pnpm lint` / audit-doc 哨兵全绿。

### W7b 长尾尾部（残 297）

其余 46 个类（每类残差 < 15），典型：`AccountDataManager`(0/12/1) · `RoomSummaryEventOperationManager` 已入 W3 · `EventManager`(10/4/0) · `MembershipManager`(12/2/0) · `ReactionsManager`(9/2/0) · `SyncManager`(9/0/0) · `ReadReceiptsManager`(5/5/1) · `TypingManager`(2/8/1) 等。**每类体量小，适合批量清扫**（一次会话可清 5~10 类）。

出口判据：46 类归 0。**此波收尾即达成 143 类全域归零**（MatrixClient 除外）。

交付结果（2026-10-11）：实际纳入口径 **44 类 / 45 文件**（计划估数 46 类与台账实测差 2，且残差实测 307 与估数 297 差 10，均以实测为准；差异来源为 W7a 实际交付略优于计划，使 `ServerCapabilitiesManager`(7/7/1) 落入本波阈值）。44 类三指标全部归 0；全局 397/192/11 → **204/88/1**（残差 293），净降 J −193 / E −104 / T −10，与出口判据逐项一致。本波复核 `git diff --numstat` 为 **added 2961 / deleted 0**（纯注释新增，无逻辑改动）；门禁 / `tsc` / 相关单测（30 文件 395 例）/ eslint / `pnpm lint` / audit-doc 哨兵全绿。**八波累计 142/143 类清零，仅余 `MatrixClient`（293）。**

### Epic：MatrixClient 本体（残 293）

单类即占 14.2%：`missingJsDoc 204` / `missingExample 88` / `throwsWithoutTag 1`。**唯一需要专门排期的对象**。建议按方法族拆分，每族一个子任务：

| 方法族（示例）                   | 说明                                  |
| -------------------------------- | ------------------------------------- |
| 发送流水（send\*）               | `sendEvent` / `sendMessage` / 上传等  |
| 房间操作（room\*）               | 创建/加入/离开/状态                   |
| 同步与生命周期（sync/lifecycle） | `startClient` / `stopClient` / `sync` |
| Crypto 委托                      | `initRustCrypto` / `getCrypto` 等     |
| 会话与身份（session/profile）    | 登录态、显示名                        |
| 其余长尾                         | 分类清零                              |

**约束**：本类大量方法为**委托/兼容**方法，JSDoc 须描述**真实语义**而非复述 `getXxxManager()`；`@example` 用公开入口（如 `client.sendEvent(...)`）而非内部字段。

交付结果（2026-10-11）：`MatrixClient` 三指标（204 / 88 / 1）全部归 0；全局 204/88/1 → **0/0/0**（残差 0），净降 J −204 / E −88 / T −1。293 个缺口全部位于 `src/client.ts` 单文件，按方法族分 5 批（chunk-1~5，59 / 59 / 59 / 59 / 57）**串行**完成（同文件并行编辑会读旧写覆盖，故必须串行）。本类改动为纯 JSDoc 新增，`git diff --minimal --numstat` 为 **added 2924 / deleted 0**，无任何逻辑改动（该文件工作区叠加多批未提交改动时，默认 Myers 算法可能出现对齐伪影，以 `--minimal` / `histogram` 为准）。门禁裸跑 `✅ 无违规`、`tsc` / 全量单测（446 文件 7025 例）/ eslint / `pnpm lint` / audit-doc 哨兵全绿。**M5 出口判据逐项满足**：台账整表回落 0、门禁由「棘轮」升级为「纯守门」、143 类全域归零。

## 5. 每批标准作业流程（SOP）

```bash
# 1. 生成该域待补清单（机器可读 TODO）
node scripts/quality/check-public-api-docs.mjs --emit-plan artifacts/_wip-i10-plan.md
# 2. 逐类补「三件套」（JSDoc + @example，体内有 throw 者 + @throws）
# 3. 下调台账（恶化会被拒写 —— 拒写即说明漏补 @example）
node scripts/quality/check-public-api-docs.mjs --write-ledger
# 4. 门禁自检（应为 ✅ 无违规）
node scripts/quality/check-public-api-docs.mjs
# 5. 格式化（artifacts 之外的源文件）
npx prettier --write src/<模块>/*.ts
# 6. 类型与 lint
npx tsc --noEmit
pnpm lint:js
# 7. 相关单测
npx vitest run spec/unit/...
```

**硬性纪律**：

- 台账**只降不升**；`--write-ledger` 若拒写，**不得**手工改大数字，必须回头补 `@example` / `@throws`。
- 严禁在 `src/**/__generated__/**` 内补文档（该目录不纳入口径，且生成物会被覆盖）。
- `@example` 必须是**可直接复制运行**的调用，禁止占位符（如 `// ...`）。

## 6. 验收与节奏

**每波退出条件（缺一不可）**：

1. 本波所有类的 `missingJsDoc / missingExample / throwsWithoutTag` **均为 0**；
2. `--write-ledger` 后三个全局指标**单调不增**；
3. `check-public-api-docs` 绿（`✅ 无违规`）、`tsc --noEmit` 绿、`pnpm lint:js` 绿；
4. 涉及 spec 的类，相关单测通过。

**里程碑**（按残差清账，非时间承诺）：

| 里程碑          | 累计清零类  | 累计残差下降  | 全局指标（J/E/T）                 |
| --------------- | ----------- | ------------- | --------------------------------- |
| M0（W0 后基线） | 9 / 143     | —             | 1135 / 713 / 210                  |
| W1（已完成）    | 19 / 143    | 157（7.6%）   | 1053 / 662 / 186                  |
| W2（已完成）    | 29 / 143    | 362（17.6%）  | 984 / 561 / 151                   |
| W3（已完成）    | 46 / 143    | 672（32.6%）  | 787 / 472 / 127                   |
| W4（已完成）    | 65 / 143    | 899（43.7%）  | 656 / 392 / 111                   |
| W5（已完成）    | 78 / 143    | 1097（53.3%） | 611 / 307 / 43                    |
| W6（已完成）    | 86 / 143    | 1166（56.7%） | 578 / 284 / 30                    |
| W7a（已完成）   | 98 / 143    | 1458（70.8%） | 397 / 192 / 11                    |
| W7b（已完成）   | 142 / 143   | 1765（85.8%） | 204 / 88 / 1                      |
| M2 = +W3+W4     | 66          | 910（44.2%）  | 653 / 385 / 110                   |
| M3 = +W5+W6     | 88          | 1176（57.1%） | 575 / 278 / 29                    |
| M4 = +W7a+W7b   | 142         | 1765（85.8%） | 204 / 88 / 1（仅余 MatrixClient） |
| M5 = +Epic      | 143（全域） | 2058（100%）  | **0 / 0 / 0**                     |

> M1~M2 覆盖残差 Top-50 中的绝大多数，是**投入产出最高**的两段；建议优先排期。

> **M5 已于 2026-10-11 达成**：`MatrixClient` 归零后，全局三指标为 **0 / 0 / 0**（143 类全域清零），`--write-ledger` 使台账整表回落至 0，`check-public-api-docs` 自此以「缺口 ↔ 台账」双向校验守住 0——由「棘轮」正式升级为「纯守门」。本计划的全部波次（W0 ~ W7b + Epic）至此收官。

## 7. 风险与注意

- **R2 平移陷阱**（头号风险）：任何只补 JSDoc 的动作都会被门禁拦下；`--write-ledger` 拒写即为信号，不要绕过。
- **重载方法**：门禁按方法名分组，同一名字的多个签名共享一份文档块——补一次即可，但样例要覆盖主要分支。
- **实际可运行性**：`@example` 不可跑通等于没补；优先从既有 spec / `docs/` 中取真实调用。
- **口径漂移**：若某批**新增**公开方法，`missingJsDoc` 会瞬时上升并触发违规；应在新方法落地时**同批**补文档，而非事后清账。
- **不纳入范围**：`src/**/__generated__/**`、非 exports 可达的私有模块、`_` 前缀方法。
