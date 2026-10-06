# SDK 封装完善梳理与实施计划（2026-10-06）

> 输入：`artifacts/route-contract-encapsulation-report-2026-10-06.md`（ROUTE_CONTRACT.md 1159 条 × SDK 三级证据对账）
> 目标：把「未封装」165 条逐条判定为 **应封装 / 不应封装 / 需产品决策**，给出可核验依据，并按判定落地实现。
> 方法：每条都回到**后端源码 + SDK 源码 + 契约表**三处取证，不接受「报告标签」直接下结论。

---

## 0. 结论一句话

165 条未封装中，**真正应封装的只有 10 条**（客户端面、无别名、无替代、有产品价值）；
其余 **155 条**分四类：**已封装的别名 / 旧路径 / 孪生 / 浏览器流**（45）、**工具盲区误报**
（25，实际已封装，仅静态审计无法归属）、**架构排除**（S2S/AS/根级，50）、
**admin 运维面**（35，本 fork 有意封装，单列待产品决策）。

> **与上游对账报告的换算关系**（避免两个口径混淆）：报告的 165 = 服务端/内部面 42 +
> 根级遗留 8 + admin 35 + 客户端面 80，其中客户端面 80 = 真缺口 46 + 工具盲区假阳性 10 +
> 运行时版本族 15 + 尾斜杠孪生 1 + 浏览器流 8。本轮把「真缺口 46」逐条回源码复核，
> **其中 36 条实为别名 / 已废弃旧路径 / 已实现的稳定版变体**，真正缺口收敛为 **10 条**；
> 并把「运行时版本族 15」归入工具盲区类（同为「已封装但静态不可归属」）。
> 复核后的自洽分解：**10 应封装 + 155 不应封装 = 45 + 25 + 50 + 35**。

---

## 1. 判定口径（判断依据的来源）

| 判据              | 含义                                                     | 取证方式                                                                         |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **G1 无别名**     | 同一能力后端只注册这一条路径                             | 在 ROUTE_CONTRACT 全量路径里搜「同能力不同路径」                                 |
| **G2 无替代**     | SDK 现有方法中没有覆盖该能力的实现                       | Grep 全 `src/`（**用专用检索工具**，不用裸 grep 的 `\|`，toybox 下会静默返回空） |
| **G3 客户端面**   | 路径在 `/_matrix/client/**` 或 `/_synapse/**` 且非 admin | 路径前缀 + `registered_by`                                                       |
| **G4 有产品价值** | 有真实调用场景（本 fork 功能或标准 API）                 | 后端 handler 语义 + 项目业务                                                     |

**只有 G1∧G2∧G3∧G4 同时成立，才判「应封装」。**

---

## 2. 应封装清单（10 条，本轮实现）

### 2.1 notifications 模块 —— `src/notifications/index.ts`

