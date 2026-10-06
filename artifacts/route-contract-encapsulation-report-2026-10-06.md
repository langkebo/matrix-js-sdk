# ROUTE_CONTRACT.md ↔ SDK 封装对账报告（2026-10-06）

> 基准文档：`synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md`（自动生成于 2026-10-06，1159 条注册路由）
> SDK 证据：`matrix-js-sdk` 全量源码扫描（`scripts/audit/compare-routes.mjs` 于 2026-10-06 重跑，含当日 assembly→auth 映射等全部改动）
> 方法：文档 1159 条逐条解析（模块/文件/标注），与三级证据（T1 调用点 / T2 构造 / T3 仅声明 / GAP 全无）逐条 join，可疑项逐个人工核验源码。

## 1. 汇总统计

| 指标 | 数值 |
| --- | --- |
| 后端注册路由总数（文档口径） | **1159**（`(method,path)` 绝对去重） |
| └ 语义 distinct（去掉 5 对尾斜杠孪生注册） | 1154 |
| └ 默认构建不注册（profile 门控） | 19（仅 worker 11 + 仅 oidc 8，全部已有 SDK 证据） |
| **SDK 已封装（T1∪T2，全量口径）** | **993 / 1159 = 85.7%** |
| SDK 未封装（T3∪GAP） | 165（另 1 条条件证据，工具未展开） |
| 未封装──排除·服务端/内部面 | 42（S2S 联邦 30 + AS 回调 12） |
| 未封装──排除·根级探活/遗留 | 8（探活 3 + CAS legacy root 5） |
| 未封装──admin 运维面（本 fork 有意封装，按路径前缀 `/_synapse/admin/*`+`/_matrix/admin/*` 计 300 条，已封 265 = 88.3%） | 35（明细见 §4） |
| 未封装──客户端面 | 80 = 真缺口 46 + 工具盲区假阳性 10 + 运行时版本族 15 + 尾斜杠孪生 1 + 浏览器流 8 |
| **客户端面封装率（机械口径）** | **678 / 758 = 89.4%** |
| **客户端面封装率（人工修正后）** | **704 / 758 = 92.9%**（计入假阳性 10 + 运行时族 15 + 孪生 1） |

> 客户端面 = 758 条（`/_matrix/client`、`/_synapse` 非内部、`/.well-known` 中 SDK 相关），口径与 `compare-routes.mjs` 的 `scopeOf` 一致。

## 2. 关于「文档标注无需封装」的诚实声明

**ROUTE_CONTRACT.md 中不存在任何字面的「无需封装」标注。** 因此本报告的排除依据为三级，全部注明出处：

| 排除类 | 条数 | 依据 |
| --- | --- | --- |
| S2S 联邦协议（`/_matrix/federation/*`） | 30 | Matrix 架构：服务器间协议，客户端 SDK 无调用方；文档将其单列为「联邦」模块 |
| AS→HS 回调（`/_matrix/app/v1/*`） | 12 | Matrix 架构：appservice 实现侧的回调端点（transaction/ping 等），由 AS 服务消费而非客户端 |
| 根级探活（`/`、`/health`、`/_health`） | 3 | 文档「前缀之外」节明确：有意的根级协议与探活端点 |
| CAS legacy root（`/admin/services*`、`/admin/users/*`） | 5 | 文档「前缀之外」节：历史根级注册；SDK CasManager 实际走 `/_synapse/cas/*` 前缀 |
| admin 运维面 | （35 不计入排除，单列 §4） | **本 fork 特殊**：AdminManager 有意封装 admin（`adminRequest` 调用点 281 处，解析出 211 条 admin 路由），故不能按上游口径排除 |

## 3. 客户端面未封装明细（80 条，重分类后）

### 3.1 真缺口（46 条，需产品决策是否补封装）

**MSC4108（3 条）** — MSC4108 QR 登录会话的 GET/PUT/DELETE 未封装（模块仅封装了创建等部分端点）

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `DELETE` | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous/{session_id}` | T3 |  |
| `GET` | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous/{session_id}` | T3 |  |
| `PUT` | `/_matrix/client/unstable/org.matrix.msc4108/rendezvous/{session_id}` | T3 |  |

**其他 (Other)（2 条）** — unstable 变体未封装；SDK 已封装 v1 稳定版 threads（21 条 v1 端点有证据）

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `GET` | `/_matrix/client/unstable/org.matrix.msc4155/rooms/{room_id}/threads` | T3 |  |
| `GET` | `/_matrix/client/unstable/org.matrix.msc4156/threads/subscribed` | T3 |  |

