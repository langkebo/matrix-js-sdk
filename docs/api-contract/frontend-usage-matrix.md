# 前端使用对照表 — matrix-js-sdk × hula

> **生成时间**：Phase F.1（SDK 优化 Round 2）
> **SDK commit**：`6ad01fb32`（Phase E 提交后 HEAD）
> **SDK 版本**：v40.2.0
> **hula augmentations**：`hula/src/types/matrix-js-sdk-augmentations.d.ts`（1921 行）
> **目的**：为前端 G 阶段对接准备三个清单 —— 零使用入口、深路径违规、SDK 补导出，并提供 augmentations 冗余项清单供 hula 清理。

---

## 0. 方法说明

- **清单 A**：扫描 hula 仓库（排除 `node_modules`、`dist`、`build`、`.git`）下所有 `.ts/.tsx/.vue/.mjs/.js` 文件，匹配 `from ['"]matrix-js-sdk` / `require\(['"]matrix-js-sdk` / `import\(['"]matrix-js-sdk` 三种 import 形式，归一化到 SDK package.json 的 54 个 exports 入口。
- **清单 B**：在 hula 中搜索 `matrix-js-sdk/src/...`、`matrix-js-sdk/lib/...`、`matrix-js-sdk/dist/...` 以及任何不在 54 个 exports 入口中的子路径。
- **清单 C**：完整读取 augmentations.d.ts（1921 行），分类为「A 类补齐类型」「B 类业务专属扩展」「D 类冗余」，对 A 类用 grep 在 SDK `src/` 下验证同名类型是否存在、是否已导出，最终得出"建议补导出"清单。

---

## 1. 清单 A：SDK 入口使用对照表

### 1.1 完整对照表（54 个入口）

