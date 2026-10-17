# SDK 契约缺口报告：后端路由 ↔ SDK 封装面

> 生成时间：2026-10-17 22:38:34
> 后端事实来源：`synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json`（RouteLedger schema v4，profile=`all`）
> SDK 镜像底座：`docs/api-contract/generated/route-manifest.all.json` @ `c7c9116d`
> 生成器：`matrix-js-sdk/scripts/audit/compare-routes.mjs`（可重跑，无人工维护的映射表）

## 0. 方法论：为什么"后端有 / SDK 未封装"需要三级证据

本仓存在**多层**容易互相冒充的"路由集合"：

| 层           | 载体                                                                                        | 能回答                            | **不能**回答                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| 后端事实面   | synapse-rust `RouteLedger` 导出（`ledger_export_sdk/all.json`）                             | 服务端真实注册的 `(method, path)` | SDK 是否封装                                                                                       |
| SDK 镜像底座 | `docs/api-contract/generated/route-manifest.all.json`                                       | SDK 侧 ledger 副本是否同步        | 是否封装（纯副本，逐字节镜像）                                                                     |
| L1 声明面    | `src/**/__generated__/route-table.ts`                                                       | codegen 渲染出了哪些路由常量      | **有没有调用方**——本仓 12 个模块被门禁标注 `WAIVED / no route-table consumer`，即「有表 ≠ 有人读」 |
| L2 调用面    | `src/**/*.ts` 的 `(prefix, path)` 调用点                                                    | **真实发起过请求的路由**          | 路径来自构造器函数时抓不到                                                                         |
| L3 构造面    | 路径构造器返回的字面量（`utils.encodeUri("/profile/$userId")`、`buildSecureBackupPath` 等） | 该路由被 SDK 主动构造过           | 无 caller；构造时前缀未必等于调用时前缀                                                            |

因此覆盖率**分两个口径**给，且"缺口"只认三级证据全无：

| 口径         | 定义                                     | 用途                                 |
| ------------ | ---------------------------------------- | ------------------------------------ |
| 声明面覆盖率 | 后端 distinct 路由 ∩ route-table 声明    | 底座健康度（codegen 是否跟得上后端） |
| 实现面覆盖率 | 后端客户端面路由 ∩ (T1 调用点 ∪ T2 构造) | **SDK 真实封装度**（本报告主指标）   |

**L2 解析器覆盖的惯用法**：

| 惯用法                                | 条数 |
| ------------------------------------- | ---- |
| `object-literal {path}`               | 86   |
| `builder: utils.encodeUri()`          | 52   |
| `authedRequest(Method, path)`         | 27   |
| `builder: friendPath()`               | 23   |
| `builder: encodeUri()`                | 17   |
| `builder: spacePath()`                | 13   |
| `builder: sp()`                       | 10   |
| `adminRequest()`                      | 6    |
| `v2Request()`                         | 5    |
| `builder: srp()`                      | 3    |
| `builder: this.client.http.getUrl()`  | 3    |
| `request(Method, path)`               | 2    |
| `builder: this.internalSummaryPath()` | 2    |
| `builder: this.getUrl()`              | 1    |
| `builder: this.roomPath()`            | 1    |

**口径边界（诚实声明）**

- 版本前缀**不**互替：`v1` / `v3` / `r0` / `unstable` 视为不同租约，避免把 v1 与 v3 误判为同一端点。
- L2 只解析**字面量/纯字面量拼接**路径；变量路径（`authedRequest(Method.Get, path)`）无法静态求值，由 L3 兜底。
- L3 按 `BaseManager.KNOWN_PREFIXES` + prefix.ts 枚举共 **31** 个候选前缀逐个尝试拼接，因此 **L3 命中不保证前缀正确**，仅证明"这条路径被构造过"。
- L3 **不校验 HTTP method**（路径级证据），故 T2 桶里可能包含同一路径的不同 method 变体。
- 因此 **T2 是强证据、但不是"已接通"的证明**；T3 是弱证据。本报告的"缺口"= 三者全无——**不会把已封装路由漏报为缺口**，但存在把"构造了却没接通"记为已实现的风险，已在 §3 单列待人工确认。

---

## 1. 结论速览

| 维度                                  | 数量                  | 说明                                                     |
| ------------------------------------- | --------------------- | -------------------------------------------------------- |
| 后端注册路由（事实面）                | **1038**              | distinct 1033                                            |
| └ 客户端面 `CLIENT_FACING`            | **641**               | 前端 SDK 应封装的面                                      |
| └ 服务端/运维面 `SERVER_ONLY`         | 394                   | federation / appservice / key 交换 / admin，**不应**封装 |
| └ 根级与 SSO `ROOT_OR_SSO`            | 2                     | 探活、CAS/SSO 重定向，浏览器处理                         |
| └ 非 Matrix 命名空间 `NON_NAMESPACED` | 1                     | —                                                        |
| **实现面覆盖（T1∪T2，客户端面）**     | **589 / 641 = 91.9%** | 主指标                                                   |
| └ 其中 T1 有真实调用点                | 78                    | 最强证据                                                 |
| └ 其中 T2 仅构造证据                  | 511                   | 见 §3 需复核                                             |
| **声明面覆盖（T3，全后端）**          | **95.2%**             | 983/1033                                                 |
| **缺口（三级证据全无）**              | **30**                | 其中客户端面 0                                           |
| 版本/前缀漂移                         | 0                     | 签名相同、前缀不同                                       |

### 1.1 后端路由的证据分布（全量）

| 证据等级      | 条数 | 含义                             |
| ------------- | ---- | -------------------------------- |
| T1 调用点命中 | 118  | Manager 真实发起请求             |
| T2 构造命中   | 810  | 有路径构造器，无精确调用点       |
| T3 仅声明     | 79   | route-table 有常量、仓内无调用方 |
| 漂移          | 0    | 末段签名一致、前缀/版本不同      |
| 缺口          | 30   | 三级证据全无                     |

### 1.2 处置清单（按优先级）

| 优先级 | 动作                                                         | 为什么                                                                                                                                  | 验证方式                                               |
| ------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| **P0** | 刷新 SDK 底座：`pnpm contract:sync && pnpm contract:codegen` | SDK 镜像已落后后端 **2** 条（镜像停留在 `c7c9116d`）。底座不刷新时，codegen 渲染的 route-table 与"真相"不一致，任何覆盖率数字都不可信。 | 重跑本脚本，§1.4 归零                                  |
| **P1** | 补 0 条客户端面真缺口（§2）                                  | 已被人工核实为「后端有、SDK 完全无」。其中 `admin/room/{id}/redact` 属运维面，可先确认是否由前端直连。                                  | 补完后 §2 归零；`pnpm quality:manager-codegen` 仍绿    |
| **P1** | 对照 Sprint 4 交付范围核实 MSC4155 / MSC4156（§7）           | 两个不稳定端点在本仓 `src` 中 **0 命中**，与「Sprint 4 已交付」的记忆不一致；需确认是只交付了后端，还是前端走了 `relations` 自建实现。  | `grep -rn "msc4155\\                                   | msc4156" src --include='\*.ts' \| grep -v **generated**` |
| **P2** | 清理 §3 的 511 条 T2 弱证据                                  | 这些端点只有构造点、没有可静态求值的调用点，混着「变量路径（真已封装）」与「死构造器（真问题）」两类。                                  | 按 §3 结论逐模块抽查，把确认已封装的补进 §7 人工复核表 |
| **P3** | 把 §7 人工复核结论回写进 `contract-module-map`/审计文档      | 让下轮审计不必重复人工判断；同时 §7.1 的解析器盲区可作为下一版生成器的待办。                                                            | 本轮结束后重跑，§7 结论与 §2/§3.5 不冲突               |

### 1.3 缺口按范围拆分（决定该不该补）

| 范围          | 条数   | 是否应在 SDK 封装     |
| ------------- | ------ | --------------------- |
| `SERVER_ONLY` | **30** | ❌ 否 — 服务端/运维面 |

### 1.4 底座漂移（后端已注册、SDK 镜像未收录）

SDK 镜像落后后端 **2** 条（镜像 1036 条 @ `c7c9116d`，`generated_at=2026-05-02T00:00:00Z`）。
后果：这些路由在 SDK 侧连**声明**都没有，codegen 也渲染不出来。修复：`pnpm contract:sync && pnpm contract:codegen`。

| 后端模块      | 条数 |
| ------------- | ---- |
| `app_service` | 2    |

<details><summary>展开逐条（2 条）</summary>

| Method | Path                                                               | registered_by | 范围            |
| ------ | ------------------------------------------------------------------ | ------------- | --------------- |
| `POST` | `/_matrix/client/unstable/io.element.msc4512/appservice/fed_proxy` | `app_service` | `CLIENT_FACING` |
| `POST` | `/_matrix/client/v1/appservice/fed_proxy`                          | `app_service` | `CLIENT_FACING` |

</details>

---

## 2. 客户端面缺口（三级证据全无）— 0 条

✅ 客户端面路由均有至少一级证据。

---

## 3. 仅构造证据（T2，无精确调用点）— 客户端面 511 条

这些路由在 `src` 里有路径构造器，但解析器**没有**看到把对应前缀用上去的调用点。两种可能：
(a) 调用点路径是变量（L2 无法静态求值）→ **实际已封装**，属解析误报；
(b) 构造器是死代码，或构造前缀与调用前缀不一致 → **真问题**。
**必须逐个开源码确认后再定性**，不要直接当缺口补。

> ⚠️ **证据强度**：`构造证据` 列给出的是**产生命中的那条字面量**。它可能只是与前缀拼出了恰好相等的路径
> （例：字面量 `/config` + 前缀 `/_matrix/media/v3` → `/_matrix/media/v3/config`），并不代表该文件真的在看这个端点。
> 标 ⚠️ 的行就是**单段字面量**，属弱证据，核实时请以路径末段签名是否吻合为准。

按后端模块分布：

| 后端模块             | 条数 |
| -------------------- | ---- |
| `room`               | 87   |
| `assembly`           | 58   |
| `key_backup`         | 46   |
| `friend_room`        | 28   |
| `space`              | 26   |
| `e2ee`               | 23   |
| `thread`             | 21   |
| `room_summary`       | 18   |
| `widget`             | 16   |
| `push`               | 15   |
| `account_data`       | 15   |
| `voice`              | 12   |
| `media`              | 11   |
| `presence`           | 9    |
| `relations`          | 9    |
| `search`             | 8    |
| `saml`               | 8    |
| `oidc`               | 7    |
| `cas`                | 7    |
| `key_rotation`       | 7    |
| `burn_after_read`    | 7    |
| `rendezvous`         | 6    |
| `moderation`         | 6    |
| `device`             | 6    |
| `typing`             | 5    |
| `thirdparty`         | 5    |
| `dm`                 | 5    |
| `sliding_sync`       | 4    |
| `dehydrated_device`  | 4    |
| `delayed_events`     | 4    |
| `tags`               | 4    |
| `push_notification`  | 4    |
| `invite_blocklist`   | 4    |
| `app_service`        | 3    |
| `guest`              | 3    |
| `captcha`            | 3    |
| `external_service`   | 3    |
| `msc4108_rendezvous` | 1    |
| `sync`               | 1    |
| `ephemeral`          | 1    |
| `reactions`          | 1    |

<details><summary><code>room</code> — 87 条</summary>

