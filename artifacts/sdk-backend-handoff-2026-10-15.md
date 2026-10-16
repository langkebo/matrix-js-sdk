# SDK ↔ 后端 契约问题交接单（2026-10-15）

> **来源**：matrix-js-sdk 的 quality gate 收编——把长期挂 `WAIVED` 的模块纳入「生成的 route-table
> 必须有消费点」的管辖，并给调用点批量加**编译期路径断言**（`PathAssert`）。断言一加，`tsc` 立刻
> 报出**契约外路径**，逐条对照 `synapse-rust` 源码核实后得本单。
>
> **基线**：SDK 契约镜像 `synapse_rust_commit = 6302798c3`（后端 2026-10-15 14:57）；
> 核实后端源码时后端 HEAD = `1d728dbe0`（2026-10-15 15:54）。若两边已前进，请以最新为准复看。

---

## 一、需要后端确认的 3 个问题（按优先级）

### Q1（P1）`invite/blocklist`、`invite/allowlist` 是否需要 per-user 端点？

> **SDK 侧已处置（2026-10-15）**：**没有**采用"读—改—写"——后端 `GET` 是**分页**返回
> （`Query<InviteListParams>` 的 `limit`/`offset`），而 `getInviteBlocklist()` 不传分页参数，
> 直接"读全量再整体写回"会**丢掉未读到的名单项**（数据损坏）。故这 4 个方法改为**发起请求前抛错**
> （`UnsupportedAdminInviteEndpointError`，错误信息内含正确调用路径），测试断言"抛错且
> `req.mock.calls` 为空"。若后端提供 per-user 端点，SDK 可恢复这 4 个方法。

- **后端现状**：`synapse-web/src/routes/admin/server.rs:29-36` 只注册**无参数**形态——
  `GET|POST /_synapse/admin/v1/invite/blocklist`（`get_invite_blocklist_admin` /
  `set_global_invite_blocklist_admin`）与 allowlist 的两个对应 handler。语义是「**全局名单整体设置**」
  （集合由 body 传）。
- **SDK 现状**：`src/admin/sub-managers/admin-config-manager.ts` 有 **4 处**使用**带 userId** 的路径：
  `POST|DELETE /_synapse/admin/v1/invite/blocklist/{user_id}`、`…/invite/allowlist/{user_id}`
  ⇒ 这 4 处**恒 404**。
- **请确认**：① 是否计划提供 per-user 增删端点？② 若不提供，SDK 改为「**读—改—写**」（先 GET 全量、
  本地增删、再 POST 全量）是否符合产品预期？（SDK 内已有同款先例：`InviteBlocklistManager.addToBlocklist`）

### Q2（P2）`rooms/{room_id}/messages/{event_id}` 的 `DELETE` 是否会有？

- **后端现状**：`admin/room/mod.rs:118-121` 只有 `GET …/rooms/{room_id}/messages`。
- **SDK 现状**：原有 `admin-room-manager.deleteRoomMessage` 调
  `DELETE …/rooms/{room_id}/messages/{event_id}`（对标**上游 Synapse** 的管理端点）⇒ 恒 404。
  **SDK 侧已删除该方法**（提交 `66be34183`），并在同文件注释里指向替代方案 `cascadeRedactEvent`。
- **请确认**：本后端是否计划实现「删除房间内单条消息」？若计划实现，SDK 可恢复该方法
  （当前"删方法"是**临时**处置，不是否定该能力）。

### Q3（P3）`federation/destinations/{destination}/reset` 是否曾是别名？

- **后端现状**：只有 `…/destinations/{destination}/reset_connection`（`admin/federation.rs:25`）。
- **SDK 现状**：`resetFederationDestination` 曾实现为「先 `POST …/reset`、**仅** 404 时回退
  `…/reset_connection`」⇒ 因 `/reset` 从未注册，**每次调用都先发一个必然 404 的请求**。
  **SDK 侧已改为单请求直打 `/reset_connection`**（提交 `66be34183`）。
- **请确认**：① `/reset` 是否在某版本存在过、现已废弃？② `reset_connection` 与上游 Synapse 的
  `POST …/destinations/{server}/reset_connection` 语义是否一致（主要用于核对文档口径）。

---

## 二、不需要后端改动、但请知悉的 1 项（口径）