**好友 (Friends)（2 条）** — 好友请求「收件箱」查询未封装（client/v1 与 vendor/v1 两个租约都缺）

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `GET` | `/_matrix/client/v1/friends/request/received` | T3 |  |
| `GET` | `/_matrix/vendor/v1/friends/request/received` | T3 |  |

**密钥备份 (Key Backup)（18 条）** — Matrix 标准规范路径（带 {version} 段）未封装；SDK 使用 fork 自定义的无版本变体（如 `/_matrix/client/v1/room_keys/keys`，有 T2 证据）——若需与其他 homeserver 互通应补

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `DELETE` | `/_matrix/client/v1/room_keys/{version}/keys` | T3 |  |
| `GET` | `/_matrix/client/v1/room_keys/{version}/keys` | T3 |  |
| `PUT` | `/_matrix/client/v1/room_keys/{version}/keys` | T3 |  |
| `DELETE` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}` | T3 |  |
| `GET` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}` | T3 |  |
| `PUT` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}` | T3 |  |
| `DELETE` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}` | T3 |  |
| `GET` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}` | T3 |  |
| `PUT` | `/_matrix/client/v1/room_keys/{version}/keys/{room_id}/{session_id}` | T3 |  |
| `DELETE` | `/_matrix/client/v3/room_keys/{version}/keys` | T3 |  |
| `GET` | `/_matrix/client/v3/room_keys/{version}/keys` | T3 |  |
| `PUT` | `/_matrix/client/v3/room_keys/{version}/keys` | T3 |  |
| `DELETE` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}` | T3 |  |
| `GET` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}` | T3 |  |
| `PUT` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}` | T3 |  |
| `DELETE` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}` | T3 |  |
| `GET` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}` | T3 |  |
| `PUT` | `/_matrix/client/v3/room_keys/{version}/keys/{room_id}/{session_id}` | T3 |  |

**应用服务 (AppService)（7 条）** — 三级证据全无（GAP）：appservice 代理透传端点，含 `{*path}` 通配符，codegen 无法为其生成 route-table；是否有前端消费场景待确认

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `DELETE` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP |  |
| `GET` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP |  |
| `HEAD` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP |  |
| `OPTIONS` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP |  |
| `PATCH` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP |  |
| `POST` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP |  |
| `PUT` | `/_matrix/client/v1/proxy/{as_id}/{*path}` | GAP |  |

**房间 (Room)（8 条）** — 见逐条备注

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `POST` | `/_matrix/client/v1/rooms/create_private` | T3 | fork 私有「创建私聊房间」v1 租约未封装 |
| `GET` | `/_matrix/client/v1/user/mutual_rooms` | T3 | v1 稳定版未封装；SDK 封装的是 unstable msc2666 变体（有 T2 证据） |
| `POST` | `/_matrix/client/v3/invite/{room_id}` | T3 | legacy 按 room_id 邀请路径；SDK 走 `/rooms/{room_id}/invite`（已封装） |
| `POST` | `/_matrix/client/v3/rooms/create_private` | T3 | 同上 v3 租约 |
| `GET` | `/_matrix/client/v3/rooms/{room_id}/keys` | T3 | 房间密钥列表端点未封装（keys/distribution 深层端点已封装） |
| `GET` | `/_matrix/client/v3/rooms/{room_id}/visibility` | T3 | 房间可见性查询未封装 |
| `PUT` | `/_matrix/client/v3/rooms/{room_id}/visibility` | T3 | 房间可见性设置未封装 |
| `GET` | `/_matrix/client/v3/user/{user_id}/rooms` | T3 | 按用户列房间未封装 |

**推送 (Push)（4 条）** — 推送设备管理（push/devices）与推送发送（push/send）未封装

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `GET` | `/_matrix/client/v3/push/devices` | T3 |  |
| `POST` | `/_matrix/client/v3/push/devices` | T3 |  |
| `DELETE` | `/_matrix/client/v3/push/devices/{device_id}` | T3 |  |
| `POST` | `/_matrix/client/v3/push/send` | T3 |  |

**装配 (Assembly)（2 条）** — voip 配置端点未封装（标准 turnServer 已封装，guest 变体与 config 未封装）