| SDK 入口                   | hula 引用次数 | 代表性引用文件（最多 3 个）                                                                      | 状态   |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------ | ------ |
| `.`                        | 33            | `services/matrix/sdk.ts`、`services/matrix/MatrixClientService.ts`、`services/matrix/index.ts`   | 已用   |
| `./core`                   | 0             | —                                                                                                | 零使用 |
| `./advanced`               | 0             | —                                                                                                | 零使用 |
| `./legacy`                 | 0             | —                                                                                                | 零使用 |
| `./crypto`                 | 24            | `services/matrix/crypto/CryptoSDKAdapter.ts`、`services/matrix/crypto/MatrixKeyBackupService.ts` | 已用   |
| `./webrtc`                 | 0             | —                                                                                                | 零使用 |
| `./friend`                 | 3             | `services/matrix/friends/MatrixFriendService.ts`、`services/matrix/index.ts`                     | 已用   |
| `./dm`                     | 5             | `services/matrix/room/MatrixDirectMessageService.ts`、`services/matrix/index.ts`                 | 已用   |
| `./voice`                  | 0             | —                                                                                                | 零使用 |
| `./notification`           | 0             | —                                                                                                | 零使用 |
| `./push`                   | 13            | `services/matrix/notifications/MatrixPushService.ts`、`services/matrix/index.ts`                 | 已用   |
| `./space`                  | 4             | `services/matrix/room/MatrixSpaceService.ts`、`services/matrix/index.ts`                         | 已用   |
| `./admin`                  | 10            | `services/matrix/admin/AdminFacadeService.ts`、`services/matrix/index.ts`                        | 已用   |
| `./ai-connection`          | 0             | —                                                                                                | 零使用 |
| `./saml`                   | 0             | —                                                                                                | 零使用 |
| `./app-service`            | 0             | —                                                                                                | 零使用 |
| `./guest`                  | 3             | `services/matrix/guest/MatrixGuestService.ts`、`services/matrix/index.ts`                        | 已用   |
| `./event-report`           | 2             | `services/matrix/moderation/MatrixEventReportService.ts`、`services/matrix/index.ts`             | 已用   |
| `./beacon`                 | 0             | —                                                                                                | 零使用 |
| `./cache`                  | 0             | —                                                                                                | 零使用 |
| `./models`                 | 11            | `services/matrix/MatrixEventService.ts`、`services/matrix/index.ts`                              | 已用   |
| `./store`                  | 6             | `services/matrix/MatrixClientService.ts`、`services/matrix/index.ts`                             | 已用   |
| `./store/worker`           | 0             | —                                                                                                | 零使用 |
| `./http-api`               | 4             | `services/matrix/MatrixHttpClient.ts`、`services/matrix/index.ts`                                | 已用   |
| `./http-api/errors`        | 1             | `services/matrix/sdk.ts`                                                                         | 已用   |
| `./errors`                 | 0             | —                                                                                                | 零使用 |
| `./client`                 | 20            | `services/matrix/MatrixClientService.ts`、`services/matrix/index.ts`                             | 已用   |
| `./models/room`            | 9             | `services/matrix/room/RoomOperations.ts`、`services/matrix/index.ts`                             | 已用   |
| `./models/event`           | 10            | `services/matrix/MatrixEventService.ts`、`services/matrix/index.ts`                              | 已用   |
| `./models/room-state`      | 3             | `services/matrix/room/RoomOperations.ts`、`services/matrix/index.ts`                             | 已用   |
| `./sync`                   | 8             | `services/matrix/sync/MatrixSyncService.ts`、`services/matrix/index.ts`                          | 已用   |
| `./runtime-schemas`        | 0             | —                                                                                                | 零使用 |
| `./telemetry`              | 4             | `services/matrix/matrixClientAccessor.ts`、`services/matrix/index.ts`                            | 已用   |
| `./manager-extensions`     | 0             | —                                                                                                | 零使用 |
| `./@types/partials`        | 0             | —                                                                                                | 零使用 |
| `./@types/PushRules`       | 0             | —                                                                                                | 零使用 |
| `./timeline-window`        | 0             | —                                                                                                | 零使用 |
| `./src/manager-extensions` | 0             | —                                                                                                | 零使用 |
| `./src/filter`             | 0             | —                                                                                                | 零使用 |
| `./src/telemetry`          | 0             | —                                                                                                | 零使用 |
| `./device`                 | 2             | `services/matrix/index.ts`、`services/matrix/room/RoomOperations.ts`                             | 已用   |
| `./device-keys`            | 1             | `services/matrix/crypto/CryptoSDKAdapter.ts`                                                     | 已用   |
| `./key-backup`             | 1             | `services/matrix/crypto/CryptoSDKAdapter.ts`                                                     | 已用   |
| `./key-verification`       | 1             | `services/matrix/crypto/CryptoSDKAdapter.ts`                                                     | 已用   |
| `./e2ee`                   | 0             | —                                                                                                | 零使用 |
| `./external-service`       | 0             | —                                                                                                | 零使用 |
| `./feature-flags`          | 0             | —                                                                                                | 零使用 |
| `./federation`             | 0             | —                                                                                                | 零使用 |
| `./media`                  | 7             | `services/matrix/media/MatrixMediaService.ts`、`services/matrix/index.ts`                        | 已用   |
| `./oidc`                   | 0             | —                                                                                                | 零使用 |
| `./presence`               | 0             | —                                                                                                | 零使用 |
| `./room`                   | 4             | `services/matrix/room/RoomOperations.ts`、`services/matrix/index.ts`                             | 已用   |
| `./room-summary`           | 1             | `services/matrix/room/MatrixRoomSummaryService.ts`                                               | 已用   |
| `./verification`           | 0             | —                                                                                                | 零使用 |

### 1.2 零使用入口清单（27 个）

> **用途**：供 D.3 复核「SDK 是否有冗余 exports」；同时供 G 阶段判断 hula 是否要保留这些入口的 SDK 端依赖。

#### 1.2.1 业务未启用（10 个）— hula 暂未实现对应业务，SDK 入口合理保留

| 入口              | 用途            | 处置建议                                          |
| ----------------- | --------------- | ------------------------------------------------- |
| `./webrtc`        | WebRTC 通话     | 保留（SDK 公共能力，hula 暂未启用 VoIP）          |
| `./voice`         | 语音房间        | 保留（同上）                                      |
| `./notification`  | 通知管理器      | 保留（与 `./push` 不同，notification 是高层封装） |
| `./beacon`        | 地理信标        | 保留（hula 暂未启用）                             |
| `./ai-connection` | AI 连接管理     | 保留（hula 有 OpenClaw 但走自研路径）             |
| `./saml`          | SAML SSO        | 保留（hula 暂未启用 SAML）                        |
| `./app-service`   | AppService 桥接 | 保留（hula 是客户端，不是 bridge）                |
| `./federation`    | 联邦管理        | 保留（hula 是客户端，不直接管理联邦）             |
| `./oidc`          | OIDC 登录       | 保留（hula 走自研账号体系，OIDC 是备选）          |
| `./e2ee`          | E2EE 高层 API   | 保留（hula 走 `./crypto` 底层）                   |