**服务端面模块的归类**：`quality:manager-codegen` 新增 `SERVER_ONLY_MODULES` 类别，把 `federation`
（55 条）从 `WAIVED` 移出——依据是**逐条实测**其路径前缀全为 server-to-server / key-server API：
`_matrix/federation/v1` 36 + `v2` 7 + `unstable` 1、`_synapse/federation/*` 7、`_matrix/key/v2` 4，
**无**任何 `/_matrix/client/*` 或 `/_synapse/admin/*` 混入。

若后端对「哪些路由属于客户端面」有不同划分（例如某条 federation 路由其实供客户端调用），**请告知**
——它会直接影响 SDK 的豁免口径与"未受约束路由"计数。

---

## 三、SDK 侧将做的处置（供对齐）

| 项                                      | 处置                                                                                | 状态                  |
| --------------------------------------- | ----------------------------------------------------------------------------------- | --------------------- |
| `deleteRoomMessage`（Q2）               | 删除方法（恒 404 的 API 不留在公开面）                                              | ✅ 已完成 `66be34183` |
| `resetFederationDestination`（Q3）      | 去掉试探，单请求直打 `/reset_connection`                                            | ✅ 已完成 `66be34183` |
| invite 4 处（Q1）                       | 改为**发起请求前抛错**（`UnsupportedAdminInviteEndpointError`，错误信息含正确路径） | ✅ 已完成             |
| `admin` 收编（179 条）                  | 7 表 union + 6 前缀的后缀剥离断言；221 处调用点接入 `apu()`                         | ✅ 已完成 `615dad907` |
| `getDeviceEvent()`（dehydrated-device） | **删除**（路径 `initial_device` 在上游/规范/本仓四处均不存在，见 §5.4）             | ✅ 已完成 `6de305a16` |
| `dehydrated-device` 7 处调用点          | **借 `auth` 表**接入 `PathAssert`（零机制改动）                                     | ✅ 已完成 `fe65d592a` |

> 说明：`admin` 目录的 manager **跨 7 个 ledger 模块**（admin / feature_flags / module / telemetry /
> external_service / room / event_report），故其断言 union 了多张表 + 6 种前缀剥离；
> 这是 SDK 侧的设计问题，**不需要后端改动**。收编过程本身炸出并修复了 6 条真实 404 缺陷
> （见 `docs/api-contract/contract-artifacts.md` §六）。

---

## 四、核实方式（可复现）

```bash
# 1. 后端注册形态（本单所有结论的来源）
sed -n '14,40p'   synapse-rust/synapse-web/src/routes/admin/server.rs     # invite 族：无参数全局形态
sed -n '108,125p' synapse-rust/synapse-web/src/routes/admin/room/mod.rs   # messages 只有 GET
sed -n '20,40p'   synapse-rust/synapse-web/src/routes/admin/federation.rs # 只有 /reset_connection

# 2. SDK 调用点
grep -n '/invite/bl' matrix-js-sdk/src/admin/sub-managers/admin-config-manager.ts
grep -n 'messages/'  matrix-js-sdk/src/admin/sub-managers/admin-room-manager.ts

# 3. 契约镜像里这几条是否存在（用于区分"SDK 错"与"ledger 缺"）
node -e 'const j=require("matrix-js-sdk/docs/api-contract/generated/modules/admin.json");
         console.log(j.entries.map(e=>e.path).filter(p=>/invite|messages/.test(p)))'

# 4. 收编的批量断言（可复现"断言如何炸出这些缺陷"）
#    admin 收编脚本见 matrix-js-sdk/.workbuddy/memory/2026-10-15.md
```

### 附：一条方法论提醒（本次踩到的坑）

判定「某路径是否属某模块」时，**不要只用 `endsWith` 反查**：SDK 调用点常"多一段"（如
`/invite/blocklist/{user_id}` vs 契约的 `/invite/blocklist`），后缀匹配会误报为"无模块命中"，
从而把**SDK 缺陷**错判成**ledger 缺口**。本单的 Q1 就是这么先被误判、后经复核撤回的
（见 `matrix-js-sdk/docs/api-contract/contract-artifacts.md` §六 B 的撤回说明）。
正确做法：把两侧的路径段都归一化（模板段统一成 `{}`）后**逐段比较段数**再判归属。

---

## 五、本轮（2026-10-15 晚）后端线进展与新增建议

### 5.1 已解决（后端当日完成，SDK 侧已同步）