| Method   | Path                                                                                     | 构造证据                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events`              | `src/room-summary/sub-managers/room-event-operation-manager.ts:944` (/rooms/$roomId/sticky_events)                  |
| `POST`   | `/_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events`              | `src/room-summary/sub-managers/room-event-operation-manager.ts:944` (/rooms/$roomId/sticky_events)                  |
| `DELETE` | `/_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events/{event_type}` | `src/room-summary/sub-managers/room-event-operation-manager.ts:991` (/rooms/$roomId/sticky_events/$eventType)       |
| `GET`    | `/_matrix/client/unstable/uk.half-shot.msc2666/user/mutual_rooms`                        | `src/server-capabilities/index.ts:536` (/uk.half-shot.msc2666/user/mutual_rooms)                                    |
| `GET`    | `/_matrix/client/v1/rooms/{room_id}/state/m.room.power_levels/`                          | `src/room-summary/sub-managers/room-event-operation-manager.ts:1010` (/rooms/$roomId/state/m.room.power_levels/)    |
| `PUT`    | `/_matrix/client/v1/rooms/{room_id}/state/m.room.power_levels/`                          | `src/room-summary/sub-managers/room-event-operation-manager.ts:1010` (/rooms/$roomId/state/m.room.power_levels/)    |
| `POST`   | `/_matrix/client/v3/createRoom`                                                          | ⚠️ `src/http-api/fetch.ts:139` (/createRoom)                                                                        |
| `POST`   | `/_matrix/client/v3/join/{room_id_or_alias}`                                             | `src/room/RoomManager.ts:556` (/join/{})                                                                            |
| `POST`   | `/_matrix/client/v3/knock/{room_id_or_alias}`                                            | `src/room/RoomManager.ts:601` (/knock/{})                                                                           |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}`                                                     | `src/admin/sub-managers/admin-room-manager.ts:188` (/rooms/{})                                                      |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/account_data/{type}`                                 | `src/room/RoomManager.ts:1502` (/rooms/$roomId/account_data/$type)                                                  |
| `PUT`    | `/_matrix/client/v3/rooms/{room_id}/account_data/{type}`                                 | `src/room/RoomManager.ts:1502` (/rooms/$roomId/account_data/$type)                                                  |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/ban`                                                 | `src/room-member/index.ts:153` (/rooms/$roomId/ban)                                                                 |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/event/{event_id}`                                    | `src/client-batch-requests.ts:68` (/rooms/$roomId/event/$eventId)                                                   |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/forget`                                              | `src/client-membership.ts:54` (/rooms/$room_id/forget)                                                              |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/initialSync`                                         | `src/client-batch-requests.ts:119` (/rooms/$roomId/initialSync)                                                     |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/invite`                                              | `src/client-membership.ts:43` (/rooms/$roomId/invite)                                                               |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/join`                                                | `src/admin/sub-managers/admin-room-manager.ts:903` (/rooms/{}/join)                                                 |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/joined_members`                                      | `src/client-batch-requests.ts:91` (/rooms/$roomId/joined_members)                                                   |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/kick`                                                | `src/client-membership.ts:62` (/rooms/$roomId/kick)                                                                 |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/leave`                                               | `src/room/RoomManager.ts:650` (/rooms/{}/leave)                                                                     |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/members`                                             | `src/client-batch-requests.ts:83` (/rooms/$roomId/members?)                                                         |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/messages`                                            | `src/client-timeline-requests.ts:7` (/rooms/$roomId/messages)                                                       |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/read_markers`                                        | `src/client-batch-requests.ts:103` (/rooms/$roomId/read_markers)                                                    |
| `PUT`    | `/_matrix/client/v3/rooms/{room_id}/read_markers`                                        | `src/client-batch-requests.ts:103` (/rooms/$roomId/read_markers)                                                    |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/receipt/{receipt_type}/{event_id}`                   | `src/client-receipt-requests.ts:27` (/rooms/$roomId/receipt/$receiptType/$eventId)                                  |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/redact/{event_id}/{txn_id}`                          | `src/client-send-paths.ts:37` (/rooms/$roomId/redact/$redactsEventId/$txnId)                                        |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/send/{event_type}/{txn_id}`                          | `src/client-send-paths.ts:43` (/rooms/$roomId/send/$eventType/$txnId)                                               |
| `PUT`    | `/_matrix/client/v3/rooms/{room_id}/send/{event_type}/{txn_id}`                          | `src/client-send-paths.ts:43` (/rooms/$roomId/send/$eventType/$txnId)                                               |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/state`                                               | `src/client-batch-requests.ts:39` (/rooms/$roomId/state)                                                            |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/state/m.room.power_levels/`                          | `src/room-summary/sub-managers/room-event-operation-manager.ts:1010` (/rooms/$roomId/state/m.room.power_levels/)    |
| `PUT`    | `/_matrix/client/v3/rooms/{room_id}/state/m.room.power_levels/`                          | `src/room-summary/sub-managers/room-event-operation-manager.ts:1010` (/rooms/$roomId/state/m.room.power_levels/)    |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/state/{event_type}`                                  | `src/client-batch-requests.ts:51` (/rooms/$roomId/state/$eventType)                                                 |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/state/{event_type}`                                  | `src/client-batch-requests.ts:51` (/rooms/$roomId/state/$eventType)                                                 |
| `PUT`    | `/_matrix/client/v3/rooms/{room_id}/state/{event_type}`                                  | `src/client-batch-requests.ts:51` (/rooms/$roomId/state/$eventType)                                                 |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/state/{event_type}/`                                 | `src/client-batch-requests.ts:51` (/rooms/$roomId/state/$eventType)                                                 |
| `PUT`    | `/_matrix/client/v3/rooms/{room_id}/state/{event_type}/`                                 | `src/client-batch-requests.ts:51` (/rooms/$roomId/state/$eventType)                                                 |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/state/{event_type}/{state_key}`                      | `src/client-send-paths.ts:31` (/rooms/$roomId/state/$eventType/$stateKey)                                           |
| `PUT`    | `/_matrix/client/v3/rooms/{room_id}/state/{event_type}/{state_key}`                      | `src/client-send-paths.ts:31` (/rooms/$roomId/state/$eventType/$stateKey)                                           |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/threads/{thread_id}`                                 | `src/room-summary/sub-managers/room-thread-manager.ts:131` (/rooms/$roomId/threads/$threadId)                       |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/unban`                                               | `src/client-membership.ts:58` (/rooms/$roomId/unban)                                                                |
| `POST`   | `/_matrix/client/v3/rooms/{room_id}/upgrade`                                             | `src/room/RoomManager.ts:1833` (/rooms/{}/upgrade)                                                                  |
| `POST`   | `/_matrix/vendor/v1/rooms/create_private`                                                | `src/room/RoomManager.ts:497` (/\_matrix/vendor/v1/rooms/create_private)                                            |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/capabilities`                                        | `src/room-summary/sub-managers/room-event-operation-manager.ts:196` (/rooms/$roomId/capabilities)                   |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/convert/{event_id}`                                  | `src/room-summary/sub-managers/room-event-operation-manager.ts:789` (/rooms/$roomId/convert/$eventId)               |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/device/{device_id}`                                  | `src/room-summary/sub-managers/room-event-operation-manager.ts:690` (/rooms/$roomId/device/$deviceId)               |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/encrypted_events`                                    | `src/room-summary/sub-managers/room-key-manager.ts:196` (/rooms/$roomId/encrypted_events)                           |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/event/{event_id}/url`                                | `src/room-summary/sub-managers/room-event-operation-manager.ts:718` (/rooms/$roomId/event/$eventId/url)             |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/event_perspective`                                   | `src/room-summary/sub-managers/room-event-operation-manager.ts:523` (/rooms/$roomId/event_perspective)              |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/external_ids`                                        | `src/room-summary/sub-managers/room-event-operation-manager.ts:479` (/rooms/$roomId/external_ids)                   |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/fragments/{user_id}`                                 | `src/room-summary/sub-managers/room-event-operation-manager.ts:662` (/rooms/$roomId/fragments/$userId)              |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/get_membership_events`                               | `src/room-member/index.ts:225` (/rooms/$roomId/get_membership_events)                                               |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/invites`                                             | `src/room-summary/sub-managers/room-event-operation-manager.ts:291` (/rooms/$roomId/invites)                        |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/keys`                                                | `src/room-summary/sub-managers/room-key-manager.ts:119` (/rooms/$roomId/keys)                                       |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/keys/claim`                                          | `src/room-summary/sub-managers/room-key-manager.ts:69` (/rooms/$roomId/keys/claim)                                  |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/keys/count`                                          | `src/room-summary/sub-managers/room-key-manager.ts:92` (/rooms/$roomId/keys/count)                                  |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/keys/version`                                        | `src/room-summary/sub-managers/room-key-manager.ts:140` (/rooms/$roomId/keys/version)                               |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/keys/{event_id}`                                     | `src/room-summary/sub-managers/room-thread-manager.ts:63` (/rooms/$roomId/keys/$eventId)                            |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/members/recent`                                      | `src/room-summary/sub-managers/room-member-manager.ts:235` (/rooms/$roomId/members/recent)                          |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/membership/{user_id}`                                | `src/room/RoomManager.ts:818` (/rooms/{}/membership/{})                                                             |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/message_queue`                                       | `src/room-summary/sub-managers/room-event-operation-manager.ts:588` (/rooms/$roomId/message_queue)                  |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/metadata`                                            | `src/room-summary/sub-managers/room-event-operation-manager.ts:396` (/rooms/$roomId/metadata)                       |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/notifications`                                       | `src/room-summary/sub-managers/room-event-operation-manager.ts:164` (/rooms/$roomId/notifications)                  |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/permissions`                                         | `src/room-summary/sub-managers/room-event-operation-manager.ts:545` (/rooms/$roomId/permissions)                    |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/receipts/{receipt_type}/{event_id}`                  | `src/room-summary/sub-managers/room-event-operation-manager.ts:315` (/rooms/$roomId/receipts/$receiptType/$eventId) |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/reduced_events`                                      | `src/room-summary/sub-managers/room-event-operation-manager.ts:624` (/rooms/$roomId/reduced_events)                 |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/rendered/`                                           | `src/room-summary/sub-managers/room-event-operation-manager.ts:641` (/rooms/$roomId/rendered/)                      |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/resolve`                                             | `src/room-summary/sub-managers/room-event-operation-manager.ts:562` (/rooms/$roomId/resolve)                        |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/retention`                                           | `src/room-summary/sub-managers/room-event-operation-manager.ts:462` (/rooms/$roomId/retention)                      |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/room_keys/keys`                                      | `src/room-summary/sub-managers/room-key-manager.ts:164` (/rooms/$roomId/room_keys/keys)                             |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/search`                                              | `src/room-summary/sub-managers/room-search-manager.ts:275` (/rooms/$roomId/search)                                  |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/service_types`                                       | `src/room-summary/sub-managers/room-event-operation-manager.ts:607` (/rooms/$roomId/service_types)                  |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/sign/{event_id}`                                     | `src/room-summary/sub-managers/room-event-operation-manager.ts:820` (/rooms/$roomId/sign/$eventId)                  |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/spaces`                                              | `src/room-summary/sub-managers/room-event-operation-manager.ts:496` (/rooms/$roomId/spaces)                         |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/sync`                                                | `src/room-summary/sub-managers/room-event-operation-manager.ts:224` (/rooms/$roomId/sync)                           |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/thread/{event_id}`                                   | `src/room-summary/sub-managers/room-thread-manager.ts:97` (/rooms/$roomId/thread/$eventId)                          |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/timeline`                                            | `src/room-summary/sub-managers/room-event-operation-manager.ts:349` (/rooms/$roomId/timeline)                       |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/translate/{event_id}`                                | `src/room-summary/sub-managers/room-event-operation-manager.ts:754` (/rooms/$roomId/translate/$eventId)             |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/turn_server`                                         | `src/room-summary/sub-managers/room-event-operation-manager.ts:878` (/rooms/$roomId/turn_server)                    |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/unread_count`                                        | `src/room-summary/sub-managers/room-event-operation-manager.ts:370` (/rooms/$roomId/unread_count)                   |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/vault_data`                                          | `src/room-summary/sub-managers/room-event-operation-manager.ts:421` (/rooms/$roomId/vault_data)                     |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/vault_data`                                          | `src/room-summary/sub-managers/room-event-operation-manager.ts:421` (/rooms/$roomId/vault_data)                     |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/verify/{event_id}`                                   | `src/room-summary/sub-managers/room-event-operation-manager.ts:855` (/rooms/$roomId/verify/$eventId)                |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/version`                                             | `src/admin/sub-managers/admin-room-manager.ts:692` (/rooms/{}/version)                                              |
| `POST`   | `/_matrix/vendor/v1/translate`                                                           | ⚠️ `src/room/RoomManager.ts:1316` (/translate)                                                                      |
| `GET`    | `/_matrix/vendor/v1/user/mutual_rooms`                                                   | `src/room/RoomManager.ts:1636` (/user/mutual_rooms)                                                                 |
| `GET`    | `/_matrix/vendor/v1/user/{user_id}/rooms`                                                | `src/room/RoomManager.ts:1594` (/user/{}/rooms)                                                                     |

</details>

<details><summary><code>assembly</code> — 58 条</summary>

| Method   | Path                                                                     | 构造证据                                                                |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `GET`    | `/.well-known/matrix/client`                                             | `src/discovery/index.ts:173` (/.well-known/matrix/client)               |
| `GET`    | `/.well-known/matrix/server`                                             | `src/discovery/index.ts:217` (/.well-known/matrix/server)               |
| `GET`    | `/.well-known/matrix/support`                                            | `src/discovery/index.ts:239` (/.well-known/matrix/support)              |
| `GET`    | `/_matrix/client/unstable/uk.tcpip.msc4133/profile/{user_id}`            | `src/client-profile-requests.ts:25` (/profile/$userId)                  |
| `DELETE` | `/_matrix/client/unstable/uk.tcpip.msc4133/profile/{user_id}/{key_name}` | `src/client-profile-requests.ts:29` (/profile/$userId/$field)           |
| `GET`    | `/_matrix/client/unstable/uk.tcpip.msc4133/profile/{user_id}/{key_name}` | `src/client-profile-requests.ts:29` (/profile/$userId/$field)           |
| `PUT`    | `/_matrix/client/unstable/uk.tcpip.msc4133/profile/{user_id}/{key_name}` | `src/client-profile-requests.ts:29` (/profile/$userId/$field)           |
| `GET`    | `/_matrix/client/v1/account/3pid`                                        | `src/client-profile-requests.ts:136` (/account/3pid)                    |
| `POST`   | `/_matrix/client/v1/account/3pid`                                        | `src/client-profile-requests.ts:136` (/account/3pid)                    |
| `POST`   | `/_matrix/client/v1/account/3pid/add`                                    | `src/client-profile-requests.ts:143` (/account/3pid/add)                |
| `POST`   | `/_matrix/client/v1/account/3pid/bind`                                   | `src/client-profile-requests.ts:147` (/account/3pid/bind)               |
| `POST`   | `/_matrix/client/v1/account/3pid/delete`                                 | `src/client-profile-requests.ts:175` (/account/3pid/delete)             |
| `POST`   | `/_matrix/client/v1/account/3pid/email/requestToken`                     | `src/auth/index.ts:740` (/account/3pid/email/requestToken)              |
| `POST`   | `/_matrix/client/v1/account/3pid/email/submitToken`                      | `src/account/index.ts:54` (/account/3pid/email/submitToken)             |
| `POST`   | `/_matrix/client/v1/account/3pid/unbind`                                 | `src/client-profile-requests.ts:158` (/account/3pid/unbind)             |
| `POST`   | `/_matrix/client/v1/account/deactivate`                                  | `src/account/index.ts:395` (/account/deactivate)                        |
| `POST`   | `/_matrix/client/v1/account/password`                                    | `src/guest/index.ts:341` (/account/password)                            |
| `POST`   | `/_matrix/client/v1/account/password/email/requestToken`                 | `src/password-reset/index.ts:69` (/account/password/email/requestToken) |
| `POST`   | `/_matrix/client/v1/account/password/email/submitToken`                  | `src/account/index.ts:53` (/account/password/email/submitToken)         |
| `GET`    | `/_matrix/client/v1/account/whoami`                                      | `src/auth/index.ts:632` (/account/whoami)                               |
| `GET`    | `/_matrix/client/v1/media/config`                                        | `src/media/index.ts:215` (/media/config)                                |
| `GET`    | `/_matrix/client/v1/profile/{user_id}`                                   | `src/client-profile-requests.ts:25` (/profile/$userId)                  |
| `GET`    | `/_matrix/client/v1/profile/{user_id}/avatar_url`                        | `src/profile/index.ts:147` (/profile/{}/avatar_url)                     |
| `PUT`    | `/_matrix/client/v1/profile/{user_id}/avatar_url`                        | `src/profile/index.ts:147` (/profile/{}/avatar_url)                     |
| `GET`    | `/_matrix/client/v1/profile/{user_id}/displayname`                       | `src/profile/index.ts:148` (/profile/{}/displayname)                    |
| `PUT`    | `/_matrix/client/v1/profile/{user_id}/displayname`                       | `src/profile/index.ts:148` (/profile/{}/displayname)                    |
| `POST`   | `/_matrix/client/v3/account/3pid`                                        | `src/client-profile-requests.ts:136` (/account/3pid)                    |
| `POST`   | `/_matrix/client/v3/account/3pid/email/requestToken`                     | `src/auth/index.ts:740` (/account/3pid/email/requestToken)              |
| `POST`   | `/_matrix/client/v3/account/3pid/email/submitToken`                      | `src/account/index.ts:54` (/account/3pid/email/submitToken)             |
| `POST`   | `/_matrix/client/v3/account/deactivate`                                  | `src/account/index.ts:395` (/account/deactivate)                        |
| `POST`   | `/_matrix/client/v3/account/password/email/requestToken`                 | `src/password-reset/index.ts:69` (/account/password/email/requestToken) |
| `POST`   | `/_matrix/client/v3/account/password/email/submitToken`                  | `src/account/index.ts:53` (/account/password/email/submitToken)         |
| `GET`    | `/_matrix/client/v3/auth/{auth_type}/fallback/web`                       | `src/account/index.ts:463` (/auth/$loginType/fallback/web)              |
| `GET`    | `/_matrix/client/v3/directory/list/room/{room_id}`                       | `src/room/RoomManager.ts:1515` (/directory/list/room/{roomId})          |
| `PUT`    | `/_matrix/client/v3/directory/list/room/{room_id}`                       | `src/room/RoomManager.ts:1515` (/directory/list/room/{roomId})          |
| `GET`    | `/_matrix/client/v3/directory/room/{room_id}/alias`                      | `src/discovery/index.ts:591` (/directory/room/{}/alias)                 |
| `DELETE` | `/_matrix/client/v3/directory/room/{room_id}/alias/{room_alias}`         | `src/discovery/index.ts:612` (/directory/room/{}/alias/{})              |
| `PUT`    | `/_matrix/client/v3/directory/room/{room_id}/alias/{room_alias}`         | `src/discovery/index.ts:612` (/directory/room/{}/alias/{})              |
| `GET`    | `/_matrix/client/v3/login`                                               | ⚠️ `src/account/index.ts:186` (/login)                                  |
| `POST`   | `/_matrix/client/v3/logout/all`                                          | `src/account/index.ts:327` (/logout/all)                                |
| `GET`    | `/_matrix/client/v3/media/config`                                        | `src/media/index.ts:215` (/media/config)                                |
| `GET`    | `/_matrix/client/v3/profile/{user_id}/avatar_url`                        | `src/profile/index.ts:147` (/profile/{}/avatar_url)                     |
| `PUT`    | `/_matrix/client/v3/profile/{user_id}/avatar_url`                        | `src/profile/index.ts:147` (/profile/{}/avatar_url)                     |
| `GET`    | `/_matrix/client/v3/profile/{user_id}/displayname`                       | `src/profile/index.ts:148` (/profile/{}/displayname)                    |
| `PUT`    | `/_matrix/client/v3/profile/{user_id}/displayname`                       | `src/profile/index.ts:148` (/profile/{}/displayname)                    |
| `DELETE` | `/_matrix/client/v3/profile/{user_id}/{key_name}`                        | `src/client-profile-requests.ts:29` (/profile/$userId/$field)           |
| `GET`    | `/_matrix/client/v3/profile/{user_id}/{key_name}`                        | `src/client-profile-requests.ts:29` (/profile/$userId/$field)           |
| `PUT`    | `/_matrix/client/v3/profile/{user_id}/{key_name}`                        | `src/client-profile-requests.ts:29` (/profile/$userId/$field)           |
| `GET`    | `/_matrix/client/v3/register`                                            | ⚠️ `src/admin/sub-managers/admin-server-manager.ts:565` (/register)     |
| `POST`   | `/_matrix/client/v3/register/email/requestToken`                         | `src/auth/index.ts:694` (/register/email/requestToken)                  |
| `POST`   | `/_matrix/client/v3/register/email/submitToken`                          | `src/account/index.ts:52` (/register/email/submitToken)                 |
| `GET`    | `/_matrix/client/v3/rooms/{room_id}/call/{call_id}`                      | `src/room/RoomManager.ts:1292` (/rooms/{}/call/{})                      |
| `POST`   | `/_matrix/client/v3/user_directory/list`                                 | `src/discovery/index.ts:413` (/user_directory/list)                     |
| `GET`    | `/_matrix/client/v3/user_directory/profiles/{user_id}`                   | `src/discovery/index.ts:431` (/user_directory/profiles/{})              |
| `GET`    | `/_matrix/client/v3/voip/config`                                         | `src/turn-server/index.ts:126` (/voip/config)                           |
| `POST`   | `/_matrix/client/v3/voip/turnServer`                                     | `src/client.ts:4335` (/voip/turnServer)                                 |
| `GET`    | `/_matrix/client/v3/voip/turnServer/guest`                               | `src/turn-server/index.ts:151` (/voip/turnServer/guest)                 |
| `GET`    | `/_matrix/server_version`                                                | `src/discovery/index.ts:276` (/\_matrix/server_version)                 |

</details>

<details><summary><code>key_backup</code> — 46 条</summary>

| Method   | Path                                                                    | 构造证据                                                                              |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST`   | `/_matrix/client/v1/room_keys/batch_recover`                            | `src/key-backup/index.ts:819` (/room_keys/batch_recover)                              |
| `GET`    | `/_matrix/client/v1/room_keys/export`                                   | `src/key-backup/index.ts:904` (/room_keys/export)                                     |
| `GET`    | `/_matrix/client/v1/room_keys/export/{version}`                         | `src/key-backup/index.ts:904` (/room_keys/export/{})                                  |
| `POST`   | `/_matrix/client/v1/room_keys/import`                                   | `src/key-backup/index.ts:934` (/room_keys/import)                                     |
| `POST`   | `/_matrix/client/v1/room_keys/import/{version}`                         | `src/key-backup/index.ts:934` (/room_keys/import/{})                                  |
| `DELETE` | `/_matrix/client/v1/room_keys/keys`                                     | `src/key-backup/index.ts:451` (/room_keys/keys)                                       |
| `GET`    | `/_matrix/client/v1/room_keys/keys`                                     | `src/key-backup/index.ts:451` (/room_keys/keys)                                       |
| `PUT`    | `/_matrix/client/v1/room_keys/keys`                                     | `src/key-backup/index.ts:451` (/room_keys/keys)                                       |
| `DELETE` | `/_matrix/client/v1/room_keys/keys/{room_id}`                           | `src/key-backup-paths.ts:26` (/room_keys/keys/$roomId)                                |
| `GET`    | `/_matrix/client/v1/room_keys/keys/{room_id}`                           | `src/key-backup-paths.ts:26` (/room_keys/keys/$roomId)                                |
| `PUT`    | `/_matrix/client/v1/room_keys/keys/{room_id}`                           | `src/key-backup-paths.ts:26` (/room_keys/keys/$roomId)                                |
| `DELETE` | `/_matrix/client/v1/room_keys/keys/{room_id}/{session_id}`              | `src/key-backup-paths.ts:21` (/room_keys/keys/$roomId/$sessionId)                     |
| `GET`    | `/_matrix/client/v1/room_keys/keys/{room_id}/{session_id}`              | `src/key-backup-paths.ts:21` (/room_keys/keys/$roomId/$sessionId)                     |
| `PUT`    | `/_matrix/client/v1/room_keys/keys/{room_id}/{session_id}`              | `src/key-backup-paths.ts:21` (/room_keys/keys/$roomId/$sessionId)                     |
| `POST`   | `/_matrix/client/v1/room_keys/recover`                                  | `src/key-backup/index.ts:735` (/room_keys/recover)                                    |
| `GET`    | `/_matrix/client/v1/room_keys/recover/{version}/{room_id}`              | `src/key-backup/index.ts:848` (/room_keys/recover/{}/{})                              |
| `GET`    | `/_matrix/client/v1/room_keys/recover/{version}/{room_id}/{session_id}` | `src/key-backup/index.ts:878` (/room_keys/recover/{}/{}/{})                           |
| `GET`    | `/_matrix/client/v1/room_keys/recovery/{version}/progress`              | `src/key-backup/index.ts:763` (/room_keys/recovery/{}/progress)                       |
| `GET`    | `/_matrix/client/v1/room_keys/verify/{version}`                         | `src/key-backup/index.ts:790` (/room_keys/verify/{})                                  |
| `GET`    | `/_matrix/client/v1/room_keys/version`                                  | `src/key-backup/index.ts:212` (/room_keys/version)                                    |
| `POST`   | `/_matrix/client/v1/room_keys/version`                                  | `src/key-backup/index.ts:212` (/room_keys/version)                                    |
| `DELETE` | `/_matrix/client/v1/room_keys/version/{version}`                        | `src/rust-crypto/backup.ts:802` (/room_keys/version/$version)                         |
| `GET`    | `/_matrix/client/v1/room_keys/version/{version}`                        | `src/rust-crypto/backup.ts:802` (/room_keys/version/$version)                         |
| `PUT`    | `/_matrix/client/v1/room_keys/version/{version}`                        | `src/rust-crypto/backup.ts:802` (/room_keys/version/$version)                         |
| `POST`   | `/_matrix/client/v3/room_keys/batch_recover`                            | `src/key-backup/index.ts:819` (/room_keys/batch_recover)                              |
| `GET`    | `/_matrix/client/v3/room_keys/export`                                   | `src/key-backup/index.ts:904` (/room_keys/export)                                     |
| `GET`    | `/_matrix/client/v3/room_keys/export/{version}`                         | `src/key-backup/index.ts:904` (/room_keys/export/{})                                  |
| `POST`   | `/_matrix/client/v3/room_keys/import`                                   | `src/key-backup/index.ts:934` (/room_keys/import)                                     |
| `POST`   | `/_matrix/client/v3/room_keys/import/{version}`                         | `src/key-backup/index.ts:934` (/room_keys/import/{})                                  |
| `DELETE` | `/_matrix/client/v3/room_keys/keys`                                     | `src/rust-crypto/OutgoingRequestProcessor.ts:78` (/\_matrix/client/v3/room_keys/keys) |
| `PUT`    | `/_matrix/client/v3/room_keys/keys`                                     | `src/rust-crypto/OutgoingRequestProcessor.ts:78` (/\_matrix/client/v3/room_keys/keys) |
| `DELETE` | `/_matrix/client/v3/room_keys/keys/{room_id}`                           | `src/key-backup-paths.ts:26` (/room_keys/keys/$roomId)                                |
| `GET`    | `/_matrix/client/v3/room_keys/keys/{room_id}`                           | `src/key-backup-paths.ts:26` (/room_keys/keys/$roomId)                                |
| `PUT`    | `/_matrix/client/v3/room_keys/keys/{room_id}`                           | `src/key-backup-paths.ts:26` (/room_keys/keys/$roomId)                                |
| `DELETE` | `/_matrix/client/v3/room_keys/keys/{room_id}/{session_id}`              | `src/key-backup-paths.ts:21` (/room_keys/keys/$roomId/$sessionId)                     |
| `GET`    | `/_matrix/client/v3/room_keys/keys/{room_id}/{session_id}`              | `src/key-backup-paths.ts:21` (/room_keys/keys/$roomId/$sessionId)                     |
| `PUT`    | `/_matrix/client/v3/room_keys/keys/{room_id}/{session_id}`              | `src/key-backup-paths.ts:21` (/room_keys/keys/$roomId/$sessionId)                     |
| `POST`   | `/_matrix/client/v3/room_keys/recover`                                  | `src/key-backup/index.ts:735` (/room_keys/recover)                                    |
| `GET`    | `/_matrix/client/v3/room_keys/recover/{version}/{room_id}`              | `src/key-backup/index.ts:848` (/room_keys/recover/{}/{})                              |
| `GET`    | `/_matrix/client/v3/room_keys/recover/{version}/{room_id}/{session_id}` | `src/key-backup/index.ts:878` (/room_keys/recover/{}/{}/{})                           |
| `GET`    | `/_matrix/client/v3/room_keys/recovery/{version}/progress`              | `src/key-backup/index.ts:763` (/room_keys/recovery/{}/progress)                       |
| `GET`    | `/_matrix/client/v3/room_keys/verify/{version}`                         | `src/key-backup/index.ts:790` (/room_keys/verify/{})                                  |
| `GET`    | `/_matrix/client/v3/room_keys/version`                                  | `src/key-backup/index.ts:212` (/room_keys/version)                                    |
| `DELETE` | `/_matrix/client/v3/room_keys/version/{version}`                        | `src/rust-crypto/backup.ts:802` (/room_keys/version/$version)                         |
| `GET`    | `/_matrix/client/v3/room_keys/version/{version}`                        | `src/rust-crypto/backup.ts:802` (/room_keys/version/$version)                         |
| `PUT`    | `/_matrix/client/v3/room_keys/version/{version}`                        | `src/rust-crypto/backup.ts:802` (/room_keys/version/$version)                         |