| Method | Path | 证据 | 备注 |
| --- | --- | --- | --- |
| `GET` | `/_matrix/client/v3/voip/config` | T3 |  |
| `GET` | `/_matrix/client/v3/voip/turnServer/guest` | T3 |  |

### 3.2 工具盲区·假阳性（10 条，人工核验实际已封装，不计缺口）

| Method | Path | 实际封装位置 | 盲区成因 |
| --- | --- | --- | --- |
| `PUT` | `/_matrix/client/v3/rooms/{room_id}/send/m.call.answer/{txn_id}` | `泛型 send/{event_type} 已封装（T2）` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `PUT` | `/_matrix/client/v3/rooms/{room_id}/send/m.call.candidates/{txn_id}` | `泛型 send/{event_type} 已封装（T2）` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `PUT` | `/_matrix/client/v3/rooms/{room_id}/send/m.call.hangup/{txn_id}` | `泛型 send/{event_type} 已封装（T2）` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `PUT` | `/_matrix/client/v3/rooms/{room_id}/send/m.call.invite/{txn_id}` | `泛型 send/{event_type} 已封装（T2）` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `GET` | `/_synapse/cas/p3/serviceValidate` | `CasManager.p3ServiceValidate() src/cas/index.ts:294` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `GET` | `/_synapse/cas/proxy` | `CasManager.proxy() src/cas/index.ts:315` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `GET` | `/_synapse/cas/proxyValidate` | `CasManager.proxyValidate() src/cas/index.ts:273` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `GET` | `/_synapse/room_summary/v1/summaries` | `internalSummaryPath("/summaries") src/room-summary/index.ts:346` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `POST` | `/_synapse/room_summary/v1/summaries` | `internalSummaryPath("/summaries") src/room-summary/index.ts:346` | prefix 变量 / helper 中转 / 泛型覆盖 |
| `POST` | `/_synapse/room_summary/v1/updates/process` | `internalSummaryPath("/updates/process") room-event-operation-manager.ts` | prefix 变量 / helper 中转 / 泛型覆盖 |

### 3.3 运行时版本参数族（15 条，构造存在但静态不可归属）

`src/media/index.ts:452-453` 以 `/_matrix/media/${version}/download` 运行时拼版本，`content-repo.ts`（mxcUrlToHttp）同理构造下载/缩略图 URL；具体命中 r0/r1/v1/v3 哪个变体取决于运行时配置，静态审计无法按 (method,path) 归属。清单：

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

- `GET /_matrix/client/v3/pushrules/global/` —— 与已封装的 `/pushrules`（push.rs 注册）为同能力孪生注册，无独立封装必要。

### 3.5 浏览器/邮件/IdP 流端点（8 条，人工判定无需 SDK 直接封装）

| Path | 判定依据 |
| --- | --- |
| `GET /_matrix/client/v3/login/sso/redirect/cas` | 浏览器 SSO 重定向流；SDK oidc 已封装通用 `/login/sso/redirect` |
| `GET /.well-known/jwks.json`、`GET /.well-known/openid-configuration` | OIDC 发现端点，由 IdP/浏览器消费 |
| `POST .../account/3pid/email/submitToken`、`POST .../account/password/email/submitToken`（v1/v3 各 2） | 邮件验证链接的浏览器落地页流；SDK 已封装 `register/email/submitToken` |
| `GET /_matrix/static/client/login/` | 服务端渲染静态登录页 |

## 4. admin 运维面未封装（35 条）

本 fork 的 AdminManager **有意**封装 admin API（`adminRequest` 调用点 281 处 = 163 非泛型 + 118 泛型，解析出 211 条不同 admin 路由；admin 前缀路由 300 条中已封 265 条）。剩余 35 条按文档子文件分组（注意：这 35 条分属 6 个文档章节，非仅「管理 (Admin)」章节）：

**admin/media.rs（16 条）**