| 事项                                                         | 后端改动                                                                           | SDK 侧同步结果                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| MSC3814 `…/dehydrated_device/{device_id}/events` 的 **POST** | `assembly.rs:217-221` 补齐 `.post(..)`；`derived_route_table_always.inc.rs` 已同步 | `assembly` 桶 104 → **105**；auth 表重生成                    |
| `external_service` 的 `trendradar`                           | `external_service.rs` 已删净                                                       | `external_service` 12 → **11**；SDK 封装已于 `73804e34c` 移除 |

> 两者相抵 ⇒ 后端全量仍 **1032**（内容变了，单看总数看不出来）。
> SDK 镜像 stamp 已推进到 `3e36d6dbd`（提交 `1b827bbd7`）。

### 5.2 建议 A（P2）：让 MSC3814 那一族有独立 `registered_by` —— ✅ **已实施**

> ✅ **后端已实施（`d2b76bfcb`，10-15 20:59）**：该族改为独立 sub-router，`registered_by` 变为
> **`dehydrated_device`**（`derived_route_table_always.inc.rs`、`ROUTE_CONTRACT.md`、两套 fixture 与快照同步）。
> **SDK 侧随之完成收编**（见 5.6）：ledger 独立成桶 ⇒ 生成 `src/dehydrated-device/__generated__/`（6 条）
> ⇒ 该模块**首次进入 `quality:manager-codegen` 管辖**；`assembly` 桶 105 → **99**。

**现状**：该族 6 条路由由 `assembly::create_router` 直挂，而 ledger 导出器按 `registered_by` 分桶
（`ledger_export.rs` 的 `moduleKeyFor`）⇒ 它们全归入 **`assembly` 桶**，**没有** `dehydrated_device`
这个 ledger 模块。

**后果（SDK 侧实测）**：SDK codegen 的模块枚举源是 `docs/api-contract/CONTRACT_INDEX.md` 的文档链接，
故该模块**从不进入枚举** —— 不在 COVERED、不在 WAIVED/SERVER_ONLY，**连 `Missing` 都不报**
（Missing 判据是"枚举进来了却没交付"）⇒ SDK 侧**从未生成 route-table、从未有 `PathAssert`**。
这正是 `getDeviceEvent()` 那条不存在的 `initial_device` 路径能长期隐藏的根本原因。

**建议**：把该族注册到独立 sub-router（例如 `handlers::dehydrated_device::create_router`），
使 `registered_by` 成为独立 key。**收益**：ledger 给出独立模块 ⇒ SDK 可生成独立契约表并纳入
`manager-codegen` 管辖。**当前不阻塞**（SDK 已用"借 `auth` 表"覆盖断言，见 5.4）。

> 同类情形：任何"核心 router 直挂"的功能域都会有同样后果，不止 msc3814。

### 5.3 建议 B（P2）：`derived_route_table_always.inc.rs` 的"漏声明"防护 —— ✅ **已实施**

> ✅ **后端已实施（`8869abea1`，10-15 21:01）**：新增**反向守卫**（371 行）—— 扫描 router 源里的
> 路径字面量，断言 **⊆ ledger 镜像声明**。实现含注释剥离、`match_delim` 括号配对、
> `gated_mod_open_brace`、测试模块剥离、`any()` 展开为 7 个方法等方法学细节。
> SDK 侧无对应动作；该守卫正是「POST 漏声明」那类问题的兜底。

**现状**：`tests/integration/api_route_ledger_tests.rs:190` 的
`declared_route_manifest_entries_are_actually_wired` 只覆盖**单向**「声明 → 接线」。

**缺口**：反向「router 实际注册 → 都在 ledger 声明」**无断言** ⇒ 新增路由时若忘了同步
`derived_route_table_always.inc.rs`，**不会被任何测试发现**，而它会顺着
ledger → SDK 镜像 → codegen 一路"隐形"下去（SDK 侧看不见 ⇒ 契约不同步）。

**本次实例**：`POST …/dehydrated_device/{device_id}/events` 注册进 `assembly.rs` 后，
`derived_route_table_always.inc.rs` 一度只有 GET ⇒ SDK 镜像也只导出 GET
⇒ SDK 的 `claimDevice()`（POST，与 MSC3814 规范一致）在 ledger 里"无对应条目"。
本次由后端及时补上、**未造成缺陷**，但暴露了流程风险。

**建议**（任选其一）：