</details>

<details><summary><code>friend_room</code> — 28 条</summary>

| Method   | Path                                                            | 构造证据                                                                             |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET`    | `/_matrix/vendor/v1/friends`                                    | ⚠️ `src/friend/sub-managers/friend-list-manager.ts:119` (/friends)                   |
| `POST`   | `/_matrix/vendor/v1/friends`                                    | ⚠️ `src/friend/sub-managers/friend-list-manager.ts:119` (/friends)                   |
| `GET`    | `/_matrix/vendor/v1/friends/check/{user_id}`                    | `src/friend/sub-managers/friend-list-manager.ts:326` (/friends/check/{})             |
| `GET`    | `/_matrix/vendor/v1/friends/dm/{user_id}`                       | `src/friend/sub-managers/friend-list-manager.ts:842` (/friends/dm/{})                |
| `POST`   | `/_matrix/vendor/v1/friends/dm/{user_id}`                       | `src/friend/sub-managers/friend-list-manager.ts:842` (/friends/dm/{})                |
| `GET`    | `/_matrix/vendor/v1/friends/groups`                             | `src/friend/sub-managers/friend-list-manager.ts:435` (/friends/groups)               |
| `POST`   | `/_matrix/vendor/v1/friends/groups`                             | `src/friend/sub-managers/friend-list-manager.ts:435` (/friends/groups)               |
| `DELETE` | `/_matrix/vendor/v1/friends/groups/{group_id}`                  | `src/friend/sub-managers/friend-list-manager.ts:563` (/friends/groups/{})            |
| `POST`   | `/_matrix/vendor/v1/friends/groups/{group_id}/add/{user_id}`    | `src/friend/sub-managers/friend-list-manager.ts:516` (/friends/groups/{}/add/{})     |
| `GET`    | `/_matrix/vendor/v1/friends/groups/{group_id}/friends`          | `src/friend/sub-managers/friend-list-manager.ts:617` (/friends/groups/{}/friends)    |
| `PUT`    | `/_matrix/vendor/v1/friends/groups/{group_id}/name`             | `src/friend/sub-managers/friend-list-manager.ts:592` (/friends/groups/{}/name)       |
| `DELETE` | `/_matrix/vendor/v1/friends/groups/{group_id}/remove/{user_id}` | `src/friend/sub-managers/friend-list-manager.ts:540` (/friends/groups/{}/remove/{})  |
| `POST`   | `/_matrix/vendor/v1/friends/request`                            | `src/friend/sub-managers/friend-request-manager.ts:113` (/friends/request)           |
| `POST`   | `/_matrix/vendor/v1/friends/request/{user_id}/accept`           | `src/friend/sub-managers/friend-request-manager.ts:194` (/friends/request/{}/accept) |
| `POST`   | `/_matrix/vendor/v1/friends/request/{user_id}/cancel`           | `src/friend/sub-managers/friend-request-manager.ts:253` (/friends/request/{}/cancel) |
| `POST`   | `/_matrix/vendor/v1/friends/request/{user_id}/reject`           | `src/friend/sub-managers/friend-request-manager.ts:231` (/friends/request/{}/reject) |
| `GET`    | `/_matrix/vendor/v1/friends/requests/incoming`                  | `src/friend/sub-managers/friend-request-manager.ts:284` (/friends/requests/incoming) |
| `GET`    | `/_matrix/vendor/v1/friends/requests/outgoing`                  | `src/friend/sub-managers/friend-request-manager.ts:317` (/friends/requests/outgoing) |
| `GET`    | `/_matrix/vendor/v1/friends/search`                             | `src/friend/sub-managers/friend-list-manager.ts:258` (/friends/search)               |
| `POST`   | `/_matrix/vendor/v1/friends/search`                             | `src/friend/sub-managers/friend-list-manager.ts:258` (/friends/search)               |
| `GET`    | `/_matrix/vendor/v1/friends/suggestions`                        | `src/friend/sub-managers/friend-list-manager.ts:218` (/friends/suggestions)          |
| `DELETE` | `/_matrix/vendor/v1/friends/{user_id}`                          | `src/friend/sub-managers/friend-list-manager.ts:667` (/friends/{})                   |
| `PUT`    | `/_matrix/vendor/v1/friends/{user_id}/displayname`              | `src/friend/sub-managers/friend-list-manager.ts:695` (/friends/{}/displayname)       |
| `GET`    | `/_matrix/vendor/v1/friends/{user_id}/groups`                   | `src/friend/sub-managers/friend-list-manager.ts:643` (/friends/{}/groups)            |
| `GET`    | `/_matrix/vendor/v1/friends/{user_id}/info`                     | `src/friend/sub-managers/friend-list-manager.ts:801` (/friends/{}/info)              |
| `PUT`    | `/_matrix/vendor/v1/friends/{user_id}/note`                     | `src/friend/sub-managers/friend-list-manager.ts:723` (/friends/{}/note)              |
| `GET`    | `/_matrix/vendor/v1/friends/{user_id}/status`                   | `src/friend/paths.ts:24` (/friends/{}/status)                                        |
| `PUT`    | `/_matrix/vendor/v1/friends/{user_id}/status`                   | `src/friend/paths.ts:24` (/friends/{}/status)                                        |

</details>

<details><summary><code>space</code> — 26 条</summary>

| Method   | Path                                                         | 构造证据                                                                                               |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET`    | `/_matrix/client/v1/spaces/{space_id}/hierarchy`             | `src/space/sub-managers/space-hierarchy-manager.ts:180` (/spaces/$spaceId/hierarchy)                   |
| `GET`    | `/_matrix/client/v1/spaces/{space_id}/hierarchy/v1`          | `src/space/sub-managers/space-hierarchy-manager.ts:213` (/spaces/$spaceId/hierarchy/v1)                |
| `GET`    | `/_matrix/client/v3/spaces/{space_id}/hierarchy`             | `src/space/sub-managers/space-hierarchy-manager.ts:180` (/spaces/$spaceId/hierarchy)                   |
| `GET`    | `/_matrix/client/v3/spaces/{space_id}/hierarchy/v1`          | `src/space/sub-managers/space-hierarchy-manager.ts:213` (/spaces/$spaceId/hierarchy/v1)                |
| `POST`   | `/_matrix/vendor/v1/spaces`                                  | ⚠️ `src/admin/sub-managers/admin-room-manager.ts:1033` (/spaces)                                       |
| `GET`    | `/_matrix/vendor/v1/spaces/public`                           | `src/space/sub-managers/space-query-manager.ts:267` (/spaces/public)                                   |
| `GET`    | `/_matrix/vendor/v1/spaces/room/{room_id}`                   | `src/space/sub-managers/space-query-manager.ts:399` (/spaces/room/{})                                  |
| `GET`    | `/_matrix/vendor/v1/spaces/room/{room_id}/parents`           | `src/space/sub-managers/space-query-manager.ts:428` (/spaces/room/{}/parents)                          |
| `GET`    | `/_matrix/vendor/v1/spaces/search`                           | `src/space/sub-managers/space-query-manager.ts:302` (/spaces/search)                                   |
| `GET`    | `/_matrix/vendor/v1/spaces/statistics`                       | `src/space/sub-managers/space-query-manager.ts:334` (/spaces/statistics)                               |
| `GET`    | `/_matrix/vendor/v1/spaces/user`                             | `src/space/sub-managers/space-query-manager.ts:370` (/spaces/user)                                     |
| `DELETE` | `/_matrix/vendor/v1/spaces/{space_id}`                       | `src/space/sub-managers/space-lifecycle-manager.ts:153` (/spaces/$spaceId)                             |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}`                       | `src/space/sub-managers/space-lifecycle-manager.ts:153` (/spaces/$spaceId)                             |
| `PUT`    | `/_matrix/vendor/v1/spaces/{space_id}`                       | `src/space/sub-managers/space-lifecycle-manager.ts:153` (/spaces/$spaceId)                             |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}/children`              | `src/space/sub-managers/space-child-manager.ts:78` (/spaces/$spaceId/children)                         |
| `POST`   | `/_matrix/vendor/v1/spaces/{space_id}/children`              | `src/space/sub-managers/space-child-manager.ts:78` (/spaces/$spaceId/children)                         |
| `DELETE` | `/_matrix/vendor/v1/spaces/{space_id}/children/{room_id}`    | `src/space/sub-managers/space-child-manager.ts:167` (/spaces/{}/children/{})                           |
| `POST`   | `/_matrix/vendor/v1/spaces/{space_id}/invite`                | `src/space/sub-managers/space-member-manager.ts:103` (/spaces/$spaceId/invite)                         |
| `POST`   | `/_matrix/vendor/v1/spaces/{space_id}/join`                  | `src/space/sub-managers/space-member-manager.ts:135` (/spaces/$spaceId/join)                           |
| `POST`   | `/_matrix/vendor/v1/spaces/{space_id}/leave`                 | `src/space/sub-managers/space-member-manager.ts:165` (/spaces/$spaceId/leave)                          |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}/members`               | `src/space/sub-managers/space-member-manager.ts:73` (/spaces/$spaceId/members)                         |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}/rooms`                 | `src/space/sub-managers/space-child-manager.ts:203` (/spaces/$spaceId/rooms)                           |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}/state`                 | `src/space/sub-managers/space-child-manager.ts:215` (/spaces/{spaceId}/state)                          |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}/summary`               | `src/space/sub-managers/space-hierarchy-manager.ts:224` (/\_matrix/vendor/v1/spaces/{spaceId}/summary) |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}/summary/with_children` | `src/space/sub-managers/space-hierarchy-manager.ts:279` (/spaces/$spaceId/summary/with_children)       |
| `GET`    | `/_matrix/vendor/v1/spaces/{space_id}/tree_path`             | `src/space/sub-managers/space-hierarchy-manager.ts:311` (/spaces/$spaceId/tree_path)                   |

</details>

<details><summary><code>e2ee</code> — 23 条</summary>

| Method   | Path                                                            | 构造证据                                                                          |
| -------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET`    | `/_matrix/client/v1/keys/changes`                               | `src/crypto-keys/index.ts:278` (/keys/changes)                                    |
| `POST`   | `/_matrix/client/v1/keys/claim`                                 | `src/crypto-keys/index.ts:246` (/keys/claim)                                      |
| `POST`   | `/_matrix/client/v1/keys/device_list/update`                    | `src/crypto-keys/index.ts:308` (/keys/device_list/update)                         |
| `POST`   | `/_matrix/client/v1/keys/device_signing/upload`                 | `src/client-crypto-requests.ts:40` (/keys/device_signing/upload)                  |
| `POST`   | `/_matrix/client/v1/keys/query`                                 | `src/client.ts:1600` (/keys/query)                                                |
| `POST`   | `/_matrix/client/v1/keys/signatures/upload`                     | `src/crypto-keys/index.ts:337` (/keys/signatures/upload)                          |
| `POST`   | `/_matrix/client/v1/keys/upload`                                | `src/crypto-keys/index.ts:134` (/keys/upload)                                     |
| `POST`   | `/_matrix/client/v1/keys/upload/{device_id}`                    | `src/e2ee/index.ts:222` (/keys/upload/{})                                         |
| `GET`    | `/_matrix/client/v1/room_keys/request`                          | `src/client-crypto-requests.ts:46` (/room_keys/request)                           |
| `POST`   | `/_matrix/client/v1/room_keys/request`                          | `src/client-crypto-requests.ts:46` (/room_keys/request)                           |
| `DELETE` | `/_matrix/client/v1/room_keys/request/{request_id}`             | `src/client-crypto-requests.ts:58` (/room_keys/request/$requestId)                |
| `GET`    | `/_matrix/client/v1/rooms/{room_id}/keys/distribution`          | `src/crypto-keys/index.ts:407` (/rooms/{}/keys/distribution)                      |
| `POST`   | `/_matrix/client/v1/sendToDevice/{event_type}/{transaction_id}` | `src/client-to-device.ts:37` (/sendToDevice/$eventType/$txnId)                    |
| `PUT`    | `/_matrix/client/v1/sendToDevice/{event_type}/{transaction_id}` | `src/client-to-device.ts:37` (/sendToDevice/$eventType/$txnId)                    |
| `GET`    | `/_matrix/client/v3/keys/backup/secure`                         | `src/secure-backup/index.ts:90` (/\_matrix/client/v3/keys/backup/secure)          |
| `DELETE` | `/_matrix/client/v3/keys/backup/secure/{backup_id}`             | `src/client-secure-backup-requests.ts:31` (/keys/backup/secure/$backupId)         |
| `GET`    | `/_matrix/client/v3/keys/backup/secure/{backup_id}`             | `src/client-secure-backup-requests.ts:31` (/keys/backup/secure/$backupId)         |
| `POST`   | `/_matrix/client/v3/keys/backup/secure/{backup_id}/keys`        | `src/client-secure-backup-requests.ts:39` (/keys/backup/secure/$backupId/keys)    |
| `POST`   | `/_matrix/client/v3/keys/backup/secure/{backup_id}/restore`     | `src/client-secure-backup-requests.ts:43` (/keys/backup/secure/$backupId/restore) |
| `POST`   | `/_matrix/client/v3/keys/backup/secure/{backup_id}/verify`      | `src/client-secure-backup-requests.ts:35` (/keys/backup/secure/$backupId/verify)  |
| `GET`    | `/_matrix/client/v3/keys/history`                               | `src/e2ee/index.ts:707` (/keys/history)                                           |
| `POST`   | `/_matrix/client/v3/keys/upload/{device_id}`                    | `src/e2ee/index.ts:222` (/keys/upload/{})                                         |
| `POST`   | `/_matrix/client/v3/sendToDevice/{event_type}/{transaction_id}` | `src/client-to-device.ts:37` (/sendToDevice/$eventType/$txnId)                    |

