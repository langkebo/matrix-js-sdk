# ROUTE_CONTRACT ↔ SDK 封装面 缺口清单（2026-10-15）

> 依据：`synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md`（2026-10-15 生成，**1032 条**路由，源 = `synapse-web/src/routes/**` 真实 `.route()` 注册面 + `derived_routes.rs` 派生表）
> 对照：`matrix-js-sdk` @ `release/contract-entrypoint-next`（Tjg 实际消费线）
> 工具：`node scripts/audit/compare-routes.mjs`（三级证据：L1 route-table 声明面 / L2 调用面 / L3 构造面）

## §0 基线与口径

| 项                              | 值                                                                            | 说明                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 文档路由（权威）                | **1032 条**                                                                   | 逐模块小节内的 `- METHOD /path` 清单，去重后 1032                           |
| 后端最新 ledger（SDK 侧消费源） | **1032 条**（distinct 1032）                                                  | `synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json` @ `8cf03f9d0` |
| SDK 镜像底座                    | **1027 条** @ `122aaf109`                                                     | 落后 **5 条**（见 §2.D）                                                    |
| 证据分桶                        | T1 调用点 338 / T2 构造 574 / T3 仅声明 54 / **缺口 65** / 漂移 0             | 合 1032                                                                     |
| 客户端面（CLIENT_FACING）       | 共 639 条：实现证据 589（108 调用 + 481 构造）、仅声明 47、**缺口 3**、漂移 0 | 覆盖率 **92.2%**                                                            |
| 声明面覆盖率                    | 729/1027 = **71%**                                                            | 其余 298 条连 route-table 都没有（WAIVED 模块）                             |

**三档口径**（勿混用）：`缺口` = 三级证据全无（真未封装）；`仅声明` = 有 route-table 但无任何调用/构造证据（**含解析器盲区假阳性**，见 §4）；`漂移` = 后端已删而 SDK 仍在用（本次 0）。

## §1 结论总览

| #   | 类别                                       | 条数 | 是否属 SDK 应修                      | 详见 |
| --- | ------------------------------------------ | ---: | ------------------------------------ | ---- |
| A   | 客户端面路由缺口（MSC4140 action-in-PATH） |    3 | ✅ 是                                | §2.A |
| B   | 参数/响应级缺口（附录 B 复核后仍存在）     |    1 | ✅ 是                                | §2.B |
| C   | 服务端/运维面路由缺口                      |   62 | ⚠️ 部分（admin 面与 Tjg 管理台相关） | §2.C |
| D   | 契约基座落后（镜像未同步）                 |    5 | ✅ 是（`pnpm contract:sync`）        | §2.D |
| E   | 扫描器盲区/假阳性（**非缺口**）            |   47 | ❌ 否                                | §4   |

> 附录 B（10-09 人工审计，27 项）经**逐条回源复核**：**26 项已修**、1 项仍存在（即 §2.B）。对照表见 §3。

## §2.A 客户端面路由缺口（应封装）

后端已注册、SDK 三级证据全无，且属**客户端面**。共 3 条，全部落在 MSC4140 新增的 **action-in-PATH** 形态上：

| 模块             | Method | Path                                                                            | 预期行为                                                                                                        | 文档来源               | SDK 现状                                                                                                                                       | 等级 |
| ---------------- | ------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `delayed_events` | `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/cancel`  | 对已排队的延迟事件执行动作（`cancel` 取消 / `restart` 重新计时 / `send` 立即发送），动作在**路径段**上而非 body | 延迟事件 （7 条） L614 | `src/delayed-events/index.ts` 仍走旧形态 `POST /delayed_events/{delay_id}` + body `{action}`（源码注释自述 SDK-BL-005）；未采用 action-in-PATH | P2   |
| `delayed_events` | `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/restart` | 对已排队的延迟事件执行动作（`cancel` 取消 / `restart` 重新计时 / `send` 立即发送），动作在**路径段**上而非 body | 延迟事件 （7 条） L615 | `src/delayed-events/index.ts` 仍走旧形态 `POST /delayed_events/{delay_id}` + body `{action}`（源码注释自述 SDK-BL-005）；未采用 action-in-PATH | P2   |
| `delayed_events` | `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/send`    | 对已排队的延迟事件执行动作（`cancel` 取消 / `restart` 重新计时 / `send` 立即发送），动作在**路径段**上而非 body | 延迟事件 （7 条） L616 | `src/delayed-events/index.ts` 仍走旧形态 `POST /delayed_events/{delay_id}` + body `{action}`（源码注释自述 SDK-BL-005）；未采用 action-in-PATH | P2   |