1. **根治**：让 `derived_route_table_*.inc.rs` 由构建脚本从 router 源**自动生成**（消除手工同步）；
2. **兜底**：加反向断言 —— 文本扫描 router 源里的路径字面量集合 ⊆ derived 表声明集合
   （不要求语义级，只保证"新路径必须被声明"）。

### 5.4 SDK 侧本轮处置（供对齐）

| 项                                                    | 处置                                                                                       | 提交        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| MSC3814 POST 未进 ledger                              | `contract:sync` + `contract:codegen`；文档数字同步（auth 104→105、external-service 12→11） | `1b827bbd7` |
| `getDeviceEvent()`（`initial_device` 在四处均不存在） | **删除**（+ spec 2 例 + CHANGELOG BREAKING）                                               | `6de305a16` |
| `dehydrated-device` 7 处调用点零约束                  | **借 `auth` 表**接入 `PathAssert`（新增 `StripMsc3814`）                                   | `fe65d592a` |

> 变异自证（`fe65d592a`）：把 `claimDevice` 的路径改回 `…/initial_device` ⇒ `tsc` 立刻报 TS2345
> ⇒ **该断言本可以拦住那个真缺陷**（这也说明 5.2 的根因确认无误）。

### 5.5 口径知悉（P3）：`ledger_export_sdk/` 的 commit 占位

`tests/unit/fixtures/ledger_export_sdk/*.json` 的 `synapse_rust_commit` 是 `0000…` 占位，
`contract-sync` 在 workspace 用 `git rev-parse HEAD` 覆盖 ⇒ SDK 镜像的 `synapse_rust_commit`
表达的是「**同步时后端工作区 HEAD**」，**不是内容来源 commit**（后端工作区若脏，stamp 与内容会不一致）。
若生成脚本能写入真实 commit（或改为内容哈希），SDK 侧的"声明 ↔ 生成物自证"会多一个**内容侧锚点**。

### 5.6 SDK 侧收编结果（`dehydrated_device`，2026-10-15 晚）

| 指标                      | 收编前                                    | 收编后                                              |
| ------------------------- | ----------------------------------------- | --------------------------------------------------- |
| 该模块的契约约束          | **无**（无 route-table、无 `PathAssert`） | 独立 route-table（6 条）+ manager 7 处 `PathAssert` |
| `quality:manager-codegen` | `Missing 1`（`NO_CONSUMER`）              | **Covered 48 / Waived 0 / Missing 0**（100%）       |
| `assembly` 桶             | 105                                       | **99**（该族 6 条拆出）                             |
| 产物口径                  | route-table 47 张 / 镜像 49 / 目录 48     | **48 张 / 50 / 49**（条目数因相抵仍 977）           |

⚠️ **过程中发现 SDK 侧一处判据盲区**（后端可忽略，仅备案）：`scripts/sdk-contract-codegen.mjs` 的
「死条目剪枝」原用**全局** ledger 键集（`globalLedgerKeys`）⇒「路径从 A 桶迁到 B 桶」时，
A 的旧条目**永远剪不掉**，导致两表重复（`quality:contract-entrypoint` 报 **6 条重复路由**）。
已收紧为「**属于本目录**（`ownedByThisDir`）或本文档声明（`contractKeys`）」，
并做了**对照实验**：手工把那 6 条放回 `auth` 表后，旧判据下留存（auth=105、无 prune 输出）、
新判据下被剪（auth=99、有 prune 报告）。
⇒ **建议后端知悉**：模块/桶的**迁移**在 SDK 侧现已能自动收敛；但若将来再次调整 `registered_by`，
SDK 侧需跑 `contract:sync` + `contract:codegen` 跟随（不会自动发生）。

---

## 六、2026-10-16 新增：wire-format 门禁修为单一归一化后**新暴露的 2 条缺陷**

### 背景（为什么以前没看见）

`quality:wire-format` 有两个 `normalizePath` 实现（占位符拼写 `{x}` vs `{X}`），
导致**任何含动态段的路由两侧 key 永远对不上** ⇒ 被静默归进 `route-contract-unavailable`。
已修为单一归一化（`adcfe0df3`）：未解析调用点 599 → **333**、真正做了比对的 24 → **51**，
并因此**新暴露 3 条**（其中 1 条是 SDK 侧抽取器的假阳性，另行修）。

### Q4（P1，**建议后端补**）`_synapse/admin/v1/federation/blacklist/{server_name}` 不接收 `reason`

**证据（本仓后端自身，非上游）**：