#### 1.2.2 低层/调试入口（9 个）— SDK 内部使用，hula 不应直接依赖

| 入口                   | 用途           | 处置建议                                                                  |
| ---------------------- | -------------- | ------------------------------------------------------------------------- |
| `./core`               | 内核原语       | 保留（SDK 内核分层）                                                      |
| `./advanced`           | 高级 API       | 保留（SDK 分层）                                                          |
| `./legacy`             | 遗留 API       | 保留（向后兼容）                                                          |
| `./cache`              | 缓存层         | 保留（内部使用）                                                          |
| `./errors`             | 错误码         | 保留（已被 `./http-api/errors` 覆盖部分，但 `./errors` 是更全的错误类型） |
| `./runtime-schemas`    | 运行时 schema  | 保留（内部使用）                                                          |
| `./manager-extensions` | 管理器扩展聚合 | 保留（内部使用）                                                          |
| `./@types/partials`    | 部分类型       | 保留（类型工具）                                                          |
| `./@types/PushRules`   | Push 规则类型  | 保留（类型工具）                                                          |

#### 1.2.3 工具/可选入口（4 个）— 按需保留

| 入口                 | 用途              | 处置建议                                                  |
| -------------------- | ----------------- | --------------------------------------------------------- |
| `./store/worker`     | Store Worker 模式 | 保留（hula 当前用主线程 store，但 Worker 模式是可选能力） |
| `./timeline-window`  | 时间轴窗口工具    | 保留（可选工具）                                          |
| `./external-service` | 外部服务集成      | 保留（可选）                                              |
| `./feature-flags`    | 特性开关          | 保留（可选）                                              |

#### 1.2.4 深路径冗余（3 个）— **建议在 SDK 端删除** ⚠️

| 入口                       | 问题                                                              | 处置建议                       |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| `./src/manager-extensions` | 与 `./manager-extensions` 重复，且穿透 `src/` 目录                | **建议删除**（D.3 复核遗漏项） |
| `./src/filter`             | 穿透 `src/` 目录，`./filter` 未在 exports 但应通过 `.` 主入口透出 | **建议改为 `./filter`** 或删除 |
| `./src/telemetry`          | 与 `./telemetry` 重复，且穿透 `src/` 目录                         | **建议删除**（D.3 复核遗漏项） |

> **G 阶段前置任务**：D.3 复核时应清理这 3 个 `./src/*` 深路径 exports。本清单列为"SDK 端待修复项"，由 F.2 交接文档传递给 G 阶段。

#### 1.2.5 业务专属但未启用（1 个）

| 入口         | 用途           | 处置建议                            |
| ------------ | -------------- | ----------------------------------- |
| `./presence` | 在线状态管理器 | 保留（hula 暂未启用 presence 业务） |

### 1.3 使用频次 Top 10

| 排名 | 入口             | 引用次数 |
| ---- | ---------------- | -------- |
| 1    | `.`              | 33       |
| 2    | `./crypto`       | 24       |
| 3    | `./client`       | 20       |
| 4    | `./push`         | 13       |
| 5    | `./admin`        | 10       |
| 6    | `./models/event` | 10       |
| 7    | `./models`       | 11       |
| 8    | `./models/room`  | 9        |
| 9    | `./sync`         | 8        |
| 10   | `./media`        | 7        |

---

## 2. 清单 B：深路径违规清单

### 2.1 违规列表（5 处，全部在 `.d.ts` 类型文件中）

| hula 文件:行号                                  | 完整 import 路径                               | import 的符号                  | 建议替换为公开入口                        |
| ----------------------------------------------- | ---------------------------------------------- | ------------------------------ | ----------------------------------------- |
| `hula/src/typings/matrix-sdk-extensions.d.ts:1` | `matrix-js-sdk/src/client`                     | `MatrixClient`                 | `matrix-js-sdk` 或 `matrix-js-sdk/client` |
| `hula/src/typings/matrix-sdk-extensions.d.ts:2` | `matrix-js-sdk/src/matrix-client-extensions.d` | `MatrixClientExtensionMethods` | （SDK 未公开导出，见清单 C 补导出建议）   |
| `hula/src/typings/matrix-sdk-extensions.d.ts:3` | `matrix-js-sdk/src/room/RoomManager`           | `RoomManager`                  | `matrix-js-sdk/room`                      |
| `hula/src/typings/global.d.ts:67`               | `matrix-js-sdk/src/client`                     | `MatrixClient`                 | `matrix-js-sdk` 或 `matrix-js-sdk/client` |
| `hula/src/typings/global.d.ts:68`               | `matrix-js-sdk/src/matrix-client-extensions.d` | `MatrixClientExtensionMethods` | （SDK 未公开导出，见清单 C 补导出建议）   |