**影响**：功能上旧形态仍可用（后端保留 body `{action}` 兼容面），但**契约面落后**：新形态不被 SDK 覆盖，且 SDK 使用者无法通过类型约束感知 action 语义。**建议**：`DelayedEventsManager` 增加 `cancel/restart/send(delayId)` 三个方法，复用既有 unstable 前缀常量。

## §2.B 参数/响应级缺口（附录 B 复核后仍存在）

| #    | 模块                  | SDK 位置                                                                                          | 后端位置                                                                               | 预期行为 vs 现状                                                                                                           | 等级 |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| R-06 | e2ee 密钥请求列表分页 | `src/device-keys/index.ts:160-162`（`RoomKeyRequestsResponse { requests }`，**无 `next_batch`**） | `synapse-web/src/routes/e2ee/devices.rs:340,351`（返回 `requests` + **`next_batch`**） | 后端按 `limit` 满页时返回游标；SDK 已下发 `limit`/`from`（P-11 已修）但**读不到游标** ⇒ 翻页只能重复首页，**静默数据截断** | P1   |

**建议**：给 `RoomKeyRequestsResponse` 补 `next_batch?: string`，并让调用方据此推进 `from`。

## §2.C 服务端/运维面路由缺口（清单，供边界判定）

共 62 条。多数为联邦/应用服务/运维内部面，**不是**前端 SDK 的受众；但 `admin::*` 一族（12 条）由 Tjg 管理台经 `AdminManager` 消费，需单独判定。

| 模块（`registered_by`） | 条数 | 文档小节                        | 文档行号范围 |
| ----------------------- | ---: | ------------------------------- | ------------ |
| `federation`            |   30 | 联邦 (Federation) （70 条）     | L1133–L1205  |
| `app_service`           |   20 | 应用服务 (AppService) （39 条） | L567–L604    |
| `admin::media`          |    9 | 媒体 (Media) （60 条）          | L424–L444    |
| `admin::room`           |    2 | 管理 (Admin) （142 条）         | L976–L980    |
| `admin::server`         |    1 | 管理 (Admin) （142 条）         | L1029–L1029  |

<details><summary>逐条明细（点击展开）</summary>

