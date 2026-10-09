# ROUTE_CONTRACT.md ↔ SDK 封装对账报告（2026-10-06 首版 / 2026-10-09 按最新代码复核重写）

> 基准文档：`synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md`（自动生成于 **2026-10-09**，**1030** 条注册路由、语义 distinct **1025**、65 个模块文件）。
> SDK 证据：`matrix-js-sdk` @ `779f17d8f` 重跑 `scripts/audit/compare-routes.mjs`，产物 `artifacts/sdk-contract-gap.json`（机器明细）+ `artifacts/sdk-contract-gap-report.md`（长表）。
> 方法：后端 1030 条逐条解析（`scope` + `registered_by`），与四级证据（T1 路由表调用点 / T2 构造 / T3 仅声明 / GAP 全无）join；`CONDITIONAL` 单独计。人工复核层承接 `sdk-contract-gap-report.md` §7（2026-10-09）。
>
> **与首版最大的差别**：首版基准是 2026-10-06 的 **1159 条**。此后后端 M2（线程族迁 vendor）、M3（46 条私有端点整批迁 vendor）、M4 D1（删 2 组真重复）把路由面降到 **1030 条**，`/_matrix/admin/v1/*` 整组消失。**旧报告的绝对条数已不可直接沿用**，故本版所有数字以 2026-10-09 重跑为准，并逐项给出两版对照。

## 1. 汇总统计

| 指标                              | 2026-10-06 首版           | 2026-10-09 复核                                  | 变化原因                                         |
| --------------------------------- | ------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| 后端注册路由（绝对去重）          | 1159                      | **1030**                                         | M2/M3 迁 vendor + M4 D1 删 2 组重复              |
| 语义 distinct（去尾斜杠孪生）     | 1154                      | **1025**                                         | 5 对孪生（见 §3.4）                              |
| SDK 镜像漂移（missing / extra）   | 0 / 0 ✅                  | **0 / 0 ✅**                                     | `contract:sync` 与 ledger 完全一致               |
| 证据分布                          | 已封 993 / 未封 165       | T1 331 / T2 563 / T3 70 / GAP 65 / CONDITIONAL 1 | 四级证据分开落盘                                 |
| 声明面覆盖（declaredCoverage）    | —                         | **732 / 1025 = 71.4%**                           | T3 声明面单独计量                                |
| 客户端面（scope = CLIENT_FACING） | 758                       | **644**                                          | M3 迁 vendor 后按新前缀重算                      |
| ├ 已封装（T1 ∪ T2）               | 678                       | **579**                                          | 同上                                             |
| ├ 机械封装率                      | 89.4%                     | **89.9%**                                        | 579 / 644                                        |
| └ 人工修正后封装率                | 92.9%                     | **94.4%**                                        | 计入假阳性 13 + 运行时族 15 + 孪生 1 = 608 / 644 |
| 客户端面未封装                    | 80                        | **65**                                           | T3 58 + GAP 7                                    |
| admin 运维面（路径前缀口径）      | 300（已封 265 / 未封 35） | **290（已封 265 / 未封 25）**                    | M4 D1 删重复挂载 + M3 移出 vendor                |

> 客户端面 = `CLIENT_FACING`（`/_matrix/client/*`、`/_synapse` 非 admin、`/_matrix/vendor/*`、`/.well-known/*` 中 SDK 相关），口径由 `compare-routes.mjs` 的 `scopeOf` 给出。

## 2. 关于「文档标注无需封装」的诚实声明

`ROUTE_CONTRACT.md` 中**不存在**任何字面的「无需封装」标注。本报告的「不该封/不必封」判定全部来自架构位置与人工复核，出处如下：