### 2.2 性质判定

- **运行时违规**：0 处（hula 源码与测试代码均未在运行时穿透 `src/`）
- **类型层违规**：5 处（全部在 `.d.ts` 中）
- **风险等级**：低（类型层深路径不影响打包，但破坏 SDK/前端边界，且 SDK 内部文件路径变化会直接破坏 hula 类型检查）

### 2.3 修复建议

| 违规类型                                        | 修复方式                                                    | 阶段                      |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| `src/client` 深路径（3 处）                     | 改为 `matrix-js-sdk/client` 或 `matrix-js-sdk`              | G 阶段（hula 改动）       |
| `src/room/RoomManager` 深路径（1 处）           | 改为 `matrix-js-sdk/room`（SDK 已导出 `RoomManager`）       | G 阶段（hula 改动）       |
| `src/matrix-client-extensions.d` 深路径（2 处） | 待 SDK 补导出 `MatrixClientExtensionMethods` 类型，见清单 C | F.2 列入计划 → G 阶段联调 |

---

## 3. 清单 C：SDK 补导出清单

### 3.1 补导出项（10 项）

> **处置策略**：本清单作为「计划」列入 F.2 交接文档，**不在 F 阶段立即实施**。原因：hula 当前通过 augmentations.d.ts 已绕过这些缺口，立即补导出会让 F 阶段引入"为未使用场景修改"的变动；应由 G 阶段联调时，结合"hula 是否要清理 augmentations"决策一次性实施。

#### C.1 子路径未暴露（7 项）

以下子路径在 SDK `src/` 下存在完整实现，但未在 `package.json` exports 中暴露。hula augmentations 中仅为 `extendMatrixClient` 函数声明了存根类型（hula 运行时不直接 import 这些子路径，但若 SDK 暴露后 hula 可清理 augmentations 存根块）。

| 子路径           | SDK 内部位置                   | augmentations 行号 | 用途                                                                    |
| ---------------- | ------------------------------ | ------------------ | ----------------------------------------------------------------------- |
| `./account`      | `src/account/index.ts:291`     | 1443               | 账户数据管理器                                                          |
| `./auth`         | `src/auth/index.ts:648`        | 1447               | 认证管理器                                                              |
| `./capabilities` | `src/capabilities/index.ts:77` | 1451               | 能力协商管理器                                                          |
| `./profile`      | `src/profile/index.ts:606`     | 1471               | 用户资料管理器                                                          |
| `./sending`      | `src/sending/index.ts:302`     | 1479               | 消息发送管理器                                                          |
| `./qr-login`     | `src/qr-login/index.ts:190`    | 1792               | 二维码登录                                                              |
| `./crypto-keys`  | `src/crypto-keys/index.ts:103` | 1732、1740         | 密钥管理（含 `CryptoKeysManager` 类 + 6 个方法 + `extendMatrixClient`） |

**实施方式**（G 阶段联调确认后）：在 `package.json` 的 `exports` 字段中新增 7 个条目，与现有 `./friend`、`./dm` 等同构。

#### C.2 主入口未透出类型（3 项）

以下类型已通过 `./crypto` 子入口暴露（`src/crypto/index.ts` 中 `export type * from "./keybackup"`），但 SDK 主入口 `matrix.ts` 未透出。hula augmentations 在主模块块中重声明了它们，以便从 `matrix-js-sdk` 主入口直接 import。

| 类型                    | SDK 内部位置                     | augmentations 行号 | 当前导出入口 | 建议补导出位置                                                                             |
| ----------------------- | -------------------------------- | ------------------ | ------------ | ------------------------------------------------------------------------------------------ |
| `KeyBackupInfo`         | `src/crypto-api/keybackup.ts:40` | 1339-1345          | `./crypto`   | `src/matrix.ts` 新增 `export type { KeyBackupInfo } from "./crypto-api/keybackup"`         |
| `KeyBackupSession`      | `src/crypto-api/keybackup.ts:79` | 1327-1333          | `./crypto`   | `src/matrix.ts` 新增 `export type { KeyBackupSession } from "./crypto-api/keybackup"`      |
| `KeyBackupRoomSessions` | `src/crypto-api/keybackup.ts:86` | 1335-1337          | `./crypto`   | `src/matrix.ts` 新增 `export type { KeyBackupRoomSessions } from "./crypto-api/keybackup"` |