- `POST` `/_synapse/admin/v1/media/delete`（GAP）
- `POST` `/_synapse/admin/v1/media/protect/{media_id}`（GAP）
- `POST` `/_synapse/admin/v1/media/protect/{server_name}/{media_id}`（GAP）
- `POST` `/_synapse/admin/v1/media/quarantine/{server_name}/{media_id}`（GAP）
- `GET` `/_synapse/admin/v1/media/quarantine_changes`（GAP）
- `POST` `/_synapse/admin/v1/media/unprotect/{media_id}`（GAP）
- `POST` `/_synapse/admin/v1/media/unquarantine/{server_name}/{media_id}`（GAP）
- `DELETE` `/_synapse/admin/v1/media/{server_name}/{media_id}`（GAP）
- `GET` `/_synapse/admin/v1/media/{server_name}/{media_id}`（GAP）
- `GET` `/_synapse/admin/v1/room/{room_id}/media`（GAP）
- `POST` `/_synapse/admin/v1/room/{room_id}/media/quarantine`（GAP）
- `GET` `/_synapse/admin/v1/rooms/{room_id}/media`（GAP）
- `POST` `/_synapse/admin/v1/rooms/{room_id}/media/quarantine`（GAP）
- `POST` `/_synapse/admin/v1/rooms/{room_id}/media/unquarantine`（GAP）
- `DELETE` `/_synapse/admin/v1/rooms/{room_id}/media/{media_id}`（GAP）
- `POST` `/_synapse/admin/v1/user/{user_id}/media/quarantine`（GAP）

**admin/room/mod.rs（2 条）**

- `POST` `/_synapse/admin/v1/rooms/{room_id}/backfill`（GAP）
- `POST` `/_synapse/admin/v1/rooms/{room_id}/cascade_redact`（GAP）

**admin/server.rs（2 条）**

- `GET` `/_synapse/admin/v1/rate-limit-status`（GAP）
- `GET` `/_synapse/admin/v1/server`（GAP）

**app_service.rs（1 条）**

- `GET` `/_synapse/admin/v1/appservices/{as_id}/state/{state_key}`（GAP）

**cas.rs（5 条）**

- `GET` `/_synapse/admin/v1/cas/services`（T3）
- `POST` `/_synapse/admin/v1/cas/services`（T3）
- `DELETE` `/_synapse/admin/v1/cas/services/{service_id}`（T3）
- `GET` `/_synapse/admin/v1/cas/users/{user_id}/attributes`（T3）
- `POST` `/_synapse/admin/v1/cas/users/{user_id}/attributes`（T3）

**external_service.rs（5 条）**

- `GET` `/_matrix/admin/v1/external_services`（T3）
- `POST` `/_matrix/admin/v1/external_services`（T3）
- `GET` `/_matrix/admin/v1/external_services/health`（T3）
- `DELETE` `/_matrix/admin/v1/external_services/{as_id}`（T3）
- `PUT` `/_matrix/admin/v1/external_services/{as_id}`（T3）

**push_notification.rs（4 条）**

- `POST` `/_synapse/admin/v1/push/cleanup`（T3）
- `GET` `/_synapse/admin/v1/push/config`（T3）
- `PUT` `/_synapse/admin/v1/push/config`（T3）
- `POST` `/_synapse/admin/v1/push/process`（T3）

## 5. 排除类明细（50 条）

### 5.1 S2S 联邦协议（30 条，`/_matrix/federation/*`）

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

### 5.3 根级探活与 CAS legacy（8 条）

- `GET` `/`
- `GET` `/_health`
- `GET` `/admin/services`
- `POST` `/admin/services`
- `DELETE` `/admin/services/{service_id}`
- `GET` `/admin/users/{user_id}/attributes`
- `POST` `/admin/users/{user_id}/attributes`
- `GET` `/health`

## 6. 文档状态与实际情况不一致项

1. **文档 ↔ ledger fixture：完全一致** ✅ —— 文档 1159 条与 `ledger_export_sdk/all.json` 逐条比对 0 差异；45 个模块、65 个文件小节的计数声明与实际条目全部吻合；profile 标注（worker 11 + oidc 8 + 双档 2）与清单一致。
2. **文档「1159 条（去重后）」内含 5 对尾斜杠孪生注册**（如 `.../state/{event_type}` 与 `.../state/{event_type}/`），语义 distinct 为 1154。文档的「孪生注册」说明只覆盖 always/oidc 双档 2 对，**未提及尾斜杠孪生 5 对**——建议文档补一句说明，避免下游把 1159 当作 1159 个独立能力。
3. **SDK 镜像零漂移** ✅ —— `route-manifest.all.json` 落后 0 / 多出 0。
4. **审计工具三类盲区导致 28 条假阳性/不可归属**（本轮已人工核验并修正，见 §3.2/§3.3）：prefix 运行时变量（CAS）、helper 中转（room_summary）、运行时版本参数（media）。另有 1 条「注释字面量被计为构造证据」的反向问题：`/_synapse/cas/login|logout|serviceValidate` 的 T2 证据定位在 `src/cas/index.ts:28-29` 的**文件头注释**，真实调用点在 path+prefix 分离的 request 调用处——证据结论（已封装）正确但定位失真。
5. **MSC4155/4156 unstable 变体未封装**：SDK 已封装 v1 稳定版 threads（21 条端点有证据）。与「Sprint 4 已交付 MSC4155/4156」的项目记忆不一致——按文档头部警告，4155 等编号在本仓被**借用**承载非官方语义，需以 `MSC_SEMANTICS.md` 对账确认交付物到底对应哪组端点。
6. **compare-routes 的 1 条 CONDITIONAL 证据未在 JSON 中暴露具体路由**（工具待改进：建议把 rows 全量落盘）。