| 层                                                   | 现状                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| 模型 `AddBlacklistRequest`                           | **有** `reason: Option<String>`（还有 `expires_in_days: Option<i32>`）           |
| 写路径 `AdminFederationService::add_to_blacklist`    | 签名只有 `(server_name, admin_user_id)`，内部**硬编码 `reason: None`**（`:402`） |
| HTTP handler `admin/federation.rs::add_to_blacklist` | 只取 `Path(server_name)`，**无 `Json` 提取器** ⇒ 任何 body 被静默丢弃            |
| 读路径 `get_blacklist`                               | **回传** `"reason": row.reason`                                                  |

⇒ **写入丢字段、读取回传**，SDK 发 `body: { reason }` 完全正确却无效。

**上游核对**：`element-hq/synapse` 的 `synapse/rest/admin/federation.py` **只有 `destinations` 族**
（list / detail / rooms / `reset_connection`），**没有 blacklist 端点、也没有 reason**
⇒ 该端点属本仓 fork 专有，**上游无法裁决**，应以本仓模型为准（模型与读路径都表明"设计上就该有 reason"）。

**建议**：**后端补**——handler 接 body（`Json<...>`）并把 `reason`（一并 `expires_in_days`）透传到 service；
service 已支持、存储已支持、读路径已回传，**改动集中在 web 层 + service 签名**。
SDK 侧保持现状；在缺陷修好前以 waiver 占位（带 `expires`），到期提醒。

### Q5（P1，**建议后端补信封**，备选方案见下）`GET /_matrix/vendor/v1/rooms/{room_id}/threads/search` 与 `list_threads` 不同形

**证据**：

| 端点                | Query                          | 响应                                     |
| ------------------- | ------------------------------ | ---------------------------------------- |
| `…/threads`（list） | `ListQuery`（**有 `from`**）   | `Json<ThreadListResponse>`（**信封**）   |
| `…/threads/search`  | `SearchQuery`（**无 `from`**） | `Json<Vec<ThreadSummary>>`（**裸数组**） |

后端自己的两个**同族**端点不同形；而 SDK 的 `IThreadListResponse { threads; next_batch? }`
是照 **list 侧**建的 ⇒ `searchThreads` 目前**两头都错**：发了后端不认的 `from`，
又按信封去读裸数组 ⇒ `result.threads` 恒为 `undefined`（**该方法当前不可用**）。

**建议（首选）：后端让 `search_threads` 与 `list_threads` 同形** ——
`Query<SearchQuery { q, limit, from }>` + 返回 `ThreadListResponse`（含 `next_batch`）。
理由：① 同族接口一致优于让 SDK 为一个端点写特殊形状；② SDK 已有 `IThreadListResponse`
可直接复用；③ 搜索结果的**分页是有意义的**（结果集可能很大，现在被静默截断）。

**备选（若后端确认 search 就该返回裸数组）**：SDK 撤 `from` 并把返回类型改成 `ThreadSummary[]`。
两种方案都请后端**明确选一个**，SDK 侧按选择对齐（当前状态是"两边都不对"，不能久留）。

### 核实方式（可复现）

```bash
# Q4：写路径丢字段、读路径回传
grep -n "struct AddBlacklistRequest" -A 12   synapse-rust/synapse-services/src/federation_blacklist_service.rs
grep -n "fn add_to_blacklist" -A 16          synapse-rust/synapse-services/src/admin_federation_service.rs
grep -n "pub async fn add_to_blacklist" -A 8 synapse-rust/synapse-web/src/routes/admin/federation.rs
grep -n "\"reason\": row.reason"              synapse-rust/synapse-web/src/routes/admin/federation.rs

# Q5：同族不同形
grep -n "fn list_threads"   -A 18 synapse-rust/synapse-web/src/routes/handlers/thread.rs
grep -n "fn search_threads" -A 12 synapse-rust/synapse-web/src/routes/handlers/thread.rs
grep -n "struct SearchQuery" -A 5 synapse-rust/synapse-web/src/routes/handlers/thread.rs
grep -n "struct ListQuery"   -A 8 synapse-rust/synapse-web/src/routes/handlers/thread.rs

# 复现门禁新暴露结论（需后端在场）
cd matrix-js-sdk && node scripts/quality/check-wire-format.mjs
```

---

## 七、后端答复与修复（synapse-rust，2026-10-16）