#### C.3 类型层深路径缺口（1 项，关联清单 B）

| 类型                           | SDK 内部位置                        | hula 引用位置                                                                         | 建议补导出位置                                                                                        |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `MatrixClientExtensionMethods` | `src/matrix-client-extensions.d.ts` | `hula/src/typings/matrix-sdk-extensions.d.ts:2,68`、`hula/src/typings/global.d.ts:68` | `src/matrix.ts` 新增 `export type { MatrixClientExtensionMethods } from "./matrix-client-extensions"` |

> **注**：`MatrixClientExtensionMethods` 是 `extendMatrixClient` 挂载到 `MatrixClient.prototype` 上的方法集合类型。hula typings 中两处深路径引用都是为了拿到这个类型。SDK 补导出后，hula 可改为从 `matrix-js-sdk` 主入口 import。

### 3.2 不实施立即补导出的理由

1. **hula 运行时不依赖**：清单 A 显示 hula 实际 import 中**没有**这 7 个子路径，augmentations 中的存根块只是类型补齐。
2. **避免 F 阶段越界**：F 阶段定位为"对接准备"，不应在 SDK 侧引入"为未使用场景修改"的变动。
3. **G 阶段一次性闭环**：G 阶段会评估 hula augmentations 整体清理策略，届时统一实施补导出 + hula 改动 + augmentations 清理，避免双向不一致。

---

## 4. augmentations 冗余项清单（供 G 阶段清理）

> 以下类型/函数 SDK 已通过主入口或子入口导出，augmentations 中重声明属冗余。**部分形状不一致**，可能引发类型冲突，需 G 阶段逐项复核。

### 4.1 主模块块冗余（高优先级清理项）