## 7. 逐模块封装总表

| 模块 | 文档条数 | 已封装(T1∪T2) | 未封装 |
| --- | --- | --- | --- |
| 媒体 (Media) | 62 | 31 | 31 |
| 联邦 (Federation) | 71 | 41 | 30 |
| 应用服务 (AppService) | 39 | 19 | 20 |
| 密钥备份 (Key Backup) | 66 | 48 | 18 |
| 装配 (Assembly) | 109 | 94 | 15 |
| CAS | 17 | 3 | 14 |
| 房间 (Room) | 119 | 108 | 11 |
| 推送 (Push) | 25 | 17 | 8 |
| 外部服务 | 20 | 15 | 5 |
| 管理 (Admin) | 144 | 140 | 4 |
| MSC4108 | 4 | 1 | 3 |
| OIDC | 10 | 8 | 2 |
| 其他 (Other) | 23 | 21 | 2 |
| 好友 (Friends) | 65 | 63 | 2 |
| Rendezvous | 6 | 6 | 0 |
| SAML | 16 | 16 | 0 |
| Worker | 26 | 26 | 0 |
| 临时事件 | 1 | 1 | 0 |
| 事件举报 | 18 | 18 | 0 |
| 关联 (Relations) | 9 | 9 | 0 |
| 反应 (Reactions) | 1 | 1 | 0 |
| 同步 (Sync) | 4 | 4 | 0 |
| 后台更新 | 19 | 19 | 0 |
| 在线状态 (Presence) | 9 | 9 | 0 |
| 审核 (Moderation) | 7 | 7 | 0 |
| 密钥轮转 | 18 | 18 | 0 |
| 小组件 (Widget) | 18 | 18 | 0 |
| 延迟事件 | 2 | 2 | 0 |
| 搜索 (Search) | 8 | 8 | 0 |
| 标签 (Tags) | 4 | 4 | 0 |
| 模块 | 23 | 23 | 0 |
| 滑动同步 (Sliding Sync) | 4 | 4 | 0 |
| 特性开关 | 4 | 4 | 0 |
| 私聊 (DM) | 5 | 5 | 0 |
| 空间 (Space) | 48 | 48 | 0 |
| 端到端加密 (E2EE) | 38 | 38 | 0 |
| 第三方 (Third-party) | 6 | 6 | 0 |
| 设备 (Device) | 6 | 6 | 0 |
| 访客 (Guest) | 3 | 3 | 0 |
| 语音 (Voice) | 30 | 30 | 0 |
| 账户 (Account) | 15 | 15 | 0 |
| 输入状态 (Typing) | 5 | 5 | 0 |
| 遥测 (Telemetry) | 6 | 6 | 0 |
| 阅后即焚 | 21 | 21 | 0 |
| 验证码 (Captcha) | 5 | 5 | 0 |

> **口径说明**：本表按 `ROUTE_CONTRACT.md` 的**章节模块**分组（与文档结构一致）。注意 admin 路由在文档里按源文件散布于多个章节（如 `admin/media.rs` 归「媒体 (Media)」、`cas.rs` 的 admin 路由归「CAS」），故本表的「管理 (Admin)」仅指该章节自身 144 条，**不等于** §1/§4 按路径前缀聚合的 300 条 admin 面。两种口径的未封装数各自自洽：本表未封装列合计 = 165，其中路径前缀属 admin 的 35 条分散在上述多个章节内。

---

**生成方式**：`/tmp/parse_route_contract.py`（文档解析+交叉校验）→ `scripts/audit/compare-routes.mjs` 重跑（2026-10-06）→ `/tmp/join_doc_evidence.py` + 人工源码核验 → 本报告。机器明细：`artifacts/sdk-contract-gap.json`。