> 后端点对 §六 的处置：**Q4 / Q5 已修**（后端代码 + 测试 + `.sqlx`），其余各项给出核实结论；
> 需要产品决策的两项已明确标注。后端提交：`e48afec83`（Q4+Q5）、`64cd1155a`（MSC3814 双形态相关）。

### 7.1 Q4（P1）blacklist 的 `reason` / `expires_in_days` —— ✅ 已修

三层原本层层丢弃，现在都通了：

| 层                                                     | 修复前                                                           | 修复后                                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| handler `routes/admin/federation.rs::add_to_blacklist` | 只有 `Path(server_name)`，**无 `Json` 提取器** ⇒ body 被静默丢弃 | 增 `Option<Json<AddBlacklistBody { reason, expires_in_days }>>`                                                                        |
| service `AdminFederationService::add_to_blacklist`     | 硬编码 `reason: None, expires_in_days: None`                     | 两字段透传                                                                                                                             |
| 校验                                                   | 无                                                               | 下层 `FederationBlacklistService::add_to_blacklist` 拒绝 `expires_in_days <= 0`（400）——否则会写出一条**创建即过期**、等于没拉黑的条目 |

**为什么 body 必须可选（对 SDK 重要）**：`admin-federation-manager.ts` 只在有 `reason` 时才发 body
（`reason ? { reason } : undefined`），而 `http-api/fetch.ts` 只在 body 是对象时才设
`Content-Type: application/json` ⇒ 无 body 时后端看到的是"没有 Content-Type"，
axum 0.8 的 `Option<Json<..>>` 恰好取到 `None`。**所以 SDK 不需要改成"总是发 body"**，两种都收。
（既有集成测试「空 body POST → 200」正是这条的回归守卫，仍绿。）

body 里若顺带带了 `server_name` / `block_type` 会被**忽略**而不是 400（路径才是权威）——
这条是刻意与本文件其它 body 结构体不同（它们带 `deny_unknown_fields`），已在注释写明理由。

**验证**：新增 `api_admin_federation_tests::test_admin_federation_blacklist_body_reason_and_expiry_are_persisted`
—— 带 `{reason, expires_in_days: 30}` 写入 ⇒ `GET …/blacklist` **读回 reason** ✓、
直查 DB 断言 `expires_at ≈ now+30d`（容差 1 分钟）✓、`expires_in_days: 0` ⇒ **400** ✓。

### 7.2 Q5（P1）`rooms/{room_id}/threads/search` —— ✅ 已修（按本单**首选方案**）

|       | 修复前                                      | 修复后                                                   |
| ----- | ------------------------------------------- | -------------------------------------------------------- |
| Query | `q`、`limit`                                | `q`、`limit`、**`from`**（此前被静默忽略）               |
| 响应  | **裸数组** `Vec<ThreadSummary>`             | 信封 `ThreadListResponse { threads, next_batch, total }` |
| 分页  | 无 —— 结果被 `limit` **静默截断**且无法续读 | **keyset 游标**（`next_batch`，对客户端不透明）          |

分页语义（**与 SDK 现有代码一致 ⇒ SDK 侧无需改动**）：游标编的是**排序键三元组**
`(search_relevance, sort_ts, thread_id)`（base64url），与本仓 `/search` 的 `PostgresSearchCursor` 同法。
服务端取 `limit + 1` 判 `has_more`；`next_batch` **仅在有下一页时出现**；`limit` 夹在 `[1, 1000]`。
**畸形游标返回 400**（不降级成"第一页"——那会让客户端静默拿到错的一页）。

⚠️ **一处需要 SDK 知悉的口径**：`total` 沿用同族定义 = **本页条数**（不是全量命中数，`list_threads` 也是这么给的）。
判断"还有没有下一页"请**只看 `next_batch`**。

**验证**：新增两条 ——
`thread_storage_tests_migrated::test_search_threads_cursor_pagination_is_complete_and_non_overlapping`
（逐页翻完断言**不重不漏**）与
`api_search_thread_tests::test_room_thread_search_returns_envelope_and_paginates_by_cursor`
（信封形状 / `next_batch` 往返 / 相邻页不重复 / 畸形游标 400）；
另有游标编解码单测（**f64 逐位往返**、畸形载荷全部拒绝）。

### 7.3 Q1（P1）per-user invite 端点 —— ⏸ 需产品决策（后端**复核了 SDK 的判断，结论一致**）