</details>

<details><summary><code>thread</code> — 21 条</summary>

| Method   | Path                                                                 | 构造证据                                                                                      |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`    | `/_matrix/client/v1/rooms/{room_id}/threads`                         | `src/client-timeline-requests.ts:11` (/rooms/$roomId/threads)                                 |
| `GET`    | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}`             | `src/room-summary/sub-managers/room-thread-manager.ts:131` (/rooms/$roomId/threads/$threadId) |
| `GET`    | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies`     | `src/thread/index.ts:561` (/rooms/{}/threads/{}/replies)                                      |
| `POST`   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies`     | `src/thread/index.ts:561` (/rooms/{}/threads/{}/replies)                                      |
| `POST`   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/subscribe`   | `src/thread/index.ts:501` (/rooms/{}/threads/{}/subscribe)                                    |
| `POST`   | `/_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unsubscribe` | `src/thread/index.ts:528` (/rooms/{}/threads/{}/unsubscribe)                                  |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/replies/{event_id}/redact`       | `src/thread/index.ts:626` (/rooms/{}/replies/{}/redact)                                       |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/threads`                         | `src/client-timeline-requests.ts:11` (/rooms/$roomId/threads)                                 |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/threads/search`                  | `src/threading/index.ts:261` (/rooms/{r}/threads/search)                                      |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/threads/unread`                  | `src/threading/index.ts:262` (/rooms/{r}/threads/unread)                                      |
| `DELETE` | `/_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}`             | `src/room-summary/sub-managers/room-thread-manager.ts:131` (/rooms/$roomId/threads/$threadId) |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/freeze`      | `src/thread/index.ts:381` (/rooms/{}/threads/{}/freeze)                                       |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/mute`        | `src/thread/index.ts:435` (/rooms/{}/threads/{}/mute)                                         |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/read`        | `src/thread/index.ts:474` (/rooms/{}/threads/{}/read)                                         |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/stats`       | `src/thread/index.ts:659` (/rooms/{}/threads/{}/stats)                                        |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/unfreeze`    | `src/thread/index.ts:408` (/rooms/{}/threads/{}/unfreeze)                                     |
| `GET`    | `/_matrix/vendor/v1/threads`                                         | ⚠️ `src/thread/index.ts:683` (/threads)                                                       |
| `POST`   | `/_matrix/vendor/v1/threads`                                         | ⚠️ `src/thread/index.ts:683` (/threads)                                                       |
| `GET`    | `/_matrix/vendor/v1/threads/subscribed`                              | `src/thread/index.ts:737` (/threads/subscribed)                                               |
| `GET`    | `/_matrix/vendor/v1/threads/unread`                                  | `src/thread/index.ts:760` (/threads/unread)                                                   |
| `GET`    | `/_matrix/vendor/v1/user/{user_id}/rooms/{room_id}/threads`          | `src/threading/index.ts:269` (/user/{u}/rooms/{r}/threads)                                    |

</details>

<details><summary><code>room_summary</code> — 18 条</summary>