| 模块            | Method    | Path                                                           | 文档来源 |
| --------------- | --------- | -------------------------------------------------------------- | -------- |
| `federation`    | `PUT`     | `/_matrix/federation/v1/exchange_third_party_invite/{room_id}` | L1199    |
| `federation`    | `GET`     | `/_matrix/federation/v1/get_event_auth/{room_id}/{event_id}`   | L1133    |
| `federation`    | `POST`    | `/_matrix/federation/v1/get_missing_events/{room_id}`          | L1158    |
| `federation`    | `PUT`     | `/_matrix/federation/v1/invite/{room_id}/{event_id}`           | L1200    |
| `federation`    | `POST`    | `/_matrix/federation/v1/knock/{room_id}/{user_id}`             | L1197    |
| `federation`    | `GET`     | `/_matrix/federation/v1/make_join/{room_id}/{user_id}`         | L1191    |
| `federation`    | `GET`     | `/_matrix/federation/v1/make_leave/{room_id}/{user_id}`        | L1192    |
| `federation`    | `GET`     | `/_matrix/federation/v1/openid/userinfo`                       | L1137    |
| `federation`    | `GET`     | `/_matrix/federation/v1/query/directory/room/{room_id}`        | L1141    |
| `federation`    | `GET`     | `/_matrix/federation/v1/query/profile`                         | L1142    |
| `federation`    | `PUT`     | `/_matrix/federation/v1/send/{txn_id}`                         | L1169    |
| `federation`    | `PUT`     | `/_matrix/federation/v1/send_join/{room_id}/{event_id}`        | L1201    |
| `federation`    | `PUT`     | `/_matrix/federation/v1/send_leave/{room_id}/{event_id}`       | L1202    |
| `federation`    | `POST`    | `/_matrix/federation/v1/thirdparty/invite`                     | L1198    |
| `federation`    | `GET`     | `/_matrix/federation/v1/timestamp_to_event/{room_id}`          | L1147    |
| `federation`    | `GET`     | `/_matrix/federation/v1/user/devices/{user_id}`                | L1195    |
| `federation`    | `POST`    | `/_matrix/federation/v1/user/keys/claim`                       | L1160    |
| `federation`    | `POST`    | `/_matrix/federation/v1/user/keys/query`                       | L1161    |
| `federation`    | `POST`    | `/_matrix/federation/v1/user/keys/upload`                      | L1162    |
| `federation`    | `PUT`     | `/_matrix/federation/v2/invite/{room_id}/{event_id}`           | L1203    |
| `federation`    | `GET`     | `/_matrix/federation/v2/query/{server_name}`                   | L1149    |
| `federation`    | `GET`     | `/_matrix/federation/v2/query/{server_name}/{key_id}`          | L1150    |
| `federation`    | `PUT`     | `/_matrix/federation/v2/send_join/{room_id}/{event_id}`        | L1204    |
| `federation`    | `PUT`     | `/_matrix/federation/v2/send_leave/{room_id}/{event_id}`       | L1205    |
| `federation`    | `GET`     | `/_matrix/federation/v2/server`                                | L1151    |
| `federation`    | `POST`    | `/_matrix/federation/v2/user/keys/query`                       | L1163    |
| `federation`    | `POST`    | `/_matrix/key/v2/query`                                        | L1164    |
| `federation`    | `GET`     | `/_matrix/key/v2/query/{server_name}`                          | L1152    |
| `federation`    | `GET`     | `/_matrix/key/v2/query/{server_name}/{key_id}`                 | L1153    |
| `federation`    | `GET`     | `/_matrix/key/v2/server`                                       | L1154    |
| `app_service`   | `POST`    | `/_matrix/app/v1/ping`                                         | L594     |
| `app_service`   | `DELETE`  | `/_matrix/app/v1/proxy/{as_id}/{*path}`                        | L567     |
| `app_service`   | `GET`     | `/_matrix/app/v1/proxy/{as_id}/{*path}`                        | L570     |
| `app_service`   | `HEAD`    | `/_matrix/app/v1/proxy/{as_id}/{*path}`                        | L588     |
| `app_service`   | `OPTIONS` | `/_matrix/app/v1/proxy/{as_id}/{*path}`                        | L590     |
| `app_service`   | `PATCH`   | `/_matrix/app/v1/proxy/{as_id}/{*path}`                        | L592     |
| `app_service`   | `POST`    | `/_matrix/app/v1/proxy/{as_id}/{*path}`                        | L595     |
| `app_service`   | `PUT`     | `/_matrix/app/v1/proxy/{as_id}/{*path}`                        | L602     |
| `app_service`   | `GET`     | `/_matrix/app/v1/rooms/{alias}`                                | L571     |
| `app_service`   | `PUT`     | `/_matrix/app/v1/transactions/{as_id}/{txn_id}`                | L603     |
| `app_service`   | `GET`     | `/_matrix/app/v1/users/{user_id}`                              | L572     |
| `app_service`   | `GET`     | `/_matrix/app/v1/{as_id}`                                      | L573     |
| `app_service`   | `DELETE`  | `/_matrix/client/v1/proxy/{as_id}/{*path}`                     | L568     |
| `app_service`   | `GET`     | `/_matrix/client/v1/proxy/{as_id}/{*path}`                     | L574     |
| `app_service`   | `HEAD`    | `/_matrix/client/v1/proxy/{as_id}/{*path}`                     | L589     |
| `app_service`   | `OPTIONS` | `/_matrix/client/v1/proxy/{as_id}/{*path}`                     | L591     |
| `app_service`   | `PATCH`   | `/_matrix/client/v1/proxy/{as_id}/{*path}`                     | L593     |
| `app_service`   | `POST`    | `/_matrix/client/v1/proxy/{as_id}/{*path}`                     | L596     |
| `app_service`   | `PUT`     | `/_matrix/client/v1/proxy/{as_id}/{*path}`                     | L604     |
| `app_service`   | `GET`     | `/_synapse/admin/v1/appservices/{as_id}/state/{state_key}`     | L586     |
| `admin::media`  | `POST`    | `/_synapse/admin/v1/media/delete`                              | L435     |
| `admin::media`  | `GET`     | `/_synapse/admin/v1/media/quarantine_changes`                  | L428     |
| `admin::media`  | `DELETE`  | `/_synapse/admin/v1/media/{server_name}/{media_id}`            | L424     |
| `admin::media`  | `GET`     | `/_synapse/admin/v1/media/{server_name}/{media_id}`            | L431     |
| `admin::media`  | `GET`     | `/_synapse/admin/v1/rooms/{room_id}/media`                     | L433     |
| `admin::media`  | `POST`    | `/_synapse/admin/v1/rooms/{room_id}/media/quarantine`          | L442     |
| `admin::media`  | `POST`    | `/_synapse/admin/v1/rooms/{room_id}/media/unquarantine`        | L443     |
| `admin::media`  | `DELETE`  | `/_synapse/admin/v1/rooms/{room_id}/media/{media_id}`          | L425     |
| `admin::media`  | `POST`    | `/_synapse/admin/v1/user/{user_id}/media/quarantine`           | L444     |
| `admin::room`   | `POST`    | `/_synapse/admin/v1/rooms/{room_id}/backfill`                  | L976     |
| `admin::room`   | `POST`    | `/_synapse/admin/v1/rooms/{room_id}/cascade_redact`            | L980     |
| `admin::server` | `GET`     | `/_synapse/admin/v1/rate-limit-status`                         | L1029    |