| 类型/函数                                 | augmentations 行号 | SDK 导出路径                                                                    | 形状一致性                                     |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| `PendingEventOrdering`（enum）            | 10-14              | `src/client-config-types.ts:59` → `matrix.ts:113`                               | SDK 多 `Detached` 等值                         |
| `Method`（enum）                          | 16-22              | `src/http-api/method.ts:17` → `matrix.ts:56`                                    | SDK 多 `Head`、`Patch`                         |
| `ClientPrefix`（enum）                    | 24-28              | `src/http-api/prefix.ts:17` → `matrix.ts:56`                                    | SDK 多 `Unstable`                              |
| `Visibility`                              | 32-36              | `src/@types/partials.ts:17` → `matrix.ts:90`                                    | 不一致（SDK enum vs augmentations const+type） |
| `Preset`（enum）                          | 38-42              | `src/@types/partials.ts:22` → `matrix.ts:90`                                    | 一致                                           |
| `ReceiptType`                             | 44-48              | `src/@types/read_receipts.ts:17` → `matrix.ts:98`                               | SDK 多 `FullyRead`                             |
| `PushRuleKind`                            | 50-57              | `src/@types/PushRules.ts:134` → `matrix.ts:89`                                  | 不一致（SDK enum vs const+type）               |
| `NotificationCountType`（enum）           | 59-62              | `src/models/room.ts:134` → `matrix.ts:62`                                       | 一致                                           |
| `RoomType`（enum）                        | 64-66              | `src/@types/event.ts:204` → `matrix.ts:88`                                      | SDK 多 `UnstableCall`、`ElementVideo`          |
| `Direction`（enum）                       | 68-71              | `src/models/event-timeline.ts:45` → `matrix.ts:63`                              | 一致                                           |
| `EventType`（enum）                       | 73-92              | `src/@types/event.ts:81` → `matrix.ts:88`                                       | SDK 多几十个值 ⚠️                              |
| `TweakName`（enum）                       | 94-97              | `src/@types/PushRules.ts:27` → `matrix.ts:89`                                   | 一致                                           |
| `PushRuleAction`（type）                  | 99                 | `src/@types/PushRules.ts:50` → `matrix.ts:89`                                   | 不一致 ⚠️                                      |
| `EmptyObject`（type）                     | 100                | `src/@types/common.ts:24` → `matrix.ts:86`                                      | 一致                                           |
| `ICreateRoomOpts`                         | 105-119            | `src/@types/requests.ts:212` → `matrix.ts:91`                                   | 近似                                           |
| `ISendEventResponse`                      | 265-267            | `src/@types/requests.ts:95` → `matrix.ts:91`                                    | 一致                                           |
| `IEventRelation`                          | 257-261            | `src/models/event.ts:142` → `matrix.ts:61`                                      | 不一致 ⚠️                                      |
| `IContent`                                | 308-312            | `src/models/event.ts:80` → `matrix.ts:61`                                       | 不一致 ⚠️                                      |
| `IPushRuleCondition`                      | 340-345            | `src/@types/PushRules.ts:75` → `matrix.ts:89`                                   | 不一致（SDK 泛型） ⚠️                          |
| `IPushRule`                               | 349-356            | `src/@types/PushRules.ts:172` → `matrix.ts:89`                                  | 一致                                           |
| `IPushRules`                              | 358-361            | `src/@types/PushRules.ts:185` → `matrix.ts:89`                                  | 一致                                           |
| `IPusher`                                 | 363-379            | `src/@types/PushRules.ts:190` → `matrix.ts:89`                                  | 一致                                           |
| `IPusherRequest`                          | 381-384            | `src/@types/PushRules.ts:209` → `matrix.ts:89`                                  | augmentations 多 `device_id`                   |
| `PushRuleSet`                             | 336-338            | `src/@types/PushRules.ts:168` → `matrix.ts:89`                                  | 一致                                           |
| `TimelineWindow`                          | 388-392、402-406   | `src/timeline-window.ts:53` → `matrix.ts:117`                                   | 重复声明且冲突 ⚠️                              |
| `MatrixError`                             | 442-446            | `src/http-api/errors.ts:97` → `matrix.ts:59`                                    | 近似                                           |
| `SlidingSyncState`（enum）                | 447-450            | `src/sliding-sync.ts:130` → `matrix.ts:138`                                     | SDK 值更多                                     |
| `SlidingSyncEvent`（enum）                | 451-454            | `src/sliding-sync.ts:264` → `matrix.ts:138`                                     | 一致                                           |
| `MSC3575SlidingSyncResponse`              | 455-460            | `src/sliding-sync.ts:122` → `matrix.ts:139`                                     | 一致                                           |
| `MSC3575RoomData`                         | 149-161            | `src/sliding-sync.ts:97` → `matrix.ts:139`                                      | 一致                                           |
| `SlidingSync`（class）                    | 175-208            | `src/sliding-sync.ts:295` → `matrix.ts:138`                                     | 近似                                           |
| `IndexedDBStore`（class）                 | 461-464            | `src/store/indexeddb.ts:59` → `matrix.ts:80`                                    | 近似                                           |
| `MemoryStore`（class）                    | 465-467            | `src/store/memory.ts:53` → `matrix.ts:79`                                       | 近似                                           |
| `LocalStorageCryptoStore`（class）        | 468-470            | `src/crypto/store/localStorage-crypto-store.ts:67` → `matrix.ts:82`             | 近似                                           |
| `createClient`（function）                | 471                | `src/matrix.ts:254`                                                             | 一致                                           |
| `initializeManagerExtensions`（function） | 472                | `src/matrix.ts:240`                                                             | 一致                                           |
| `LoginResponse`                           | 234-241            | `src/@types/auth.ts:213` → `matrix.ts:114`                                      | 不一致（`expires_in` vs `expires_in_ms`） ⚠️   |
| `RegisterResponse`                        | 243-249            | `src/@types/registration.ts:73` → `matrix.ts:97`                                | 不一致（同上） ⚠️                              |
| `IRequestTokenResponse`                   | 251-255            | `src/client-api-types.ts:13` → `matrix.ts:53`                                   | augmentations 多 `expires_in`                  |
| `IPublicRoomsResponse`                    | 133-147            | `src/client-api-types.ts:89` → `matrix.ts:53`                                   | 近似                                           |
| `IDeviceUpdateRequest`                    | 1359-1361          | `src/device/index.ts:62` → `matrix.ts:137`                                      | 一致                                           |
| `MatrixCall`（interface）                 | 289-302            | `src/web-rtc/call.ts:353` → `matrix.ts:122`                                     | SDK 已 type 导出                               |
| `OidcClientConfig`                        | 324-328            | `src/oidc/index.ts:32` → `matrix.ts:72`                                         | 不一致 ⚠️                                      |
| `generateOidcAuthorizationUrl`            | 321                | `src/oidc/authorize.ts:89` → `matrix.ts:72`                                     | 不一致 ⚠️                                      |
| `discoverAndValidateOIDCIssuerWellKnown`  | 322                | `src/oidc/discovery.ts:35` → `matrix.ts:72`                                     | 不一致 ⚠️                                      |
| `completeAuthorizationCodeGrant`          | 323                | `src/oidc/authorize.ts:165` → `matrix.ts:72`                                    | 不一致 ⚠️                                      |
| `generateScope`                           | 329                | `src/oidc/authorize.ts:52` → `matrix.ts:72`                                     | 不一致 ⚠️                                      |
| `MatrixEvent`（class）                    | 843-867            | `src/models/event.ts:278` → `matrix.ts:61`                                      | 重复声明 ⚠️                                    |
| `RoomState`（class）                      | 1030-1045          | `src/models/room-state.ts:136` → `matrix.ts:66`                                 | 重复声明 ⚠️                                    |
| `SearchResponse`                          | 1056-1060          | `src/@types/search.ts:105` → `matrix.ts:135`                                    | 一致                                           |
| `SearchResult`                            | 1062-1073          | `src/models/search-result.ts:21` → `matrix.ts:71`                               | SDK 为 class                                   |
| `UserDirectorySearchResponse`             | 1380-1383          | `src/discovery/index.ts:50` → `matrix-managers.ts:14` → `matrix.ts:110`         | 不一致 ⚠️                                      |
| `ICreateClientOpts`                       | 210-232            | `src/client-config-types.ts:19` → `matrix.ts:112`                               | 不一致 ⚠️                                      |
| `BurnAfterReadManager`                    | 998-1015           | `src/burn-after-read/index.ts:152` → `matrix-managers.ts:130` → `matrix.ts:110` | 不一致 ⚠️                                      |
| `PresenceManager`                         | 1019-1027          | `src/presence/index.ts:75` → `matrix-managers.ts:100` → `matrix.ts:110`         | 不一致 ⚠️                                      |
| `TypingManager`                           | 410-418            | `src/typing/index.ts:47` → `matrix-managers.ts:112` → `matrix.ts:110`           | 不一致 ⚠️                                      |
| `ReadReceiptsManager`                     | 422-439            | `src/read-receipts/index.ts:43` → `matrix-managers.ts:182` → `matrix.ts:110`    | 不一致 ⚠️                                      |
| `Filter`（interface）                     | 1182-1197          | `src/filter.ts:70`（class） → `matrix.ts:74`                                    | SDK 为 class ⚠️                                |
| `RoomSummary`                             | 1158-1164          | `src/client.ts` → `matrix.ts:109`                                               | 不一致 ⚠️                                      |
| `Device`（interface）                     | 1348-1356          | `src/models/device.ts:32`（class） → `matrix.ts:70`                             | 不一致（camelCase vs snake_case） ⚠️           |