| Method   | Path                                                                        | 构造证据                                                                                         |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/_matrix/client/v1/rooms/{room_id}/summary`                                | `src/room-summary/index.ts:328` (/rooms/{}/summary)                                              |
| `DELETE` | `/_matrix/vendor/v1/rooms/{room_id}/summary`                                | `src/room-summary/index.ts:328` (/rooms/{}/summary)                                              |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/summary`                                | `src/room-summary/index.ts:328` (/rooms/{}/summary)                                              |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/summary`                                | `src/room-summary/index.ts:328` (/rooms/{}/summary)                                              |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/summary`                                | `src/room-summary/index.ts:328` (/rooms/{}/summary)                                              |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/summary/heroes/recalculate`             | `src/room-summary/sub-managers/room-stats-manager.ts:167` (/rooms/{}/summary/heroes/recalculate) |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/summary/members`                        | `src/room-summary/sub-managers/room-member-manager.ts:55` (/rooms/{}/summary/members)            |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/summary/members`                        | `src/room-summary/sub-managers/room-member-manager.ts:55` (/rooms/{}/summary/members)            |
| `DELETE` | `/_matrix/vendor/v1/rooms/{room_id}/summary/members/{user_id}`              | `src/room-summary/sub-managers/room-member-manager.ts:62` (/rooms/{}/summary/members/{})         |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/summary/members/{user_id}`              | `src/room-summary/sub-managers/room-member-manager.ts:62` (/rooms/{}/summary/members/{})         |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/summary/state`                          | `src/room-summary/sub-managers/room-state-manager.ts:50` (/rooms/{}/summary/state)               |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/summary/state/{event_type}/{state_key}` | `src/room-summary/sub-managers/room-state-manager.ts:59` (/rooms/{}/summary/state/{}/{})         |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/summary/state/{event_type}/{state_key}` | `src/room-summary/sub-managers/room-state-manager.ts:59` (/rooms/{}/summary/state/{}/{})         |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/summary/stats`                          | `src/room-summary/sub-managers/room-stats-manager.ts:65` (/rooms/{}/summary/stats)               |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/summary/stats/recalculate`              | `src/room-summary/sub-managers/room-stats-manager.ts:133` (/rooms/{}/summary/stats/recalculate)  |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/summary/sync`                           | `src/room-summary/sub-managers/room-event-operation-manager.ts:1149` (/rooms/{}/summary/sync)    |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/summary/unread/clear`                   | `src/room-summary/sub-managers/room-stats-manager.ts:194` (/rooms/{}/summary/unread/clear)       |
| `POST`   | `/_synapse/room_summary/v1/summaries/batch`                                 | `src/room-summary/index.ts:525` (/\_synapse/room_summary/v1/summaries/batch)                     |

</details>

<details><summary><code>widget</code> — 16 条</summary>

| Method   | Path                                                                  | 构造证据                                                      |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/widgets`                          | `src/widget/index.ts:169` (/rooms/{}/widgets)                 |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/widgets/jitsi/config`             | `src/widget/index.ts:194` (/rooms/{}/widgets/jitsi/config)    |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities` | `src/widget/index.ts:587` (/rooms/{}/widgets/{}/capabilities) |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities` | `src/widget/index.ts:587` (/rooms/{}/widgets/{}/capabilities) |
| `POST`   | `/_matrix/vendor/v1/widgets`                                          | ⚠️ `src/widget/index.ts:235` (/widgets)                       |
| `DELETE` | `/_matrix/vendor/v1/widgets/sessions/{session_id}`                    | `src/widget/index.ts:531` (/widgets/sessions/{})              |
| `GET`    | `/_matrix/vendor/v1/widgets/sessions/{session_id}`                    | `src/widget/index.ts:531` (/widgets/sessions/{})              |
| `DELETE` | `/_matrix/vendor/v1/widgets/{widget_id}`                              | `src/widget/index.ts:263` (/widgets/{})                       |
| `GET`    | `/_matrix/vendor/v1/widgets/{widget_id}`                              | `src/widget/index.ts:263` (/widgets/{})                       |
| `PUT`    | `/_matrix/vendor/v1/widgets/{widget_id}`                              | `src/widget/index.ts:263` (/widgets/{})                       |
| `GET`    | `/_matrix/vendor/v1/widgets/{widget_id}/config`                       | `src/widget/index.ts:349` (/widgets/{}/config)                |
| `GET`    | `/_matrix/vendor/v1/widgets/{widget_id}/permissions`                  | `src/widget/index.ts:378` (/widgets/{}/permissions)           |
| `POST`   | `/_matrix/vendor/v1/widgets/{widget_id}/permissions`                  | `src/widget/index.ts:378` (/widgets/{}/permissions)           |
| `DELETE` | `/_matrix/vendor/v1/widgets/{widget_id}/permissions/{user_id}`        | `src/widget/index.ts:444` (/widgets/{}/permissions/{})        |
| `GET`    | `/_matrix/vendor/v1/widgets/{widget_id}/sessions`                     | `src/widget/index.ts:473` (/widgets/{}/sessions)              |
| `POST`   | `/_matrix/vendor/v1/widgets/{widget_id}/sessions`                     | `src/widget/index.ts:473` (/widgets/{}/sessions)              |

</details>

<details><summary><code>push</code> — 15 条</summary>

| Method   | Path                                                            | 构造证据                                                                              |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST`   | `/_matrix/client/v3/notifications/{notification_id}/ack`        | `src/notifications/index.ts:37` (/notifications/{id}/ack)                             |
| `GET`    | `/_matrix/client/v3/pushers`                                    | `src/push-notifications/index.ts:42` (/\_matrix/client/v3/pushers)                    |
| `POST`   | `/_matrix/client/v3/pushers`                                    | `src/push-notifications/index.ts:42` (/\_matrix/client/v3/pushers)                    |
| `GET`    | `/_matrix/client/v3/pushers/`                                   | `src/push-notifications/index.ts:42` (/\_matrix/client/v3/pushers)                    |
| `POST`   | `/_matrix/client/v3/pushers/`                                   | `src/push-notifications/index.ts:42` (/\_matrix/client/v3/pushers)                    |
| `POST`   | `/_matrix/client/v3/pushers/set`                                | `src/push/index.ts:220` (/pushers/set)                                                |
| `GET`    | `/_matrix/client/v3/pushrules/{scope}`                          | `src/push/index.ts:331` (/pushrules/{})                                               |
| `GET`    | `/_matrix/client/v3/pushrules/{scope}/{kind}`                   | `src/push/index.ts:360` (/pushrules/{}/{})                                            |
| `DELETE` | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}`         | `src/push-rules/index.ts:60` (/\_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}) |
| `GET`    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}`         | `src/push-rules/index.ts:60` (/\_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}) |
| `POST`   | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}`         | `src/push-rules/index.ts:60` (/\_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}) |
| `PUT`    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}`         | `src/push-rules/index.ts:60` (/\_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}) |
| `PUT`    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/actions` | `src/push/index.ts:634` (/pushrules/{}/{}/{}/actions)                                 |
| `GET`    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/enabled` | `src/push/index.ts:556` (/pushrules/{}/{}/{}/enabled)                                 |
| `PUT`    | `/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/enabled` | `src/push/index.ts:556` (/pushrules/{}/{}/{}/enabled)                                 |

</details>

<details><summary><code>account_data</code> — 15 条</summary>

| Method   | Path                                                                    | 构造证据                                                                                  |
| -------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET`    | `/_matrix/client/v3/user/{user_id}/account_data/`                       | `src/client-account-data-requests.ts:26` (/user/$userId/account_data/)                    |
| `DELETE` | `/_matrix/client/v3/user/{user_id}/account_data/{type}`                 | `src/client-account-data-requests.ts:17` (/user/$userId/account_data/$type)               |
| `GET`    | `/_matrix/client/v3/user/{user_id}/account_data/{type}`                 | `src/client-account-data-requests.ts:17` (/user/$userId/account_data/$type)               |
| `POST`   | `/_matrix/client/v3/user/{user_id}/account_data/{type}`                 | `src/client-account-data-requests.ts:17` (/user/$userId/account_data/$type)               |
| `PUT`    | `/_matrix/client/v3/user/{user_id}/account_data/{type}`                 | `src/client-account-data-requests.ts:17` (/user/$userId/account_data/$type)               |
| `POST`   | `/_matrix/client/v3/user/{user_id}/filter`                              | `src/client-account-data-requests.ts:58` (/user/$userId/filter)                           |
| `PUT`    | `/_matrix/client/v3/user/{user_id}/filter`                              | `src/client-account-data-requests.ts:58` (/user/$userId/filter)                           |
| `DELETE` | `/_matrix/client/v3/user/{user_id}/filter/{filter_id}`                  | `src/client-account-data-requests.ts:63` (/user/$userId/filter/$filterId)                 |
| `GET`    | `/_matrix/client/v3/user/{user_id}/filter/{filter_id}`                  | `src/client-account-data-requests.ts:63` (/user/$userId/filter/$filterId)                 |
| `GET`    | `/_matrix/client/v3/user/{user_id}/openid/request_token`                | `src/client-batch-requests.ts:204` (/user/$userId/openid/request_token)                   |
| `POST`   | `/_matrix/client/v3/user/{user_id}/openid/request_token`                | `src/client-batch-requests.ts:204` (/user/$userId/openid/request_token)                   |
| `DELETE` | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/account_data/{type}` | `src/client-account-data-requests.ts:34` (/user/$userId/rooms/$roomId/account_data/$type) |
| `GET`    | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/account_data/{type}` | `src/client-account-data-requests.ts:34` (/user/$userId/rooms/$roomId/account_data/$type) |
| `POST`   | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/account_data/{type}` | `src/client-account-data-requests.ts:34` (/user/$userId/rooms/$roomId/account_data/$type) |
| `PUT`    | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/account_data/{type}` | `src/client-account-data-requests.ts:34` (/user/$userId/rooms/$roomId/account_data/$type) |

</details>

<details><summary><code>voice</code> — 12 条</summary>

| Method | Path                                                | 构造证据                                           |
| ------ | --------------------------------------------------- | -------------------------------------------------- |
| `GET`  | `/_matrix/vendor/v1/voice/config`                   | `src/voice/index.ts:412` (/voice/config)           |
| `POST` | `/_matrix/vendor/v1/voice/register`                 | `src/voice/index.ts:831` (/voice/register)         |
| `GET`  | `/_matrix/vendor/v1/voice/room/{room_id}`           | `src/voice/index.ts:11` (/voice/room/{room_id})    |
| `GET`  | `/_matrix/vendor/v1/voice/room/{room_id}/stats`     | `src/voice/index.ts:348` (/voice/room/{}/stats)    |
| `GET`  | `/_matrix/vendor/v1/voice/stats`                    | `src/voice/index.ts:320` (/voice/stats)            |
| `POST` | `/_matrix/vendor/v1/voice/upload`                   | `src/voice/index.ts:451` (/voice/upload)           |
| `GET`  | `/_matrix/vendor/v1/voice/user/{user_id}`           | `src/voice/index.ts:11` (/voice/user/{user_id})    |
| `GET`  | `/_matrix/vendor/v1/voice/user/{user_id}/stats`     | `src/voice/index.ts:376` (/voice/user/{}/stats)    |
| `GET`  | `/_matrix/vendor/v1/voice/{media_id}`               | `src/voice/index.ts:535` (/voice/{})               |
| `POST` | `/_matrix/vendor/v1/voice/{media_id}/convert`       | `src/voice/index.ts:714` (/voice/{}/convert)       |
| `POST` | `/_matrix/vendor/v1/voice/{media_id}/optimize`      | `src/voice/index.ts:748` (/voice/{}/optimize)      |
| `POST` | `/_matrix/vendor/v1/voice/{media_id}/transcription` | `src/voice/index.ts:782` (/voice/{}/transcription) |

</details>

<details><summary><code>media</code> — 11 条</summary>

| Method | Path                                                | 构造证据                                                          |
| ------ | --------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`  | `/_matrix/media/r0/config`                          | ⚠️ `src/admin/sub-managers/admin-server-manager.ts:489` (/config) |
| `POST` | `/_matrix/media/r0/delete/{server_name}/{media_id}` | `src/media/index.ts:457` (/delete/{}/{})                          |
| `GET`  | `/_matrix/media/r0/preview_url`                     | ⚠️ `src/media/index.ts:506` (/preview_url)                        |
| `POST` | `/_matrix/media/r0/upload`                          | ⚠️ `src/http-api/index.ts:122` (/upload)                          |
| `GET`  | `/_matrix/media/v1/config`                          | ⚠️ `src/admin/sub-managers/admin-server-manager.ts:489` (/config) |
| `POST` | `/_matrix/media/v1/delete/{server_name}/{media_id}` | `src/media/index.ts:457` (/delete/{}/{})                          |
| `GET`  | `/_matrix/media/v1/preview_url`                     | ⚠️ `src/media/index.ts:506` (/preview_url)                        |
| `POST` | `/_matrix/media/v1/upload`                          | ⚠️ `src/http-api/index.ts:122` (/upload)                          |
| `GET`  | `/_matrix/media/v3/config`                          | ⚠️ `src/admin/sub-managers/admin-server-manager.ts:489` (/config) |
| `POST` | `/_matrix/media/v3/delete/{server_name}/{media_id}` | `src/media/index.ts:457` (/delete/{}/{})                          |
| `PUT`  | `/_matrix/media/v3/upload/{server_name}/{media_id}` | `src/media/index.ts:383` (/upload/{}/{})                          |

</details>

<details><summary><code>presence</code> — 9 条</summary>

| Method | Path                                           | 构造证据                                          |
| ------ | ---------------------------------------------- | ------------------------------------------------- |
| `GET`  | `/_matrix/client/v1/presence/{user_id}/status` | `src/presence/index.ts:162` (/presence/{}/status) |
| `POST` | `/_matrix/client/v1/presence/{user_id}/status` | `src/presence/index.ts:162` (/presence/{}/status) |
| `PUT`  | `/_matrix/client/v1/presence/{user_id}/status` | `src/presence/index.ts:162` (/presence/{}/status) |
| `GET`  | `/_matrix/client/v3/presence/list`             | `src/presence/index.ts:421` (/presence/list)      |
| `POST` | `/_matrix/client/v3/presence/list`             | `src/presence/index.ts:421` (/presence/list)      |
| `GET`  | `/_matrix/client/v3/presence/list/{user_id}`   | `src/presence/index.ts:411` (/presence/list/{})   |
| `GET`  | `/_matrix/client/v3/presence/{user_id}/status` | `src/presence/index.ts:162` (/presence/{}/status) |
| `POST` | `/_matrix/client/v3/presence/{user_id}/status` | `src/presence/index.ts:162` (/presence/{}/status) |
| `PUT`  | `/_matrix/client/v3/presence/{user_id}/status` | `src/presence/index.ts:162` (/presence/{}/status) |

</details>

<details><summary><code>relations</code> — 9 条</summary>