- 后端确实只有**全局无参数**形态（`routes/admin/server.rs:29-36`），
- 且 `GET` **确实是分页**的（`InviteListParams { limit, offset }`，`limit` 默认 100）
  ⇒ SDK 那条"读全量再整体写回会**丢掉未读到的名单项**"的判断**成立**，
  所以"发起请求前抛错"而不是读—改—写，是**正确**的临时处置。

后端**暂不新增** 4 条 `/{user_id}` 端点：它引入的是**新语义**（per-user 与全局名单如何叠加/优先），
并牵动整条契约链（路由注解 + 3 张派生表 + 6 个 fixture + 2 份 ledger 快照 + `ROUTE_CONTRACT.md` +
`route-table.json` + 文档计数）。**请产品先定 per-user 语义**，定了后端再实现（届时同步 SDK）。

### 7.4 Q2（P2）`DELETE …/rooms/{room_id}/messages/{event_id}` —— 后端**不计划**，SDK 的临时处置可转正

后端现状：`GET …/rooms/{room_id}/messages`（只读）；"撤下内容"的可用手段是
`POST /_matrix/client/v3/admin/room/{room_id}/redact`（管理员 redact）与
`POST /_synapse/admin/v1/rooms/{room_id}/cascade_redact`（本仓扩展，连带相关事件）。
**没有**按 `event_id` 删除单条消息的管理端点，也**不计划**新增 —— 上游 Synapse 亦无此端点，
而 redact 才是 Matrix 语义下"撤下消息内容"的正确做法（保留事件与因果链）。
⇒ SDK 现在"删方法 + 注释指向 `cascadeRedactEvent`"**就是终态**，注释里的"临时"可以去掉。

### 7.5 Q3（P3）`/reset` —— 它**确实存在过**，是 `reset_connection` 的**别名**，2026-10-08 被有意删除

考古结论（`git log -S`，可复现）：

```text
7779685e8  2026-10-08  refactor(routes)!: 删除 4 条 admin 面同 handler 重复挂载（C6 反冗余批次）
    -  .route("/_synapse/admin/v1/federation/destinations/{destination}/reset", post(reset_connection))
```

即 `/reset` 与 `/reset_connection` **挂的是同一个 handler**，属"同 handler 重复挂载"，
在该批次里按"不留别名"策略整批删除。⇒ SDK 去掉试探回退、直打 `/reset_connection` 是**正确**的。

`reset_connection` 语义（供文档口径核对）：`UPDATE federation_servers SET last_failed_connect_at = NULL,
failure_count = 0 WHERE server_name = $1` —— 清掉失败计数与上次失败时间，让该目的地**立刻可重试**；
目标不存在则 404。与上游 Synapse 的 `POST …/destinations/{server}/reset_connection` 语义面一致。

### 7.6 §5.5（P3）`ledger_export_sdk/` 的 commit 占位 —— **零占位是有意设计；你想要的内容锚点后端已落地**

两点澄清：

1. **零占位是故意的，不该改**：SDK lane 的 fixture 是**逐字节稳定的 golden**
   （`ledger_export.rs` 的注释与 `tests/unit/ledger_fingerprint_tests.rs` 都把它列为
   "只允许零占位 / 固定哨兵"的字段）⇒ 把真实 commit 写进 fixture 会**破坏 golden**。
   真实 commit 由 CLI 的 `--commit=SHA` 在 `contract-sync` 时注入
   （`src/bin/synapse_ledger_export.rs -- commit=SHA`）。
2. **内容侧锚点已存在**：`tests/unit/fixtures/ledger_export_sdk/manifest.json` 里有
   `fingerprint_algorithm`（算法明文）+ 每个 profile 的 **`route_surface_sha256`**
   （= `ledger_export.rs::route_surface_sha256`：sha256 over 每行
   `method \t path \t registered_by \t path_params \t query_params \t auth`，按 `entries` 顺序拼接）。

    ⚠️ **但 SDK 侧还没有用它**：`matrix-js-sdk/scripts` 下搜不到该键名，
    `scripts/quality/check-cross-repo-pin.mjs` 目前只把 sidecar `manifest.json` 当作"可选、可后补"。
    ⇒ **建议 SDK 把跨仓 pin 的主判据从「对端工作区 HEAD」换成「`route_surface_sha256` 比对」**：
    这样"声明 ↔ 生成物"的绑定与工作区脏不脏、提交历史都无关（正是本单 §5.5 想要的锚点）。
