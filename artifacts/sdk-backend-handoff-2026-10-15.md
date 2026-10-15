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