| Method | Path                                                                              | 构造证据                                                                                  |
| ------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET`  | `/_matrix/client/v1/rooms/{room_id}/aggregations/{event_id}/{rel_type}`           | `src/relations/index.ts:388` (/rooms/$roomId/aggregations/$eventId/$relType)              |
| `GET`  | `/_matrix/client/v1/rooms/{room_id}/relations/{event_id}`                         | `src/relations/index.ts:168` (/rooms/$roomId/relations/$eventId)                          |
| `GET`  | `/_matrix/client/v1/rooms/{room_id}/relations/{event_id}/{rel_type}`              | `src/relations/index.ts:167` (/rooms/$roomId/relations/$eventId/$relationType)            |
| `GET`  | `/_matrix/client/v1/rooms/{room_id}/relations/{event_id}/{rel_type}/{event_type}` | `src/relations/index.ts:165` (/rooms/$roomId/relations/$eventId/$relationType/$eventType) |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/aggregations/{event_id}/{rel_type}`           | `src/relations/index.ts:388` (/rooms/$roomId/aggregations/$eventId/$relType)              |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/relations/{event_id}`                         | `src/relations/index.ts:168` (/rooms/$roomId/relations/$eventId)                          |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/relations/{event_id}/{rel_type}`              | `src/relations/index.ts:167` (/rooms/$roomId/relations/$eventId/$relationType)            |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/relations/{event_id}/{rel_type}/{event_type}` | `src/relations/index.ts:165` (/rooms/$roomId/relations/$eventId/$relationType/$eventType) |
| `PUT`  | `/_matrix/vendor/v1/rooms/{room_id}/relations/{event_id}/{rel_type}/{txn_id}`     | `src/relations/index.ts:165` (/rooms/$roomId/relations/$eventId/$relationType/$eventType) |

</details>

<details><summary><code>search</code> — 8 条</summary>

| Method | Path                                                    | 构造证据                                                                       |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET`  | `/_matrix/client/v1/rooms/{room_id}/context/{event_id}` | `src/room/RoomManager.ts:59` (/rooms/{room_id}/context/{event_id})             |
| `GET`  | `/_matrix/client/v1/rooms/{room_id}/hierarchy`          | `src/client-room-discovery-requests.ts:16` (/rooms/$roomId/hierarchy)          |
| `GET`  | `/_matrix/client/v1/rooms/{room_id}/timestamp_to_event` | `src/client-room-discovery-requests.ts:22` (/rooms/$roomId/timestamp_to_event) |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/context/{event_id}` | `src/room/RoomManager.ts:59` (/rooms/{room_id}/context/{event_id})             |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/hierarchy`          | `src/client-room-discovery-requests.ts:16` (/rooms/$roomId/hierarchy)          |
| `POST` | `/_matrix/client/v3/search`                             | ⚠️ `src/client-crypto-requests.ts:30` (/search)                                |
| `POST` | `/_matrix/vendor/v1/search_recipients`                  | ⚠️ `src/client-secure-backup-requests.ts:72` (/search_recipients)              |
| `POST` | `/_matrix/vendor/v1/search_rooms`                       | ⚠️ `src/client-secure-backup-requests.ts:57` (/search_rooms)                   |

</details>

<details><summary><code>saml</code> — 8 条</summary>

| Method | Path                                         | 构造证据                                           |
| ------ | -------------------------------------------- | -------------------------------------------------- |
| `GET`  | `/_matrix/client/v3/login/saml/callback`     | `src/saml/index.ts:222` (/login/saml/callback)     |
| `POST` | `/_matrix/client/v3/login/saml/callback`     | `src/saml/index.ts:222` (/login/saml/callback)     |
| `GET`  | `/_matrix/client/v3/login/sso/redirect/saml` | `src/saml/index.ts:101` (/login/sso/redirect/saml) |
| `POST` | `/_matrix/client/v3/login/sso/redirect/saml` | `src/saml/index.ts:101` (/login/sso/redirect/saml) |
| `GET`  | `/_matrix/client/v3/logout/saml`             | `src/saml/index.ts:197` (/logout/saml)             |
| `GET`  | `/_matrix/client/v3/logout/saml/callback`    | `src/saml/index.ts:321` (/logout/saml/callback)    |
| `GET`  | `/_matrix/client/v3/saml/metadata`           | `src/saml/index.ts:343` (/saml/metadata)           |
| `GET`  | `/_matrix/client/v3/saml/sp_metadata`        | `src/saml/index.ts:365` (/saml/sp_metadata)        |

</details>

<details><summary><code>oidc</code> — 7 条</summary>

| Method | Path                                    | 构造证据                                         |
| ------ | --------------------------------------- | ------------------------------------------------ |
| `GET`  | `/_matrix/client/v3/login/sso/redirect` | `src/account/index.ts:214` (/login/sso/redirect) |
| `GET`  | `/_matrix/client/v3/oidc/authorize`     | `src/oidc/manager.ts:196` (/oidc/authorize)      |
| `GET`  | `/_matrix/client/v3/oidc/callback`      | `src/oidc/manager.ts:487` (/oidc/callback)       |
| `POST` | `/_matrix/client/v3/oidc/login`         | `src/oidc/manager.ts:405` (/oidc/login)          |
| `POST` | `/_matrix/client/v3/oidc/logout`        | `src/oidc/manager.ts:358` (/oidc/logout)         |
| `POST` | `/_matrix/client/v3/oidc/token`         | `src/oidc/manager.ts:273` (/oidc/token)          |
| `GET`  | `/_matrix/client/v3/oidc/userinfo`      | `src/oidc/manager.ts:307` (/oidc/userinfo)       |

</details>

<details><summary><code>cas</code> — 7 条</summary>

| Method | Path                                        | 构造证据                                                                |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/_matrix/client/v3/login/sso/redirect/cas` | `src/account/index.ts:195` (/\_matrix/client/v3/login/sso/redirect/cas) |
| `GET`  | `/_synapse/cas/login`                       | `src/cas/index.ts:28` (/\_synapse/cas/login)                            |
| `GET`  | `/_synapse/cas/logout`                      | `src/cas/index.ts:28` (/\_synapse/cas/logout)                           |
| `GET`  | `/_synapse/cas/p3/serviceValidate`          | `src/cas/index.ts:426` (/p3/serviceValidate)                            |
| `GET`  | `/_synapse/cas/proxy`                       | ⚠️ `src/cas/index.ts:457` (/proxy)                                      |
| `GET`  | `/_synapse/cas/proxyValidate`               | ⚠️ `src/cas/index.ts:388` (/proxyValidate)                              |
| `GET`  | `/_synapse/cas/serviceValidate`             | `src/cas/index.ts:29` (/\_synapse/cas/serviceValidate)                  |

</details>

<details><summary><code>key_rotation</code> — 7 条</summary>

| Method | Path                                                   | 构造证据                                                    |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| `POST` | `/_matrix/vendor/v1/keys/rotation/config`              | `src/key-rotation/index.ts:426` (/keys/rotation/config)     |
| `PUT`  | `/_matrix/vendor/v1/keys/rotation/config`              | `src/key-rotation/index.ts:426` (/keys/rotation/config)     |
| `GET`  | `/_matrix/vendor/v1/keys/rotation/history/{device_id}` | `src/key-rotation/index.ts:332` (/keys/rotation/history/{}) |
| `POST` | `/_matrix/vendor/v1/keys/rotation/revoke`              | `src/key-rotation/index.ts:372` (/keys/rotation/revoke)     |
| `POST` | `/_matrix/vendor/v1/keys/rotation/rotate`              | `src/key-rotation/index.ts:282` (/keys/rotation/rotate)     |
| `GET`  | `/_matrix/vendor/v1/keys/rotation/status`              | `src/key-rotation/index.ts:237` (/keys/rotation/status)     |
| `POST` | `/_matrix/vendor/v1/keys/rotation/status`              | `src/key-rotation/index.ts:237` (/keys/rotation/status)     |

</details>

<details><summary><code>burn_after_read</code> — 7 条</summary>

| Method   | Path                                                 | 构造证据                                                    |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/burn`            | `src/burn-after-read/index.ts:203` (/rooms/{}/burn)         |
| `PUT`    | `/_matrix/vendor/v1/rooms/{room_id}/burn`            | `src/burn-after-read/index.ts:203` (/rooms/{}/burn)         |
| `GET`    | `/_matrix/vendor/v1/rooms/{room_id}/burn/pending`    | `src/burn-after-read/index.ts:321` (/rooms/{}/burn/pending) |
| `DELETE` | `/_matrix/vendor/v1/rooms/{room_id}/burn/{event_id}` | `src/burn-after-read/index.ts:362` (/rooms/{}/burn/{})      |
| `POST`   | `/_matrix/vendor/v1/rooms/{room_id}/burn/{event_id}` | `src/burn-after-read/index.ts:362` (/rooms/{}/burn/{})      |
| `PUT`    | `/_matrix/vendor/v1/user/burn/config`                | `src/burn-after-read/index.ts:459` (/user/burn/config)      |
| `GET`    | `/_matrix/vendor/v1/user/burn/stats`                 | `src/burn-after-read/index.ts:490` (/user/burn/stats)       |

</details>

<details><summary><code>rendezvous</code> — 6 条</summary>

| Method   | Path                                                  | 构造证据                                                            |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `POST`   | `/_matrix/client/v1/rendezvous`                       | ⚠️ `src/rendezvous/RendezvousManager.ts:169` (/rendezvous)          |
| `DELETE` | `/_matrix/client/v1/rendezvous/{session_id}`          | `src/rendezvous/RendezvousManager.ts:194` (/rendezvous/{})          |
| `GET`    | `/_matrix/client/v1/rendezvous/{session_id}`          | `src/rendezvous/RendezvousManager.ts:194` (/rendezvous/{})          |
| `PUT`    | `/_matrix/client/v1/rendezvous/{session_id}`          | `src/rendezvous/RendezvousManager.ts:194` (/rendezvous/{})          |
| `GET`    | `/_matrix/client/v1/rendezvous/{session_id}/messages` | `src/rendezvous/RendezvousManager.ts:280` (/rendezvous/{}/messages) |
| `POST`   | `/_matrix/client/v1/rendezvous/{session_id}/messages` | `src/rendezvous/RendezvousManager.ts:280` (/rendezvous/{}/messages) |

</details>

<details><summary><code>moderation</code> — 6 条</summary>