| 端点                                                 | 拟新增方法                       | 后端 handler（synapse-web/src/routes/push_notification.rs）                                                                      |
| ---------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /_matrix/client/v3/push/devices`                | `getPushDevices()`               | 列出已注册推送设备                                                                                                               |
| `POST /_matrix/client/v3/push/devices`               | `registerPushDevice(body)`       | `register_device`：`device_id`/`push_token`/`push_type`/`app_id`/`platform`/`platform_version`/`app_version`/`locale`/`timezone` |
| `DELETE /_matrix/client/v3/push/devices/{device_id}` | `unregisterPushDevice(deviceId)` | `unregister_device`                                                                                                              |
| `POST /_matrix/client/v3/push/send`                  | `sendPushNotification(body)`     | `send_notification`：`title`/`body`/`data`/`priority`/`notification_type`/`room_id`/`event_id`                                   |

**依据**：G1 ✅（`push/devices`、`push/send` 为 fork 独有，无同能力别名）；G2 ✅（全仓无调用）；G3 ✅（client 命名空间，`registered_by: push_notification`）；G4 ✅（**移动端推送令牌注册**是 Tauri Android 端必需能力，与项目「多端交付」目标直接相关）。

**附带收益**：`src/notifications/__generated__/route-table.ts` 目前**没有任何手写文件引用**（与 `cas` 同类的「有表没人读」），补这 4 个方法后该表转为**真实被消费**，可移除门禁里 `push_notification` 的 waiver。

**结构说明**：`np()` 助手由「只断言 `PushPath`」改为「断言 `PushPath | NotificationsPath`」——
因为该 manager 同时负责 push.rs（`/notifications`）与 push_notification.rs（`/push/devices`）两个 ledger 模块，union 与本仓 `RoomManager` 的多表并集写法一致。

### 2.2 VoIP —— `src/turn-server/index.ts`

| 端点                                           | 拟新增方法                   | 说明                         |
| ---------------------------------------------- | ---------------------------- | ---------------------------- |
| `GET /_matrix/client/v3/voip/config`           | `getVoipConfig()`            | VoIP 全局配置（TURN 策略等） |
| `GET /_matrix/client/v3/voip/turnServer/guest` | `getGuestTurnServerConfig()` | 访客（未登录）TURN 凭据      |

**依据**：G1 ✅；G2 ✅（`getTurnServerConfig()` 只覆盖 `/voip/turnServer`，**未覆盖 `config` 与 `guest` 变体**）；G3 ✅；G4 ✅（WebRTC 通话能力，`client-voip-group-call.ts` 已存在）。

**附带收益**：`turn-server` 目前**完全没有契约断言**（`path: "/voip/turnServer"` 是裸字面量）。本轮为它引入 `vp()` 助手并**回填既有方法**，使该模块首次进入契约约束。

**契约归属说明**：voip 路由在 ledger 归 `assembly` 模块，本仓已把 `assembly → auth` 映射（见审计文档 §13.14），故断言落在 `AuthPath`。属**跨模块归属**，与 `RoomManager` 引 `SearchPath`/`ModerationPath` 的既有约定一致。

### 2.3 房间密钥列表 —— `src/room-summary/sub-managers/room-key-manager.ts`

| 端点                                          | 拟新增方法            | 说明                       |
| --------------------------------------------- | --------------------- | -------------------------- |
| `GET /_matrix/client/v3/rooms/{room_id}/keys` | `getRoomKeys(roomId)` | 房间密钥**列表**（裸端点） |

**依据**：G1 ✅；G2 ✅（`RoomSummaryKeyManager` 已实现 `keys/claim`、`keys/count`、`keys/version`，**唯独裸 `keys` 缺**；同族端点已在同一 manager，归属无争议）；G3 ✅；G4 ✅（密钥巡检/导出场景）。

**结构说明**：**不放在 `RoomManager`**——房间密钥族端点已由 `RoomSummaryKeyManager` 统一承担（职责分明），新增同族方法应就近归位。

### 2.4 RoomManager —— `src/room/RoomManager.ts`

| 端点                                           | 拟新增方法                      | 说明                                                          |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `GET /_matrix/client/v3/user/{user_id}/rooms`  | `getUserRooms(userId)`          | 按用户列出其房间                                              |
| `GET /_matrix/client/v1/user/mutual_rooms`     | `getMutualRooms(userId, opts?)` | **v1 稳定版**（现有实现只走 unstable `uk.half-shot.msc2666`） |
| `POST /_matrix/client/v3/rooms/create_private` | `createPrivateRoom(opts)`       | fork 私有「创建私聊房间」                                     |

**依据**：

- `user/{user_id}/rooms`：G1 ✅ G2 ✅ G3 ✅（契约表在 `room/__generated__`）G4 ✅
- `mutual_rooms` v1：G1 ✅（v1 与 unstable 是**两个不同租约**，后端都注册）；G2 ✅（`server-capabilities/index.ts:424` 只走 unstable）；G3+G4 ✅
- `create_private`：G1 ✅ G2 ✅（全仓无调用）G3 ✅ G4 ✅（**fork 私有核心能力，无替代**；`createRoom` 是通用入口，不含「私聊」快捷语义）

---

## 3. 不应封装清单（155 条，逐类注明依据）

### 3.1 已封装的「别名 / 旧路径 / 孪生 / 浏览器流」（45 条）—— 这是本轮最重要的鉴别

| 端点 / 类                                                 | 条数 | 判定                    | 可核验依据                                                                                                                                                       |
| --------------------------------------------------------- | ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PUT /rooms/{room_id}/visibility`                     | 2    | **旧路径，非新能力**    | Matrix 中已被 `/directory/list/room/{roomId}` 取代；SDK 的 `getRoomDirectoryVisibility`/`setRoomDirectoryVisibility`（`RoomManager.ts:946/958`）打的正是规范路径 |
| `POST /v3/invite/{room_id}`                               | 1    | legacy 别名             | SDK 走 `/rooms/{room_id}/invite`                                                                                                                                 |
| `GET /friends/request/received`（client/v1 + vendor/v1）  | 2    | 别名                    | 代码内已注明：**「后端两个路径都返回 200…现统一使用 route_ledger 规范路径 `/friends/requests/incoming`」**（`friend-request-manager.ts:237-245`）                |
| 密钥备份 `/{v1,v3}/room_keys/{version}/keys*`             | 18   | 同能力的**路径段变体**  | SDK 的 `makeKeyBackupPath()` 用**查询参数** `?version=` 表达版本（`key-backup-paths.ts`），与规范一致；版本作路径段属后端另一租约                                |
| MSC4108 unstable `rendezvous/{session_id}` GET/PUT/DELETE | 3    | 旧编号变体              | v1 稳定版**已实现**（`RendezvousManager.getSession/updateSession/deleteSession`，配 `rp()` 断言）；文档中 Rendezvous 模块 6/6 已覆盖                             |
| MSC4155/4156 unstable `threads`                           | 2    | 旧编号变体              | v1 稳定版 threads 已实现（21 条端点有证据）                                                                                                                      |
| `POST /v1/rooms/create_private`                           | 1    | v3 的并行租约           | 本轮实现 v3 租约即覆盖该能力                                                                                                                                     |
| 浏览器/邮件/IdP 流（SSO 重定向、OIDC 发现、submitToken）  | 8    | 浏览器流，非 SDK 调用方 | SDK 已封 `login/sso/redirect`、`register/email/submitToken`                                                                                                      |
| 尾斜杠孪生 `pushrules/`                                   | 1    | 同能力孪生注册          | 与 `/pushrules` 重复                                                                                                                                             |
| AppService proxy `{*path}`                                | 7    | 通配代理                | 无 codegen 表、无客户端场景；与已排除的 `/_matrix/app/v1/proxy/**` 同源                                                                                          |