</details>

**典型项**（admin 面，Tjg 管理台相关）：

- `POST /_synapse/admin/v1/rooms/{room_id}/backfill`（doc L976）——补建历史事件；SDK `AdminRoomManager` 无对应方法。
- `POST /_synapse/admin/v1/rooms/{room_id}/cascade_redact`（doc L980）——级联删除事件；同上。
- `GET /_synapse/admin/v1/rate-limit-status`（doc L1029）——限流状态查询；同上。
- `admin::media` 9 条（`media/delete`、`quarantine_changes`、按 `{server_name}/{media_id}` 的删除等，doc L424-L435）——SDK 仅有 quarantine/unquarantine/protect/unprotect，无这些批量/明细面。

## §2.D 契约基座落后（镜像未同步）

SDK 镜像 `docs/api-contract/generated/*` 停在 `122aaf109`，比后端最新 ledger 少 **5 条**；缺的**全是 MSC4140 延迟事件**：

| Method | Path                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events`                                      |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/cancel`                    |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/restart`                   |
| `POST` | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/send`                      |
| `PUT`  | `/_matrix/client/unstable/org.matrix.msc4140/rooms/{room_id}/delayed_event/{event_type}/{txn_id}` |

**影响**：① 上述 5 条在 SDK 里连 route-table 都不存在，任何封装都无从类型约束；② `contract:codegen:check` / `route-set-parity` 都判「SDK ⊆ 后端」的子集方向，因此**镜像落后不会让门禁变红**（弱绿）。
**建议**：跑 `pnpm contract:sync && pnpm contract:codegen` 并提交生成物（会同时消除 §2.A 的 3 条缺口能否被类型覆盖的前提问题）。

## §3 附录 B（10-09 审计，27 项）复核对照

复核方法：按附录给出的双侧 `file:line` 重新读**当前**源码；下表结论为本次实测。