| Method | Path                                                                | 构造证据                                                                   |
| ------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST` | `/_matrix/client/v1/rooms/{room_id}/report/{event_id}`              | `src/reporting/index.ts:88` (/rooms/$roomId/report/$eventId)               |
| `POST` | `/_matrix/client/v3/rooms/{room_id}/report`                         | `src/room/RoomManager.ts:60` (/rooms/{room_id}/report)                     |
| `POST` | `/_matrix/client/v3/rooms/{room_id}/report/{event_id}`              | `src/reporting/index.ts:88` (/rooms/$roomId/report/$eventId)               |
| `POST` | `/_matrix/client/v3/users/{user_id}/report`                         | `src/reporting/index.ts:111` (/users/$userId/report)                       |
| `GET`  | `/_matrix/vendor/v1/rooms/{room_id}/report/{event_id}/scanner_info` | `src/reporting/index.ts:156` (/rooms/$roomId/report/$eventId/scanner_info) |
| `PUT`  | `/_matrix/vendor/v1/rooms/{room_id}/report/{event_id}/score`        | `src/reporting/index.ts:132` (/rooms/$roomId/report/$eventId/score)        |

</details>

<details><summary><code>device</code> — 6 条</summary>

| Method   | Path                                          | 构造证据                                              |
| -------- | --------------------------------------------- | ----------------------------------------------------- |
| `POST`   | `/_matrix/client/v3/delete_devices`           | ⚠️ `src/device/index.ts:525` (/delete_devices)        |
| `GET`    | `/_matrix/client/v3/devices`                  | ⚠️ `src/device/index.ts:240` (/devices)               |
| `DELETE` | `/_matrix/client/v3/devices/{device_id}`      | `src/device/index.ts:304` (/devices/{})               |
| `GET`    | `/_matrix/client/v3/devices/{device_id}`      | `src/device/index.ts:304` (/devices/{})               |
| `PUT`    | `/_matrix/client/v3/devices/{device_id}`      | `src/device/index.ts:304` (/devices/{})               |
| `POST`   | `/_matrix/client/v3/keys/device_list_updates` | `src/device/index.ts:588` (/keys/device_list_updates) |

</details>

<details><summary><code>typing</code> — 5 条</summary>

| Method | Path                                                  | 构造证据                                          |
| ------ | ----------------------------------------------------- | ------------------------------------------------- |
| `POST` | `/_matrix/client/v3/rooms/typing`                     | `src/room/RoomManager.ts:2010` (/rooms/typing)    |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/typing`           | `src/room/RoomManager.ts:1988` (/rooms/{}/typing) |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/typing/{user_id}` | `src/typing/index.ts:94` (/rooms/{}/typing/{})    |
| `POST` | `/_matrix/client/v3/rooms/{room_id}/typing/{user_id}` | `src/typing/index.ts:94` (/rooms/{}/typing/{})    |
| `PUT`  | `/_matrix/client/v3/rooms/{room_id}/typing/{user_id}` | `src/typing/index.ts:94` (/rooms/{}/typing/{})    |

</details>

<details><summary><code>thirdparty</code> — 5 条</summary>

| Method | Path                                                | 构造证据                                                        |
| ------ | --------------------------------------------------- | --------------------------------------------------------------- |
| `GET`  | `/_matrix/client/v3/thirdparty/location`            | `src/third-party/index.ts:307` (/thirdparty/location)           |
| `GET`  | `/_matrix/client/v3/thirdparty/location/{protocol}` | `src/client-third-party.ts:16` (/thirdparty/location/$protocol) |
| `GET`  | `/_matrix/client/v3/thirdparty/protocol/{protocol}` | `src/app-service/index.ts:627` (/thirdparty/protocol/{})        |
| `GET`  | `/_matrix/client/v3/thirdparty/user`                | `src/third-party/index.ts:345` (/thirdparty/user)               |
| `GET`  | `/_matrix/client/v3/thirdparty/user/{protocol}`     | `src/client-third-party.ts:25` (/thirdparty/user/$protocol)     |

</details>

<details><summary><code>dm</code> — 5 条</summary>

| Method | Path                                            | 构造证据                                                                 |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `POST` | `/_matrix/vendor/v1/create_dm`                  | ⚠️ `src/dm/sub-managers/dm-room-creation-manager.ts:293` (/create_dm)    |
| `GET`  | `/_matrix/vendor/v1/direct`                     | ⚠️ `src/dm/sub-managers/dm-room-list-manager.ts:557` (/direct)           |
| `PUT`  | `/_matrix/vendor/v1/direct/{room_id}`           | `src/dm/sub-managers/dm-room-creation-manager.ts:384` (/direct/{})       |
| `GET`  | `/_matrix/vendor/v1/rooms/{room_id}/dm`         | `src/dm/sub-managers/dm-room-list-manager.ts:597` (/rooms/{}/dm)         |
| `GET`  | `/_matrix/vendor/v1/rooms/{room_id}/dm/partner` | `src/dm/sub-managers/dm-room-list-manager.ts:657` (/rooms/{}/dm/partner) |

</details>

<details><summary><code>sliding_sync</code> — 4 条</summary>

| Method | Path                                                          | 构造证据                                          |
| ------ | ------------------------------------------------------------- | ------------------------------------------------- |
| `POST` | `/_matrix/client/unstable/org.matrix.msc3575/sync`            | ⚠️ `src/client/worker/worker.spec.ts:414` (/sync) |
| `POST` | `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync` | ⚠️ `src/client/worker/worker.spec.ts:414` (/sync) |
| `POST` | `/_matrix/client/v1/sync`                                     | ⚠️ `src/client/worker/worker.spec.ts:414` (/sync) |
| `POST` | `/_matrix/client/v4/sync`                                     | ⚠️ `src/client/worker/worker.spec.ts:414` (/sync) |

</details>

<details><summary><code>dehydrated_device</code> — 4 条</summary>

| Method | Path                                                                                  | 构造证据                                                                                |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `PUT`  | `/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device`                    | ⚠️ `src/dehydrated-device/index.ts:127` (/dehydrated_device)                            |
| `GET`  | `/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device/status`             | `src/dehydrated-device/index.ts:189` (/dehydrated_device/status)                        |
| `GET`  | `/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device/{device_id}/events` | `src/rust-crypto/DehydratedDeviceManager.ts:305` (/dehydrated_device/$device_id/events) |
| `POST` | `/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device/{device_id}/events` | `src/rust-crypto/DehydratedDeviceManager.ts:305` (/dehydrated_device/$device_id/events) |

</details>

<details><summary><code>delayed_events</code> — 4 条</summary>

| Method | Path                                                                                              | 构造证据                                                          |
| ------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`  | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events`                                      | ⚠️ `src/delayed-events/index.ts:268` (/delayed_events)            |
| `GET`  | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}`                           | `src/client-delayed-events.ts:35` (/delayed_events/{})            |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}`                           | `src/client-delayed-events.ts:35` (/delayed_events/{})            |
| `PUT`  | `/_matrix/client/unstable/org.matrix.msc4140/rooms/{room_id}/delayed_event/{event_type}/{txn_id}` | `src/client-delayed-events.ts:46` (/rooms/{}/delayed_event/{}/{}) |

</details>

<details><summary><code>tags</code> — 4 条</summary>

| Method   | Path                                                           | 构造证据                                                                         |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET`    | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags`       | `src/client-account-data-requests.ts:43` (/user/$userId/rooms/$roomId/tags)      |
| `DELETE` | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags/{tag}` | `src/client-account-data-requests.ts:50` (/user/$userId/rooms/$roomId/tags/$tag) |
| `PUT`    | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags/{tag}` | `src/client-account-data-requests.ts:50` (/user/$userId/rooms/$roomId/tags/$tag) |
| `GET`    | `/_matrix/client/v3/user/{user_id}/tags`                       | `src/http-api/strip-prefix.ts:186` (/user/$userId/tags)                          |

</details>

<details><summary><code>push_notification</code> — 4 条</summary>

| Method   | Path                                          | 构造证据                                            |
| -------- | --------------------------------------------- | --------------------------------------------------- |
| `GET`    | `/_matrix/vendor/v1/push/devices`             | `src/notifications/index.ts:38` (/push/devices)     |
| `POST`   | `/_matrix/vendor/v1/push/devices`             | `src/notifications/index.ts:38` (/push/devices)     |
| `DELETE` | `/_matrix/vendor/v1/push/devices/{device_id}` | `src/notifications/index.ts:347` (/push/devices/{}) |
| `POST`   | `/_matrix/vendor/v1/push/send`                | `src/notifications/index.ts:38` (/push/send)        |

</details>

<details><summary><code>invite_blocklist</code> — 4 条</summary>

| Method | Path                                                  | 构造证据                                                             |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/_matrix/vendor/v1/rooms/{room_id}/invite_allowlist` | `src/invite-blocklist/index.ts:241` (/rooms/{}/invite_allowlist)     |
| `POST` | `/_matrix/vendor/v1/rooms/{room_id}/invite_allowlist` | `src/invite-blocklist/index.ts:241` (/rooms/{}/invite_allowlist)     |
| `GET`  | `/_matrix/vendor/v1/rooms/{room_id}/invite_blocklist` | `src/http-api/strip-prefix.ts:118` (/rooms/$roomId/invite_blocklist) |
| `POST` | `/_matrix/vendor/v1/rooms/{room_id}/invite_blocklist` | `src/http-api/strip-prefix.ts:118` (/rooms/$roomId/invite_blocklist) |

</details>

<details><summary><code>app_service</code> — 3 条</summary>

| Method | Path                                           | 构造证据                                             |
| ------ | ---------------------------------------------- | ---------------------------------------------------- |
| `GET`  | `/_matrix/client/v1/user/{user_id}/appservice` | `src/app-service/index.ts:570` (/user/{}/appservice) |
| `GET`  | `/_matrix/client/v3/appservice/alias`          | `src/app-service/index.ts:539` (/appservice/alias)   |
| `GET`  | `/_matrix/client/v3/appservice/user`           | `src/app-service/index.ts:505` (/appservice/user)    |

</details>

<details><summary><code>guest</code> — 3 条</summary>

| Method | Path                                       | 构造证据                                          |
| ------ | ------------------------------------------ | ------------------------------------------------- |
| `GET`  | `/_matrix/client/v3/account/guest`         | `src/guest/index.ts:495` (/account/guest)         |
| `POST` | `/_matrix/client/v3/account/guest/upgrade` | `src/guest/index.ts:542` (/account/guest/upgrade) |
| `POST` | `/_matrix/client/v3/register/guest`        | `src/guest/index.ts:586` (/register/guest)        |

</details>

<details><summary><code>captcha</code> — 3 条</summary>

| Method | Path                                         | 构造证据                                              |
| ------ | -------------------------------------------- | ----------------------------------------------------- |
| `POST` | `/_matrix/client/v3/register/captcha/send`   | `src/captcha/index.ts:124` (/register/captcha/send)   |
| `GET`  | `/_matrix/client/v3/register/captcha/status` | `src/captcha/index.ts:201` (/register/captcha/status) |
| `POST` | `/_matrix/client/v3/register/captcha/verify` | `src/captcha/index.ts:166` (/register/captcha/verify) |

</details>

<details><summary><code>external_service</code> — 3 条</summary>

| Method   | Path                                                | 构造证据                                                                                   |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET`    | `/_matrix/vendor/v1/external_services/health`       | `src/admin/sub-managers/admin-external-service-manager.ts:195` (/external_services/health) |
| `DELETE` | `/_matrix/vendor/v1/external_services/{service_id}` | `src/admin/sub-managers/admin-external-service-manager.ts:163` (/external_services/{})     |
| `PUT`    | `/_matrix/vendor/v1/external_services/{service_id}` | `src/admin/sub-managers/admin-external-service-manager.ts:163` (/external_services/{})     |

</details>

<details><summary><code>msc4108_rendezvous</code> — 1 条</summary>

| Method | Path                                                     | 构造证据                                                                                     |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous` | `src/rendezvous/transports/MSC4108RendezvousSession.ts:106` (/org.matrix.msc4108/rendezvous) |

</details>

<details><summary><code>sync</code> — 1 条</summary>

| Method | Path                              | 构造证据                                              |
| ------ | --------------------------------- | ----------------------------------------------------- |
| `GET`  | `/_matrix/client/v3/joined_rooms` | ⚠️ `src/client-batch-requests.ts:124` (/joined_rooms) |

</details>

<details><summary><code>ephemeral</code> — 1 条</summary>

| Method | Path                                           | 构造证据                                           |
| ------ | ---------------------------------------------- | -------------------------------------------------- |
| `GET`  | `/_matrix/client/v3/rooms/{room_id}/ephemeral` | `src/ephemeral/index.ts:209` (/rooms/{}/ephemeral) |

</details>

<details><summary><code>reactions</code> — 1 条</summary>

| Method | Path                                                          | 构造证据                                                               |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PUT`  | `/_matrix/client/v3/rooms/{room_id}/send/m.reaction/{txn_id}` | `src/room-events/index.ts:266` (/rooms/$roomId/send/m.reaction/$txnId) |

</details>

---

## 3.5 条件覆盖（版本段参数化 / 前缀片段模板）— 1 条

这些路由**没有**精确调用点，但 `src` 里存在"只拼前缀、参数后补"的模板（如
`/_matrix/media/${version}/download`，`version` 默认 `v3`、可由调用方传 `r0`）。
定性：**不是缺口，但也不是默认覆盖**——是否真的可访问取决于调用方传参。

| Method | Path                                                             | 模板证据                                                          | 范围          |
| ------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------------- |
| `POST` | `/_matrix/federation/unstable/org.matrix.msc3720/account_status` | `src/account/index.ts:447` (`/org.matrix.msc3720/account_status`) | `SERVER_ONLY` |

---

## 4. 前缀/版本漂移 — 0 条

后端路径与 SDK 调用点的**末段签名相同**、命名空间/版本不同。这类问题是隐蔽的运行时 404：契约升版后 SDK 仍在打旧前缀。

✅ 无漂移。

---

## 5. 仅声明面命中（T3）— 79 条

**不是缺口**：后端路由已进入 SDK 的 route-table 声明面，但仓内没有调用方。
已知系统性成因（来自 `pnpm quality:manager-codegen`）：admin / federation / voice / feature_flags /
moderation / key_rotation / app_service / dm / reactions / vendor / push_notification / delayed_events
共 12 个模块被标记为 `WAIVED — no route-table consumer`。若前端 `Tjg` 需要其中能力，
须**回前端仓库查消费情况**后才能定性为"待补封装"。

<details><summary><code>app_service</code> — 22 条</summary>

| Method    | Path                                                               | 范围            |
| --------- | ------------------------------------------------------------------ | --------------- |
| `POST`    | `/_matrix/app/v1/ping`                                             | `SERVER_ONLY`   |
| `DELETE`  | `/_matrix/app/v1/proxy/{as_id}/{*path}`                            | `SERVER_ONLY`   |
| `GET`     | `/_matrix/app/v1/proxy/{as_id}/{*path}`                            | `SERVER_ONLY`   |
| `HEAD`    | `/_matrix/app/v1/proxy/{as_id}/{*path}`                            | `SERVER_ONLY`   |
| `OPTIONS` | `/_matrix/app/v1/proxy/{as_id}/{*path}`                            | `SERVER_ONLY`   |
| `PATCH`   | `/_matrix/app/v1/proxy/{as_id}/{*path}`                            | `SERVER_ONLY`   |
| `POST`    | `/_matrix/app/v1/proxy/{as_id}/{*path}`                            | `SERVER_ONLY`   |
| `PUT`     | `/_matrix/app/v1/proxy/{as_id}/{*path}`                            | `SERVER_ONLY`   |
| `GET`     | `/_matrix/app/v1/rooms/{alias}`                                    | `SERVER_ONLY`   |
| `PUT`     | `/_matrix/app/v1/transactions/{as_id}/{txn_id}`                    | `SERVER_ONLY`   |
| `GET`     | `/_matrix/app/v1/users/{user_id}`                                  | `SERVER_ONLY`   |
| `GET`     | `/_matrix/app/v1/{as_id}`                                          | `SERVER_ONLY`   |
| `POST`    | `/_matrix/client/unstable/io.element.msc4512/appservice/fed_proxy` | `CLIENT_FACING` |
| `POST`    | `/_matrix/client/v1/appservice/fed_proxy`                          | `CLIENT_FACING` |
| `DELETE`  | `/_matrix/client/v1/proxy/{as_id}/{*path}`                         | `SERVER_ONLY`   |
| `GET`     | `/_matrix/client/v1/proxy/{as_id}/{*path}`                         | `SERVER_ONLY`   |
| `HEAD`    | `/_matrix/client/v1/proxy/{as_id}/{*path}`                         | `SERVER_ONLY`   |
| `OPTIONS` | `/_matrix/client/v1/proxy/{as_id}/{*path}`                         | `SERVER_ONLY`   |
| `PATCH`   | `/_matrix/client/v1/proxy/{as_id}/{*path}`                         | `SERVER_ONLY`   |
| `POST`    | `/_matrix/client/v1/proxy/{as_id}/{*path}`                         | `SERVER_ONLY`   |
| `PUT`     | `/_matrix/client/v1/proxy/{as_id}/{*path}`                         | `SERVER_ONLY`   |
| `GET`     | `/_synapse/admin/v1/appservices/{as_id}/state/{state_key}`         | `SERVER_ONLY`   |

</details>

<details><summary><code>key_backup</code> — 18 条</summary>

| Method   | Path                                                                 | 范围            |
| -------- | -------------------------------------------------------------------- | --------------- |
| `DELETE` | `/_matrix/client/v1/room_keys/{version}/keys`                        | `CLIENT_FACING` |
| `GET`    | `/_matrix/client/v1/room_keys/{version}/keys`                        | `CLIENT_FACING` |
| `PUT`    | `/_matrix/client/v1/room_keys/{version}/keys`                        | `CLIENT_FACING` |
| `DELETE` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}`              | `CLIENT_FACING` |
| `GET`    | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}`              | `CLIENT_FACING` |
| `PUT`    | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}`              | `CLIENT_FACING` |
| `DELETE` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}` | `CLIENT_FACING` |
| `GET`    | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}` | `CLIENT_FACING` |
| `PUT`    | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}` | `CLIENT_FACING` |
| `DELETE` | `/_matrix/client/v3/room_keys/{version}/keys`                        | `CLIENT_FACING` |
| `GET`    | `/_matrix/client/v3/room_keys/{version}/keys`                        | `CLIENT_FACING` |
| `PUT`    | `/_matrix/client/v3/room_keys/{version}/keys`                        | `CLIENT_FACING` |
| `DELETE` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}`              | `CLIENT_FACING` |
| `GET`    | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}`              | `CLIENT_FACING` |
| `PUT`    | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}`              | `CLIENT_FACING` |
| `DELETE` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}` | `CLIENT_FACING` |
| `GET`    | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}` | `CLIENT_FACING` |
| `PUT`    | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}` | `CLIENT_FACING` |

</details>

<details><summary><code>media</code> — 15 条</summary>

| Method | Path                                                                    | 范围            |
| ------ | ----------------------------------------------------------------------- | --------------- |
| `GET`  | `/_matrix/client/v1/media/download/{server_name}/{media_id}`            | `CLIENT_FACING` |
| `GET`  | `/_matrix/client/v1/media/download/{server_name}/{media_id}/{filename}` | `CLIENT_FACING` |
| `GET`  | `/_matrix/client/v1/media/preview_url`                                  | `CLIENT_FACING` |
| `GET`  | `/_matrix/client/v1/media/thumbnail/{server_name}/{media_id}`           | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/r0/download/{server_name}/{media_id}`                   | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/r0/download/{server_name}/{media_id}/{filename}`        | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/r1/download/{server_name}/{media_id}`                   | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/r1/download/{server_name}/{media_id}/{filename}`        | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/v1/download/{server_name}/{media_id}`                   | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/v1/download/{server_name}/{media_id}/{filename}`        | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/v3/download/{server_name}/{media_id}`                   | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/v3/download/{server_name}/{media_id}/{filename}`        | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/v3/download_signed/{server_name}/{media_id}`            | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/v3/download_signed/{server_name}/{media_id}/{filename}` | `CLIENT_FACING` |
| `GET`  | `/_matrix/media/v3/thumbnail/{server_name}/{media_id}`                  | `CLIENT_FACING` |

</details>

<details><summary><code>assembly</code> — 9 条</summary>

| Method | Path                                                                 | 范围             |
| ------ | -------------------------------------------------------------------- | ---------------- |
| `GET`  | `/`                                                                  | `NON_NAMESPACED` |
| `GET`  | `/_health`                                                           | `ROOT_OR_SSO`    |
| `GET`  | `/_matrix/client/v3/pushrules/global/`                               | `CLIENT_FACING`  |
| `PUT`  | `/_matrix/client/v3/rooms/{room_id}/send/m.call.answer/{txn_id}`     | `CLIENT_FACING`  |
| `PUT`  | `/_matrix/client/v3/rooms/{room_id}/send/m.call.candidates/{txn_id}` | `CLIENT_FACING`  |
| `PUT`  | `/_matrix/client/v3/rooms/{room_id}/send/m.call.hangup/{txn_id}`     | `CLIENT_FACING`  |
| `PUT`  | `/_matrix/client/v3/rooms/{room_id}/send/m.call.invite/{txn_id}`     | `CLIENT_FACING`  |
| `GET`  | `/_matrix/static/client/login/`                                      | `CLIENT_FACING`  |
| `GET`  | `/health`                                                            | `ROOT_OR_SSO`    |

</details>

<details><summary><code>push_notification</code> — 4 条</summary>

| Method | Path                              | 范围          |
| ------ | --------------------------------- | ------------- |
| `POST` | `/_synapse/admin/v1/push/cleanup` | `SERVER_ONLY` |
| `GET`  | `/_synapse/admin/v1/push/config`  | `SERVER_ONLY` |
| `PUT`  | `/_synapse/admin/v1/push/config`  | `SERVER_ONLY` |
| `POST` | `/_synapse/admin/v1/push/process` | `SERVER_ONLY` |

</details>

<details><summary><code>msc4108_rendezvous</code> — 3 条</summary>

| Method   | Path                                                                  | 范围            |
| -------- | --------------------------------------------------------------------- | --------------- |
| `DELETE` | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous/{session_id}` | `CLIENT_FACING` |
| `GET`    | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous/{session_id}` | `CLIENT_FACING` |
| `PUT`    | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous/{session_id}` | `CLIENT_FACING` |