| 分类                                    | 条数             | 出处 / 依据                                                          |
| --------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| S2S 联邦协议（`/_matrix/federation/*`） | 26               | 服务器间协议，客户端 SDK 无调用方（§5.1）                            |
| 服务端密钥查询（`/_matrix/key/v2/*`）   | 4                | 服务器间密钥交换（§5.4）                                             |
| AS→HS 回调（`/_matrix/app/v1/*`）       | 12               | appservice 实现侧回调（§5.2）                                        |
| 根级探活/无前缀                         | 3                | 文档「前缀之外」节：有意的根级探活端点（§5.3）                       |
| admin 运维面                            | （25 条单列 §4） | 本 fork 的 AdminManager **有意**封装 admin，不能按上游口径排除       |
| 客户端面 T3 仅声明                      | 58（§3）         | 声明面命中但源码无构造/调用点                                        |
| 客户端面 GAP                            | 7（§3.1）        | appservice 代理透传含 `{*path}` 通配符，codegen 无法生成 route-table |

> 合计校验：排除类 45 + admin 25 + 客户端 T3 58 + 客户端 GAP 7 = **135** 条 = T3 70 + GAP 65 ✅

## 3. 客户端面未封装明细（65 条 = T3 58 + GAP 7，重分类后）

### 3.1 真缺口（28 条，需产品决策是否补封装）

**密钥备份 `{version}` 规范路径（18 条）** — Matrix 规范要求带 `{version}` 段；本 fork 的 SDK 走**无版本**变体（`/_matrix/client/{v1,v3}/room_keys/keys`，有 T2 证据）。若要与其它 homeserver 互通需补。

- `DELETE` `/_matrix/client/v1/room_keys/{version}/keys`
- `GET` `/_matrix/client/v1/room_keys/{version}/keys`
- `PUT` `/_matrix/client/v1/room_keys/{version}/keys`
- `DELETE` `/_matrix/client/v1/room_keys/{version}/keys/{room_id}`
- `GET` `/_matrix/client/v1/room_keys/{version}/keys/{room_id}`
- `PUT` `/_matrix/client/v1/room_keys/{version}/keys/{room_id}`
- `DELETE` `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}`
- `GET` `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}`
- `PUT` `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}`
- `DELETE` `/_matrix/client/v3/room_keys/{version}/keys`
- `GET` `/_matrix/client/v3/room_keys/{version}/keys`
- `PUT` `/_matrix/client/v3/room_keys/{version}/keys`
- `DELETE` `/_matrix/client/v3/room_keys/{version}/keys/{room_id}`
- `GET` `/_matrix/client/v3/room_keys/{version}/keys/{room_id}`
- `PUT` `/_matrix/client/v3/room_keys/{version}/keys/{room_id}`
- `DELETE` `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}`
- `GET` `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}`
- `PUT` `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}`

**MSC4155 / MSC4156 线程不稳定变体（2 条）** — `src` 中 0 命中（仅存在于 `src/thread/__generated__/route-table.ts` 声明面）；人工复核判定需与 Sprint 4 交付范围、`MSC_SEMANTICS.md` 对账。

- `GET` `/_matrix/client/unstable/org.matrix.msc4155/rooms/{room_id}/threads`
- `GET` `/_matrix/client/unstable/org.matrix.msc4156/threads/subscribed`

**好友请求收件箱（1 条）** — M3 把该端点从 `/_matrix/client/v1` 移到 `/_matrix/vendor/v1`，SDK 未封装 vendor 租约。

- `GET` `/_matrix/vendor/v1/friends/request/received`

**AppService 代理透传（7 条，GAP）** — 路径含 `{*path}` 通配符，codegen 无法为其生成 route-table；是否有前端消费场景待产品确认。

| Method    | Path                                       | 证据 |
| --------- | ------------------------------------------ | ---- |
| `DELETE`  | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP  |
| `GET`     | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP  |
| `HEAD`    | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP  |
| `OPTIONS` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP  |
| `PATCH`   | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP  |
| `POST`    | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP  |
| `PUT`     | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP  |

### 3.2 工具盲区·假阳性（13 条，人工核验实际已封装，不计缺口）