| #    | 模块                          | 10-09 结论    | 本轮复核（2026-10-15）         | 证据                                                                                              |
| ---- | ----------------------------- | ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| G-01 | app_service 通配代理          | P2 功能遗漏   | 仍无消费者（设计边界，非缺陷） | `/_matrix/app/v1/proxy/{as_id}/{*path}` 属应用服务代理面                                          |
| G-02 | admin.media protect/unprotect | P2 功能遗漏   | ✅ 已修                        | `src/admin/sub-managers/admin-media-manager.ts:201 protectMedia` / `:217` by-id 变体              |
| G-03 | account 邮箱验证 submitToken  | P2 功能遗漏   | ✅ 已修                        | `src/account/index.ts:52-54` 三种 scope 齐全（register/password/threepid）                        |
| M-01 | media 签名下载                | P1 接口不匹配 | ✅ 已修                        | `src/media/index.ts:546 download_signed` + `:560 expires`（注释引后端 `download.rs:325-330`）     |
| M-02 | cas 服务列表响应包裹          | P1 接口不匹配 | ✅ 已修                        | `src/cas/index.ts:197-207` 裸数组判定后再包裹                                                     |
| M-04 | thread 房间话题 query         | P2 接口不匹配 | ✅ 已修                        | `src/thread/index.ts:194 include_all`                                                             |
| M-05 | thread 搜索 query 键          | P1 接口不匹配 | ✅ 已修                        | `src/thread/index.ts:264 queryParams: { q: params.term }`                                         |
| M-06 | e2ee 密钥请求字段名           | P1 接口不匹配 | ✅ 已修                        | `src/room-keys/index.ts:40-41 status: pending/cancelled/fulfilled`                                |
| M-07 | oidc auth_issuer 回退         | P2 接口不匹配 | ✅ 已修                        | `src/client-auth.ts:54-55` 回退分支已删（注释说明后端从未注册）                                   |
| P-01 | room_summary 批量摘要         | P1 参数错误   | ✅ 已修                        | `src/room-summary/index.ts:587 suggested_only`（注释引 `deny_unknown_fields`）                    |
| P-02 | thread 创建话题               | P1 参数错误   | ✅ 已修                        | `src/thread/index.ts:232 body: { root_event_id, content }`                                        |
| P-03 | thread 全局创建话题           | P1 参数错误   | ✅ 已修                        | 同上（walkthrough 同一条 body 构造）                                                              |
| P-04 | thread 创建回复               | P1 参数错误   | ✅ 已修                        | `src/thread/index.ts` createThreadReply 走 `root_event_id`（`IThreadReply` 契约）                 |
| P-05 | thread 标记已读               | P1 参数错误   | ✅ 已修                        | `src/thread/index.ts:450 body: { event_id, origin_server_ts }`                                    |
| P-06 | thread 订阅                   | P1 参数错误   | ✅ 已修                        | `src/thread/index.ts:477 body: { notification_level: "all" }`                                     |
| P-07 | cas proxy                     | P1 参数错误   | ✅ 已修                        | `src/cas/index.ts:436 target_service`                                                             |
| P-08 | cas validate 系列             | P2 参数错误   | ✅ 已修                        | `src/cas/index.ts:329/367 pgt_url`                                                                |
| P-09 | cas 注册服务                  | P1 参数错误   | ✅ 已修                        | `src/cas/index.ts:70-79 service_id/name/service_url_pattern`                                      |
| P-10 | e2ee 创建密钥请求             | P1 参数错误   | ✅ 已修                        | `src/room-keys/index.ts:64 algorithm: string`（必填）                                             |
| P-11 | e2ee 列表分页 limit           | P2 参数错误   | ✅ 已修                        | `src/device-keys/index.ts:445 params.limit`                                                       |
| P-12 | friend_room 添加好友          | P1 参数错误   | ✅ 已修                        | `src/friend/sub-managers/friend-request-manager.ts:114 body: { user_id, message }`                |
| R-01 | thread 回复列表形状           | P1 响应解析   | ✅ 已修                        | `src/thread/index.ts:530-541 getThreadReplies: Promise<IThreadReply[]>`（裸数组）                 |
| R-02 | thread 话题详情形状           | P2 响应解析   | ✅ 已修                        | `src/thread/index.ts:307-318` 直接 `request<IThreadDetail>`，不再取 `.thread`                     |
| R-03 | cas 校验响应格式              | P1 响应解析   | ✅ 已修                        | `src/cas/index.ts:134 parseServiceValidateText` + `:147 parseCasXmlResponse`                      |
| R-04 | media 分块上传字段            | P1 响应解析   | ✅ 已修                        | `src/media/index.ts:141-146 uploaded_chunks/uploaded_size`（注释：此前误声明 `received_bytes`）   |
| R-05 | e2ee 创建密钥请求响应         | P1 响应解析   | ✅ 已修                        | `src/e2ee/index.ts:375 Promise<{ request_id: string }>`                                           |
| R-06 | e2ee 密钥请求列表分页         | P1 响应解析   | ❌ **仍存在**                  | `src/device-keys/index.ts:160-162` 仍只有 `requests`；后端 `devices.rs:340/351` 返回 `next_batch` |