</details>

<details><summary><code>delayed_events</code> — 3 条</summary>

| Method | Path                                                                            | 范围            |
| ------ | ------------------------------------------------------------------------------- | --------------- |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/cancel`  | `CLIENT_FACING` |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/restart` | `CLIENT_FACING` |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/send`    | `CLIENT_FACING` |

</details>

<details><summary><code>room_summary</code> — 3 条</summary>

| Method | Path                                        | 范围            |
| ------ | ------------------------------------------- | --------------- |
| `GET`  | `/_synapse/room_summary/v1/summaries`       | `CLIENT_FACING` |
| `POST` | `/_synapse/room_summary/v1/summaries`       | `CLIENT_FACING` |
| `POST` | `/_synapse/room_summary/v1/updates/process` | `CLIENT_FACING` |

</details>

<details><summary><code>oidc</code> — 2 条</summary>

| Method | Path                                | 范围            |
| ------ | ----------------------------------- | --------------- |
| `GET`  | `/.well-known/jwks.json`            | `CLIENT_FACING` |
| `GET`  | `/.well-known/openid-configuration` | `CLIENT_FACING` |

</details>

---

## 6. 服务端/非产品面缺口（登记，**不应**封装）— 30 条

<details><summary><code>federation</code> — 30 条</summary>

| Method | Path                                                           | 范围          |
| ------ | -------------------------------------------------------------- | ------------- |
| `PUT`  | `/_matrix/federation/v1/exchange_third_party_invite/{room_id}` | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/get_event_auth/{room_id}/{event_id}`   | `SERVER_ONLY` |
| `POST` | `/_matrix/federation/v1/get_missing_events/{room_id}`          | `SERVER_ONLY` |
| `PUT`  | `/_matrix/federation/v1/invite/{room_id}/{event_id}`           | `SERVER_ONLY` |
| `POST` | `/_matrix/federation/v1/knock/{room_id}/{user_id}`             | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/make_join/{room_id}/{user_id}`         | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/make_leave/{room_id}/{user_id}`        | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/openid/userinfo`                       | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/query/directory/room/{room_id}`        | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/query/profile`                         | `SERVER_ONLY` |
| `PUT`  | `/_matrix/federation/v1/send/{txn_id}`                         | `SERVER_ONLY` |
| `PUT`  | `/_matrix/federation/v1/send_join/{room_id}/{event_id}`        | `SERVER_ONLY` |
| `PUT`  | `/_matrix/federation/v1/send_leave/{room_id}/{event_id}`       | `SERVER_ONLY` |
| `POST` | `/_matrix/federation/v1/thirdparty/invite`                     | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/timestamp_to_event/{room_id}`          | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v1/user/devices/{user_id}`                | `SERVER_ONLY` |
| `POST` | `/_matrix/federation/v1/user/keys/claim`                       | `SERVER_ONLY` |
| `POST` | `/_matrix/federation/v1/user/keys/query`                       | `SERVER_ONLY` |
| `POST` | `/_matrix/federation/v1/user/keys/upload`                      | `SERVER_ONLY` |
| `PUT`  | `/_matrix/federation/v2/invite/{room_id}/{event_id}`           | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v2/query/{server_name}`                   | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v2/query/{server_name}/{key_id}`          | `SERVER_ONLY` |
| `PUT`  | `/_matrix/federation/v2/send_join/{room_id}/{event_id}`        | `SERVER_ONLY` |
| `PUT`  | `/_matrix/federation/v2/send_leave/{room_id}/{event_id}`       | `SERVER_ONLY` |
| `GET`  | `/_matrix/federation/v2/server`                                | `SERVER_ONLY` |
| `POST` | `/_matrix/federation/v2/user/keys/query`                       | `SERVER_ONLY` |
| `POST` | `/_matrix/key/v2/query`                                        | `SERVER_ONLY` |
| `GET`  | `/_matrix/key/v2/query/{server_name}`                          | `SERVER_ONLY` |
| `GET`  | `/_matrix/key/v2/query/{server_name}/{key_id}`                 | `SERVER_ONLY` |
| `GET`  | `/_matrix/key/v2/server`                                       | `SERVER_ONLY` |

</details>

---

## 7. 人工复核记录（本轮，2026-10-17）

> 本表由审计者人工维护，**重跑生成器不会覆盖**。机器只能给出"证据有几级"，
> "该不该补"必须开源码看实现意图——这是本仓历史审计反复踩过的坑
> （2026-08-17 那次曾把 8 个已实现的 `room-summary` 端点误判为待补）。

| 端点（版本不敏感）                                       | 复核结论                                                        | 证据                                                                                                                                                                                                                                                                                                                                                                                                     | 处置                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/client/unstable/org.matrix.msc2965/auth_issuer`        | ⚪ 非缺口（后端**无**此路由；2026-10-17 订正）                  | `grep -rn "auth_issuer" ../synapse-rust/synapse-web/src` → **0 命中**；后端 fixture `ledger_export_sdk/default.json` 与 SDK `route-manifest.default.json` 同样 **0 命中** ⇒ 该路由**不在任何路由契约里**，故「后端有、SDK 无」的前提不成立。SDK 在 `src/client-auth.ts:55-61` 已按「回退即 404 的死路径」删除该分支并注明原因（与 `ROUTE_CONTRACT.md` 附录 B M-07 一致）。                               | **无需补**。若将来后端真的注册该路由（MSC2965 委派认证），再评估是否改用 `.well-known` 而非该端点。                                                     |
| `/client/v3/admin/room/{}/redact`                        | 🟢 已实现（原判「真缺口」为**误报**，2026-10-17 订正）          | `src/admin/sub-managers/admin-room-manager.ts:640` 有 `redactRoomEvents(roomId, payload)`：`POST {prefix}/admin/room/{roomId}/redact`（`:652`），返回 `AdminRoomRedactResult`。原文「`grep -rn "redact" src/admin` → 0 命中」不成立 —— 该文件位于 `sub-managers/` 子目录，`grep` 未递归或当时方法尚未落地。                                                                                              | **无需补**。按 `event_id` 单条撤回用 `POST /_synapse/admin/v1/rooms/{room_id}/cascade_redact`（`cascadeRedactEvent`，`:1146`）。                        |
| `/media/{}/download/{}/{}`                               | 🟡 版本别名（已核实，非缺口）                                   | `src/media/index.ts:461-462` `getDownloadUrl()`：`const version = options.version ?? "v3"` → `/_matrix/media/${version}/download/...`。r0 需调用方显式传 `version: "r0"`（默认 v3）。                                                                                                                                                                                                                    | 无需补封装。可选：在 `MediaDownloadUrlOptions.version` 处加 JSDoc 说明「r0 为兼容别名，默认 v3」，避免调用方误以为覆盖 r0。                             |
| `/client/unstable/org.matrix.msc4108/rendezvous/{}`      | 🟢 已实现（解析器盲区，非缺口）                                 | `src/rendezvous/transports/MSC4108RendezvousSession.ts:106` `.getUrl("/org.matrix.msc4108/rendezvous", undefined, ClientPrefix.Unstable)`；GET/PUT/DELETE 三方法共用该基址，`{session_id}` 由 transport 追加。                                                                                                                                                                                           | 无需改动。这是本解析器的已知盲区（`getUrl(relativePath, ..., prefix)` 形态 + 尾部参数后拼），已在 §7.1 登记。                                           |
| `/client/unstable/org.matrix.msc4155/rooms/{}/threads`   | 🔴 仅缺 **unstable 变体**（v1 稳定版已封；2026-10-17 订正表述） | SDK 已封 **v1 稳定版**：`src/thread/index.ts:192` `getRoomThreads()` → `tp("/rooms/{roomId}/threads")` + `THREAD_PREFIX_V1` = `/_matrix/client/v1/rooms/{id}/threads`。原文「全仓除 route-table 外**没有任何 `/threads` 路径字面量**」**与事实不符**；真正的缺口只是 MSC4155 的 **unstable 变体**（`/_matrix/client/unstable/org.matrix.msc4155/rooms/{}/threads`）。                                    | v1 稳定版已够用，**无需补**。仅当需要 MSC4155 unstable 的独有能力（或后端只在 unstable 下提供）时，再给 `ThreadManager` 加 unstable 变体入口。          |
| `/client/unstable/org.matrix.msc4156/threads/subscribed` | 🔴 仅缺 **unstable 变体**（vendor 版已封；2026-10-17 订正表述） | SDK 已封 **vendor 版**：`src/thread/index.ts:704` `getSubscribedThreads()` → `/threads/subscribed`（`VendorPrefix`）= `/_matrix/vendor/v1/threads/subscribed`。缺口仅指 MSC4156 的 unstable 变体。                                                                                                                                                                                                       | vendor 版已够用，**无需补**。                                                                                                                           |
| `/client/v1/proxy/{as_id}/{*path}`                       | ⚪ 非前端面（已核实，登记豁免）                                 | 后端 ledger `registered_by=app_service`；与 `/_matrix/app/v1/proxy/{as_id}/{*path}`（7 方法，已在 `SERVER_ONLY_RE` 命中 `/_matrix/app/` → 归 §6）为**孪生路由**，仅前缀不同。`{*path}` 通配符使 codegen 无法生成 route-table；`grep -rn "/proxy/" src --include='*.ts'` 无任何消费点。后端《前缀命名空间治理方案-2026-10-08》§9.2 G-01 明确裁定该 7 条「移出客户端面，归入 AS/服务端排除组（不封装）」。 | **不封装**。已在 `scopeOf` 的 `SERVER_ONLY_RE` 增补 `/^\/_matrix\/client\/v\d+\/proxy\//`，这 7 条从 §2（客户端面缺口）移入 §6（服务端/非产品面缺口）。 |

### 7.1 本解析器的已知盲区（重跑时必须人工兜底）

| 盲区                                               | 例子                                    | 后果                                      | 兜底方式                                   |
| -------------------------------------------------- | --------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| `getUrl(relativePath, query, prefix)` 形态         | `MSC4108RendezvousSession.ts:106`       | 该端点落入 §5「仅声明」桶，看起来像没实现 | 对 §5 中每一条 MSC/vendor 端点 grep 特性名 |
| 前缀 + 尾部参数后拼（URL 拼接）                    | `src/media/index.ts` `getDownloadUrl()` | 落入 §3.5「条件覆盖」桶                   | 看 `version`/`prefix` 是否为可传参数       |
| 变量路径（`authedRequest(Method.X, path)`）        | `src/client-*-requests.ts` 多处         | 该端点靠 §3.5/§5 兜底                     | 按 `build*Path()` 函数名反查               |
| 前缀由函数动态拼（`buildUnstableFeaturePrefix()`） | `src/delayed-events/index.ts:50`        | 已通过 §4 前缀候选（MSC 特性名扫描）修复  | 若新增同类写法，需补扫描规则               |

---

## 附：复现命令

```bash
# 1) 刷新后端 ledger 事实面（离线可跑，无需起服务）
cd ../synapse-rust && ./scripts/generate_sdk_ledger_fixtures.sh
# 2) 刷新 SDK 镜像底座 + route-table codegen
cd ../matrix-js-sdk && pnpm contract:sync && pnpm contract:codegen
# 3) 重新生成缺口报告 + 附录 JSON（两个产物必须一起刷，否则 gap.json 会停在旧底座）
node scripts/audit/compare-routes.mjs --output artifacts/sdk-contract-gap-report.md --json artifacts/sdk-contract-gap.json
```