| Method               | Path                                                                          | 实际封装位置 / 判定                                                                        | 盲区成因                               |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| `GET`                | `/_synapse/cas/p3/serviceValidate`                                            | `CasManager.p3ServiceValidate()`（`src/cas/index.ts`）                                     | prefix 变量                            |
| `GET`                | `/_synapse/cas/proxy`                                                         | `CasManager.proxy()`（`src/cas/index.ts`）                                                 | prefix 变量                            |
| `GET`                | `/_synapse/cas/proxyValidate`                                                 | `CasManager.proxyValidate()`（`src/cas/index.ts`）                                         | prefix 变量                            |
| `GET`                | `/_synapse/room_summary/v1/summaries`                                         | `internalSummaryPath('/summaries')`（`src/room-summary/index.ts`）                         | helper 中转                            |
| `POST`               | `/_synapse/room_summary/v1/summaries`                                         | 同上                                                                                       | helper 中转                            |
| `POST`               | `/_synapse/room_summary/v1/updates/process`                                   | `internalSummaryPath('/updates/process')`（room-event-operation-manager）                  | helper 中转                            |
| `PUT`                | `/_matrix/client/v3/rooms/{room_id}/send/m.call.answer/{txn_id}`              | 泛型 `send/{event_type}` 已封装（T2）                                                      | 泛型覆盖                               |
| `PUT`                | `/_matrix/client/v3/rooms/{room_id}/send/m.call.candidates/{txn_id}`          | 同上                                                                                       | 泛型覆盖                               |
| `PUT`                | `/_matrix/client/v3/rooms/{room_id}/send/m.call.hangup/{txn_id}`              | 同上                                                                                       | 泛型覆盖                               |
| `PUT`                | `/_matrix/client/v3/rooms/{room_id}/send/m.call.invite/{txn_id}`              | 同上                                                                                       | 泛型覆盖                               |
| `DELETE`/`GET`/`PUT` | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous/{session_id}`（3 条） | `MSC4108RendezvousSession.ts:106` 的 `.getUrl(..., ClientPrefix.Unstable)`，三方法共用基址 | `getUrl(relative, query, prefix)` 形态 |

> 前 10 条承接首版报告的人工核验结论；后 3 条（MSC4108）是 `sdk-contract-gap-report.md` §7（2026-10-09）新增的**解析器盲区**判定 —— 生成器看不到 `getUrl()` 形态，重跑后仍会落回 T3。

### 3.3 运行时版本参数族（15 条，构造存在但静态不可归属）

`src/media/index.ts` 的 `getDownloadUrl()` 以 `const version = options.version ?? 'v3'` 运行时拼 `/_matrix/media/${version}/download/...`；`content-repo.ts`（mxcUrlToHttp）同理。具体命中 r0/r1/v1/v3 哪个变体取决于运行时配置，静态审计无法按 `(method,path)` 归属。

- `GET` `/_matrix/client/v1/media/download/{server_name}/{media_id}`
- `GET` `/_matrix/client/v1/media/download/{server_name}/{media_id}/{filename}`
- `GET` `/_matrix/client/v1/media/preview_url`
- `GET` `/_matrix/client/v1/media/thumbnail/{server_name}/{media_id}`
- `GET` `/_matrix/media/r0/download/{server_name}/{media_id}`
- `GET` `/_matrix/media/r0/download/{server_name}/{media_id}/{filename}`
- `GET` `/_matrix/media/r1/download/{server_name}/{media_id}`
- `GET` `/_matrix/media/r1/download/{server_name}/{media_id}/{filename}`
- `GET` `/_matrix/media/v1/download/{server_name}/{media_id}`
- `GET` `/_matrix/media/v1/download/{server_name}/{media_id}/{filename}`
- `GET` `/_matrix/media/v3/download/{server_name}/{media_id}`
- `GET` `/_matrix/media/v3/download/{server_name}/{media_id}/{filename}`
- `GET` `/_matrix/media/v3/download_signed/{server_name}/{media_id}`
- `GET` `/_matrix/media/v3/download_signed/{server_name}/{media_id}/{filename}`
- `GET` `/_matrix/media/v3/thumbnail/{server_name}/{media_id}`

### 3.4 尾斜杠孪生（1 条）

- `GET /_matrix/client/v3/pushrules/global/` —— 与已封装的 `/pushrules/global`（`push.rs` 注册）为同能力孪生注册，无独立封装必要。

> 全库口径：1030 条绝对注册里恰好有 **5 对**尾斜杠孪生（实测 `(method, path[:-1])` 同时存在者）：
> `GET|POST /_matrix/client/v3/pushers/`、`GET /_matrix/client/v3/pushrules/`、
> `GET|PUT /_matrix/client/v3/rooms/{room_id}/state/{event_type}/`，故语义 distinct = 1025。
> 文档头部只声明了 always/oidc 双档 2 对，**未覆盖这 5 对**（§6 建议补）。

### 3.5 浏览器/邮件/IdP 流端点（8 条，人工判定无需 SDK 直接封装）

| Method | Path                                                    | 判定依据                                   |
| ------ | ------------------------------------------------------- | ------------------------------------------ |
| `GET`  | `/.well-known/jwks.json`                                | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |
| `GET`  | `/.well-known/openid-configuration`                     | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |
| `POST` | `/_matrix/client/v1/account/3pid/email/submitToken`     | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |
| `POST` | `/_matrix/client/v1/account/password/email/submitToken` | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |
| `POST` | `/_matrix/client/v3/account/3pid/email/submitToken`     | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |
| `POST` | `/_matrix/client/v3/account/password/email/submitToken` | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |
| `GET`  | `/_matrix/client/v3/login/sso/redirect/cas`             | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |
| `GET`  | `/_matrix/static/client/login/`                         | 浏览器/邮件链接落地流，由浏览器或 IdP 消费 |

## 4. admin 运维面未封装（25 条）

本 fork 的 AdminManager **有意**封装 admin API。admin 前缀（`/_synapse/admin/*` + `/_matrix/admin/*`）共 **290** 条，已封 **265** 条（91.4%），未封 **25** 条，全部落在 `SERVER_ONLY` 范围（工具判定为服务端运维面）。

> 与首版对照：首版 admin 面 300 条、未封 35 条；差额来自 M4 D1 删掉同名重复挂载（`admin/media.rs` 的单数 `/room/{room_id}/media*` 变体）与 M3 把 `/_matrix/admin/v1/*` 移出。

**?（9 条）**

- `GET` `/_synapse/admin/v1/cas/services`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/cas/services`（SERVER_ONLY）
- `DELETE` `/_synapse/admin/v1/cas/services/{service_id}`（SERVER_ONLY）
- `GET` `/_synapse/admin/v1/cas/users/{user_id}/attributes`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/cas/users/{user_id}/attributes`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/push/cleanup`（SERVER_ONLY）
- `GET` `/_synapse/admin/v1/push/config`（SERVER_ONLY）
- `PUT` `/_synapse/admin/v1/push/config`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/push/process`（SERVER_ONLY）

**admin/media（12 条）**

- `POST` `/_synapse/admin/v1/media/delete`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/media/protect/{media_id}`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/media/protect/{server_name}/{media_id}`（SERVER_ONLY）
- `GET` `/_synapse/admin/v1/media/quarantine_changes`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/media/unprotect/{media_id}`（SERVER_ONLY）
- `DELETE` `/_synapse/admin/v1/media/{server_name}/{media_id}`（SERVER_ONLY）
- `GET` `/_synapse/admin/v1/media/{server_name}/{media_id}`（SERVER_ONLY）
- `GET` `/_synapse/admin/v1/rooms/{room_id}/media`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/rooms/{room_id}/media/quarantine`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/rooms/{room_id}/media/unquarantine`（SERVER_ONLY）
- `DELETE` `/_synapse/admin/v1/rooms/{room_id}/media/{media_id}`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/user/{user_id}/media/quarantine`（SERVER_ONLY）

**admin/room（2 条）**

- `POST` `/_synapse/admin/v1/rooms/{room_id}/backfill`（SERVER_ONLY）
- `POST` `/_synapse/admin/v1/rooms/{room_id}/cascade_redact`（SERVER_ONLY）

**admin/server（1 条）**

- `GET` `/_synapse/admin/v1/rate-limit-status`（SERVER_ONLY）

**app_service（1 条）**

- `GET` `/_synapse/admin/v1/appservices/{as_id}/state/{state_key}`（SERVER_ONLY）

> 注意：这 25 条的 `registered_by` 分属 `admin::media`/`admin::room`/`admin::server` 与 `app_service`/`cas`/`push_notification`，**不等于** `ROUTE_CONTRACT.md` 的「管理 (Admin)」章节。

## 5. 排除类明细（45 条）

### 5.1 S2S 联邦协议（26 条，`/_matrix/federation/*`）

- `PUT` `/_matrix/federation/v1/exchange_third_party_invite/{room_id}`
- `GET` `/_matrix/federation/v1/get_event_auth/{room_id}/{event_id}`
- `POST` `/_matrix/federation/v1/get_missing_events/{room_id}`
- `PUT` `/_matrix/federation/v1/invite/{room_id}/{event_id}`
- `POST` `/_matrix/federation/v1/knock/{room_id}/{user_id}`
- `GET` `/_matrix/federation/v1/make_join/{room_id}/{user_id}`
- `GET` `/_matrix/federation/v1/make_leave/{room_id}/{user_id}`
- `GET` `/_matrix/federation/v1/openid/userinfo`
- `GET` `/_matrix/federation/v1/query/directory/room/{room_id}`
- `GET` `/_matrix/federation/v1/query/profile`
- `PUT` `/_matrix/federation/v1/send/{txn_id}`
- `PUT` `/_matrix/federation/v1/send_join/{room_id}/{event_id}`
- `PUT` `/_matrix/federation/v1/send_leave/{room_id}/{event_id}`
- `POST` `/_matrix/federation/v1/thirdparty/invite`
- `GET` `/_matrix/federation/v1/timestamp_to_event/{room_id}`
- `GET` `/_matrix/federation/v1/user/devices/{user_id}`
- `POST` `/_matrix/federation/v1/user/keys/claim`
- `POST` `/_matrix/federation/v1/user/keys/query`
- `POST` `/_matrix/federation/v1/user/keys/upload`
- `PUT` `/_matrix/federation/v2/invite/{room_id}/{event_id}`
- `GET` `/_matrix/federation/v2/query/{server_name}`
- `GET` `/_matrix/federation/v2/query/{server_name}/{key_id}`
- `PUT` `/_matrix/federation/v2/send_join/{room_id}/{event_id}`
- `PUT` `/_matrix/federation/v2/send_leave/{room_id}/{event_id}`
- `GET` `/_matrix/federation/v2/server`
- `POST` `/_matrix/federation/v2/user/keys/query`

### 5.2 AS→HS 回调（12 条，`/_matrix/app/v1/*`）

- `POST` `/_matrix/app/v1/ping`
- `DELETE` `/_matrix/app/v1/proxy/{as_id}/{*path}`
- `GET` `/_matrix/app/v1/proxy/{as_id}/{*path}`
- `HEAD` `/_matrix/app/v1/proxy/{as_id}/{*path}`
- `OPTIONS` `/_matrix/app/v1/proxy/{as_id}/{*path}`
- `PATCH` `/_matrix/app/v1/proxy/{as_id}/{*path}`
- `POST` `/_matrix/app/v1/proxy/{as_id}/{*path}`
- `PUT` `/_matrix/app/v1/proxy/{as_id}/{*path}`
- `GET` `/_matrix/app/v1/rooms/{alias}`
- `PUT` `/_matrix/app/v1/transactions/{as_id}/{txn_id}`
- `GET` `/_matrix/app/v1/users/{user_id}`
- `GET` `/_matrix/app/v1/{as_id}`

### 5.3 根级探活（3 条）

- `GET` `/`
- `GET` `/_health`
- `GET` `/health`

### 5.4 服务端密钥查询（4 条，`/_matrix/key/v2/*`）

- `POST` `/_matrix/key/v2/query`
- `GET` `/_matrix/key/v2/query/{server_name}`
- `GET` `/_matrix/key/v2/query/{server_name}/{key_id}`
- `GET` `/_matrix/key/v2/server`

## 6. 文档状态与实际情况不一致项

1. **文档 ↔ ledger fixture：完全一致 ✅** —— `ROUTE_CONTRACT.md` 的 1030 条与 `tests/unit/fixtures/ledger_export_sdk/all.json` 逐条比对 0 差异；模块文件 65 个（文档口径）。机器侧 `registered_by` 根模块为 49 个（§7 按此分组），两种粒度不同，不是矛盾。
2. **SDK 镜像零漂移 ✅** —— `route-manifest.all.json` 与 ledger 比对 missing 0 / extra 0。
3. **尾斜杠孪生 5 对**（1030 → 1025，见 §3.4）：文档头部只声明了 always/oidc 双档 2 对，**建议补一句**，避免下游把 1030 当作 1030 个独立能力。
4. **M3 的 vendor 迁移改变了本报告口径**：`/_matrix/admin/v1/*` 整组（含 `external_services` 5 条）已随后端删除；`friends/request/received` 只剩 `/_matrix/vendor/v1` 租约；线程族 27 条迁 `/_matrix/vendor/v1`。首版报告里凡以 client/v1、client/v3 或 admin/v1 记的条目，本版按新前缀重算。
5. **工具盲区仍需人工兜底（29 条）**：假阳性 10 + 解析器盲区 3（MSC4108）+ 运行时族 15 + 孪生 1。重跑生成器**不会**自动修正它们，`sdk-contract-gap-report.md` §7.1 列出四类盲区与兜底方式。
6. **两处口径冲突待定向复核**：`sdk-contract-gap-report.md` §7 的人工记录判定 `/client/unstable/org.matrix.msc2965/*`（人工记录写 `auth_issuer`，当前 fixture 是 `auth_metadata`）与 `POST /_matrix/client/v3/admin/room/{room_id}/redact` 为**真缺口**（`src` 中 0 命中），而机器把它们算进了已封装（T1/T2）。二者必有一错：要么解析器把通用 `redact`/`auth_*` 模式误配，要么人工 grep 范围不足。**复核**：`grep -rn 'admin/room' src` 与 `grep -rn 'msc2965' src --include='*.ts'` 剔除 `__generated__`，确认为 0 后应把这两条并入 §3.1 并修工具规则。
7. **T1 明细未落盘**：`sdk-contract-gap.json` 只给 T1 总数（331），没有逐条清单，故 §7 的「已封装」= 总条数 −（GAP + T3），即 T1∪T2（与首版口径一致，可直接对比）。
8. **本报告定稿时 `develop` 工作树有另一写者的在飞改动**（`src/cas/index.ts`、`src/friend/sub-managers/friend-request-manager.ts`、`src/room-keys/index.ts`、`src/room-summary*` 及其 spec），正好命中 §3.2 假阳性条目与 §3.1 的 room_keys 真缺口 ⇒ **该批次落地后必须重跑本报告**（复现命令见文末）；本版数字对应 `779f17d8f` 提交态。

## 7. 逐模块封装总表

| 模块（`registered_by` 根） | 条目数 | 已封装(T1∪T2) | 未封装(T3∪GAP) |
| -------------------------- | ------ | ------------- | -------------- |
| federation                 | 55     | 25            | 30             |
| app_service                | 39     | 19            | 20             |
| admin                      | 179    | 164           | 15             |
| assembly                   | 104    | 104           | 0              |
| room                       | 95     | 95            | 0              |
| key_backup                 | 66     | 66            | 0              |
| e2ee                       | 36     | 36            | 0              |
| media                      | 36     | 36            | 0              |
| friend_room                | 29     | 29            | 0              |
| space                      | 26     | 26            | 0              |
| module                     | 23     | 23            | 0              |
| thread                     | 23     | 23            | 0              |
| room_summary               | 21     | 21            | 0              |
| background_update          | 19     | 19            | 0              |
| event_report               | 18     | 18            | 0              |
| push                       | 17     | 17            | 0              |
| saml                       | 16     | 16            | 0              |
| widget                     | 16     | 16            | 0              |
| account_data               | 15     | 15            | 0              |
| worker                     | 15     | 15            | 0              |
| cas                        | 12     | 12            | 0              |
| external_service           | 12     | 12            | 0              |
| voice                      | 12     | 12            | 0              |
| worker_body                | 11     | 11            | 0              |
| oidc                       | 10     | 10            | 0              |
| key_rotation               | 9      | 9             | 0              |
| presence                   | 9      | 9             | 0              |
| relations                  | 9      | 9             | 0              |
| push_notification          | 8      | 8             | 0              |
| search                     | 8      | 8             | 0              |
| burn_after_read            | 7      | 7             | 0              |
| device                     | 6      | 6             | 0              |
| moderation                 | 6      | 6             | 0              |
| rendezvous                 | 6      | 6             | 0              |
| telemetry                  | 6      | 6             | 0              |
| thirdparty                 | 6      | 6             | 0              |
| captcha                    | 5      | 5             | 0              |
| dm                         | 5      | 5             | 0              |
| typing                     | 5      | 5             | 0              |
| feature_flags              | 4      | 4             | 0              |
| invite_blocklist           | 4      | 4             | 0              |
| msc4108_rendezvous         | 4      | 4             | 0              |
| sliding_sync               | 4      | 4             | 0              |
| tags                       | 4      | 4             | 0              |
| guest                      | 3      | 3             | 0              |
| sync                       | 3      | 3             | 0              |
| delayed_events             | 2      | 2             | 0              |
| ephemeral                  | 1      | 1             | 0              |
| reactions                  | 1      | 1             | 0              |

> **口径说明**：本表按 ledger 的 `registered_by` 根模块分组（49 个），与 `ROUTE_CONTRACT.md` 的**章节模块**不同 —— 文档把 `admin/media.rs` 归入「媒体 (Media)」、`cas.rs` 的 admin 路由归「CAS」。因此本表的 `admin` 不等于 §1/§4 的「admin 路径前缀面（290 条）」。未封装列合计 = 135（T3 70 + GAP 65）✅

---

**生成方式**：`artifacts/sdk-contract-gap.json`（`scripts/audit/compare-routes.mjs` 于 2026-10-09 重跑）→ 一次性脚本按 `scope`/`registered_by` 聚合 → 叠加人工复核层（承接首版 §3.2 与 `sdk-contract-gap-report.md` §7）→ `prettier --write`。

**复现命令**：

```bash
# 1) 刷新后端 ledger 事实面（离线可跑）
cd ../synapse-rust && ./scripts/generate_sdk_ledger_fixtures.sh
# 2) 刷新 SDK 镜像底座 + route-table codegen
cd ../matrix-js-sdk && pnpm contract:sync && pnpm contract:codegen
# 3) 重新生成缺口报告 + 附录 JSON（两个产物必须一起刷）
node scripts/audit/compare-routes.mjs --output artifacts/sdk-contract-gap-report.md --json artifacts/sdk-contract-gap.json
```