### 4.2 子模块块冗余（10 个块整体可移除）

以下 10 个 `declare module 'matrix-js-sdk/...'` 块整体冗余，SDK 已通过对应子入口导出全部类型。G 阶段清理 augmentations 时可整体删除（前提：hula 改为从 SDK 子入口 import）。

| 子模块块                         | augmentations 行号 | SDK 对应子入口       |
| -------------------------------- | ------------------ | -------------------- |
| `matrix-js-sdk/room`             | 1458-1460          | `./room`             |
| `matrix-js-sdk/media`            | 1462-1464          | `./media`            |
| `matrix-js-sdk/presence`         | 1474-1476          | `./presence`         |
| `matrix-js-sdk/device`           | 1743-1745          | `./device`           |
| `matrix-js-sdk/device-keys`      | 1482-1570          | `./device-keys`      |
| `matrix-js-sdk/key-backup`       | 1572-1699          | `./key-backup`       |
| `matrix-js-sdk/key-verification` | 1701-1729          | `./key-verification` |
| `matrix-js-sdk/telemetry`        | 1747-1789          | `./telemetry`        |
| `matrix-js-sdk/dm`               | 1795-1849          | `./dm`               |
| `matrix-js-sdk/friend`           | 1851-1921          | `./friend`           |

### 4.3 不存在的子路径声明（2 个，建议 hula 复核）