**小计**：27 项 → 已修 **25**、仍存在 **1**、设计边界 **1**。

## §4 扫描器盲区与「勿误报」清单（`仅声明` 桶的复核）

`仅声明` 共 54 条（客户端面 47）。**它们大多不是缺口** —— L2/L3 证据法只认**字面量路径**与**构造器字面量**，以下形态会被漏掉（本轮逐条回源核对）：

| 形态                  | 实例                                                                                                                              | 复核结论                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 动态模板段            | `src/content-repo.ts:96` `/_matrix/client/v1/media/${verb}`（verb ∈ download/thumbnail）                                          | media 15 条**已实现**，非缺口                                                  |
| 前缀助手 + 相对模板   | `src/room-summary/index.ts:480 rsi("/summaries")`（前缀 `/_synapse/room_summary/v1`）                                             | room_summary 3 条**已实现**，非缺口                                            |
| 构造器 + 前缀常量     | `src/key-backup/index.ts:451 kb("/room_keys/keys")`；`src/rust-crypto/backup.ts`                                                  | key_backup 18 条**已实现**，非缺口                                             |
| SDK helper `getUrl()` | `src/rendezvous/transports/MSC4108RendezvousSession.ts:106` `.getUrl("/org.matrix.msc4108/rendezvous", …, ClientPrefix.Unstable)` | msc4108_rendezvous 3 条**已实现**，非缺口                                      |
| 通用发事件端点        | `m.call.*` 走 `sendEvent` 的 `PUT /rooms/$roomId/send/$eventType/$txnId`                                                          | assembly::voip_tracking 4 条被后端路由清单收录（`room.rs:64`），SDK 已通用覆盖 |

**同一桶里非盲区、但也不属缺口的 3 类**：

- `GET /_matrix/client/v3/pushrules/global/`（含尾斜杠）：后端与 `…/global` 为**同一条路由的别名**，SDK 用不带尾斜杠形态命中（附录 B.6 已核实）⇒ 非缺口；
- `GET /_matrix/static/client/login/`：静态登录页，非 C/S API ⇒ **设计边界**，不需 SDK 封装；
- oidc 的 2 条 `/.well-known`（`jwks.json` / `openid-configuration`）：SDK 经 `src/oidc/discovery.ts`、`src/oidc/manager.ts` 构造 ⇒ **已实现**。

另有非客户端面 `仅声明` 7 条（NON_NAMESPACED 1 / ROOT_OR_SSO 2 / SERVER_ONLY 4），已在 §2.C 的边界内。

## §5 复跑命令

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
# 1) 契约差异矩阵（三级证据，本报告 §1/§2/§4 的数据源）
node scripts/audit/compare-routes.mjs --json /tmp/gap.json --output /tmp/gap.md
# 2) 契约基座是否落后后端（§2.D）
pnpm quality:contract-freshness && pnpm quality:cross-repo-pin
# 3) route-table 覆盖率与未受约束路由数
node scripts/quality/check-manager-codegen-coverage.mjs
```

> 后端事实源路径：`/Users/ljf/Desktop/hu_ts/synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md`（§模块级路由清单 L101-L1422；附录 A L1423-L1496；附录 B L1497-L1593）。