> 合计 45 条（2+1+2+18+3+2+1+8+1+7）。另 15 条「媒体运行时版本族」同属「已封装但静态不可归属」，
> 归入 §3.3 工具盲区类。

### 3.2 架构排除（50 条）

| 类                                                  | 条数 | 依据                                                                 |
| --------------------------------------------------- | ---- | -------------------------------------------------------------------- |
| S2S 联邦协议 `/_matrix/federation/*`                | 30   | 服务器间协议，客户端无调用方；文档单列「联邦」模块                   |
| AS→HS 回调 `/_matrix/app/v1/*`                      | 12   | appservice 实现侧回调，由 AS 服务消费                                |
| 根级探活/遗留（`/`、`/health`、`/admin/services*`） | 8    | 文档「前缀之外」节声明为有意的根级注册；SDK 实际走 `/_synapse/cas/*` |

### 3.3 工具盲区误报（25 条）—— **实际已封装**，只是审计工具无法静态归属

| 类                                                 | 条数 | 已封装位置 / 盲区成因                                            |
| -------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| CAS `p3/serviceValidate`、`proxy`、`proxyValidate` | 3    | prefix 为**运行时变量**（`resolvePath` 二元拼接），静态不可归属  |
| `room_summary` 3 条                                | 3    | 经 `internalSummaryPath` **helper 中转**构造路径                 |
| 泛型 `send/{event_type}` 4 条                      | 4    | 事件类型为**泛型参数**，路径不能静态枚举                         |
| 媒体 download/thumbnail/preview_url（r0/r1/v1/v3） | 15   | `src/media/index.ts:452`、`content-repo.ts` 在**运行时拼版本段** |

> 本轮已逐条核验源码确认（详见对账报告 §3.2）。**这 25 条不是缺口。**

---

## 4. 需产品决策（35 条，本轮不实现）

**admin 运维面未封装 35 条**。本 fork 的 `AdminManager` **有意**封装 admin API
（`adminRequest` 调用点 281 处，解析出 211 条 admin 路由），故不能按上游口径排除。

- 未封 35 条分布：`admin/media.rs` 16、`cas.rs` 5、`external_service.rs` 5、`push_notification.rs` 4、
  `admin/room/mod.rs` 2、`admin/server.rs` 2、`app_service.rs` 1。
- **建议**：按产品是否需要「媒体隔离/清理」「外部服务管理」「推送队列运维」再决定是否补齐。
  本轮聚焦「客户端面真缺口」10 条，admin 面保持现状并单列。

---

## 5. 实施计划（按批次，结构清晰、职责分明）

| 批次 | 模块                                                | 内容                                                      | 契约断言                                  |
| ---- | --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| B1   | `src/notifications/index.ts`                        | push/devices ×3 + push/send                               | `PushPath \| NotificationsPath`（union）  |
| B2   | `src/turn-server/index.ts`                          | voip/config + voip/turnServer/guest（并回填既有方法断言） | `StripV3<AuthPath>`                       |
| B3   | `src/room-summary/sub-managers/room-key-manager.ts` | rooms/{room_id}/keys                                      | `StripV3<RoomSummaryPath>`（既有 `_rsv`） |
| B4   | `src/room/RoomManager.ts`                           | user/{user_id}/rooms + mutual_rooms(v1) + create_private  | `rp()`（既有 RoomManagerPath）            |

**验收标准**：`tsc --noEmit` 0 错；新增方法全部带契约断言（路径拼错 = 编译错误）；
每个方法有 JSDoc + 入参校验；`manager-codegen` 门禁中 `notifications` 由 waived 转 covered 且无 unused waiver。

---

## 6. 与对账报告的口径修正（本梳理纠正了报告的 3 处粗判）

1. 报告把 `rooms/{room_id}/visibility` 列为「真缺口」——**实为已废弃旧路径**，规范能力已封装。
2. 报告把 friends `request/received` 列为「真缺口」——**实为别名**，代码内已有明确取舍注释。
3. 报告把 MSC4108 `rendezvous` 3 条列为「真缺口」——**v1 稳定版已实现**（`RendezvousManager`）。

> 教训：报告基于**静态路径字面量匹配**，对「别名 / 旧路径 / helper 中转 / 运行时插值」天然不敏感；
> 落地前必须回到源码逐条核验——这正是本轮梳理的核心价值。

---

**生成方式**：ROUTE_CONTRACT.md 全量路径检索 + SDK 全仓取证（Grep 专用工具）+ 后端 handler 阅读（`synapse-web/src/routes/push_notification.rs` 等）。