| 子模块块                    | augmentations 行号 | 问题                             |
| --------------------------- | ------------------ | -------------------------------- |
| `matrix-js-sdk/message`     | 1466-1469          | SDK src 内无 `message/` 目录     |
| `matrix-js-sdk/credentials` | 1478               | SDK src 内无 `credentials/` 目录 |

**建议**：hula 复核这两个块是否仍在使用，若否直接删除。

---

## 5. 关键发现

1. **SDK 入口利用率 50%**：54 个 exports 入口中 27 个被 hula 使用、27 个零使用。零使用入口中 24 个属合理保留（业务未启用 / 内部分层 / 工具可选），**3 个 `./src/*` 深路径冗余入口应在 SDK 端清理**（`./src/manager-extensions`、`./src/filter`、`./src/telemetry`），属 D.3 复核遗漏项。

2. **深路径违规仅在类型层**：hula 5 处深路径引用全部在 `.d.ts` 中，运行时零违规。其中 `MatrixClientExtensionMethods`（2 处）需要 SDK 补导出后才能修复，其余 3 处 hula 可直接改为公开入口。

3. **SDK 补导出需求仅 10 项**：相比 augmentations 1921 行的体量，真正需要 SDK 补的只有 7 个子路径 + 3 个主入口透出类型 + 1 个深路径关联类型。这 11 项**列为计划**，由 G 阶段联调时一次性实施。

4. **augmentations 与 SDK 严重不同步**：60+ 项主模块块类型在 SDK 已导出，其中 20+ 项形状不一致（标 ⚠️），特别是 `LoginResponse.expires_in` vs SDK `expires_in_ms`、`EventType` 缺失几十个新事件、`PushRuleAction` 类型定义完全不同 —— 这些可能在严格类型检查下引发隐蔽 bug，是 G 阶段 hula 清理的高优先级项。

5. **hula 业务专属扩展约 50+ 项**：分布在 MatrixClient 接口合并、IM 同步 DTO、消息编辑/回复/线程、设备管理、用户目录、第三方协议、群组/社区、VoIP、命名风格不一致等 9 大类。其中"命名风格不一致"（如 hula `LoginRequest` vs SDK `LoginRequest`、hula `Device` vs SDK `IDevice`）应作为 G 阶段命名对齐的重点。

---

## 6. 阶段传递

| 接收阶段                   | 传递内容                                                                          | 形式                                             |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| **F.2**                    | 本文档完整内容 + sdk_commit `6ad01fb32`                                           | 交接文档 `handoff-sdk-to-frontend.md`            |
| **G（hula）**              | 清单 B 5 处深路径修复 + 清单 4 augmentations 冗余清理 + 清单 4.3 不存在子路径复核 | hula G 阶段任务列表                              |
| **G（hula）联调时**        | 清单 C 10 项 SDK 补导出实施决策                                                   | SDK 端一次性补导出 + hula augmentations 同步清理 |
| **D.3 复核（SDK 端补做）** | 清单 1.2.4 的 3 个 `./src/*` 深路径 exports 清理                                  | SDK 单独提交（可纳入 F.2 或 G 阶段）             |

---

## 附录 A：augmentations.d.ts 总体结构

- **文件**：`hula/src/types/matrix-js-sdk-augmentations.d.ts`（1921 行）
- **declare module 块**：20 个
    - 1 个主模块块（行 7-1439）
    - 19 个子路径模块块（行 1441-1921）
        - 9 个仅声明 `extendMatrixClient` 的"存根"块（account、auth、capabilities、credentials、room、media、message、profile、presence、sending、qr-login）
        - 8 个含完整类型的"富类型"块（device-keys、key-backup、key-verification、crypto-keys、device、telemetry、dm、friend）

### 主模块块内声明统计

| 类别                               | 数量                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `export const`                     | 4                                                                                                  |
| `export enum`                      | 10                                                                                                 |
| `export type`                      | 6                                                                                                  |
| `export interface`（独立类型）     | ~64                                                                                                |
| `export interface`（接口合并扩展） | 8（MatrixClient、MatrixEvent、Room、RoomMember、User、RoomState、EventTimelineSet、EventTimeline） |
| `export class`                     | 8                                                                                                  |
| `export function`                  | 6                                                                                                  |
