# 契约 route-table 与 ledger 映射复核（2026-09-13）

> 触发：阶段 3 批次 2 的 C-3 待定项 —— `friend_room` / `push_notification` 的死表要不要停生成、
> ledger 的 `push_notification` 是否该映射到 `push` 目录。用户要求"查看后端代码，结合最佳实践给出建议，
> 后端问题单独列出，先不要改后端代码"。
> 取证工具：`scripts/quality/probe-contract-drift.mjs`（诊断脚本，不是门禁）。
> 结论基线：SDK `b040475f9`、后端 `59d527f9`。

---

## 0. 结论摘要（先看这三条）

1. **两个问题都问错了前提**：`friend_room` 不是"死表"，它包含 `src/friend/**` 实际在调的 24 条
   `/_matrix/vendor/v1/friends/*` 路由；**真正的问题是它缺了 5 条 ledger 路由**（见 §2）。
   `push_notification` 也不是"映射没写对"，它和 `push` 是**两个不同的路由族**（见 §4）。
2. **根因是 SDK 侧有两个互不同源的契约镜像**：`src/<module>/__generated__/route-table.ts` 由
   后端`ROUTE_CONTRACT.md`（人工文档）+ 既有条目渲染，而 `docs/api-contract/generated/modules/*.json`
   才是 ledger（启动时校验过的那份）的镜像。两者已漂移到 **24/49 个模块**（§3）。
   不修这个，任何"停生成/改映射"的决定都是在猜。
3. **建议顺序**：先做 SDK-2（差集门禁，让漂移可见并逐条登记）→ 修 SDK-1（让 route-table 以 ledger 为源）
   → 那时 `friend_room` 自然可接线、`push` 表里的 legacy 条目自然消失、`vendor` 分组的归属问题
   由后端决定（§6 B-1）。**本轮不改任何后端代码。**

---

## 1. 后端事实（读代码得到，不是推断）

| 事实                                                                                                                                                            | 证据                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ledger 的 `registered_by` 是**注册该路由的模块文件**（"router module"），例如 `"key_backup"`                                                                    | `src/web/routes/route_ledger.rs:58-64`（`RouteEntry.registered_by` 的文档注释）                 |
| ledger 在启动时校验重复 (method, path)，重复即 abort                                                                                                            | 同上，文件头 `## Why this exists`                                                               |
| `friend_room` 一个 registr 里同时声明 client 前缀与 vendor 前缀两套：93 条，其中 **29 条 vendor**                                                               | `src/web/routes/friend_room.rs:400-444`；`docs/api-contract/generated/modules/friend_room.json` |
| `push`（27 条）= `/pushers`、`/pushrules*`、`/notifications*`（v3+r0，含 3 条 v3-only）                                                                         | `src/web/routes/push.rs:44-73`                                                                  |
| `push_notification`（9 条）= legacy `/push/devices`、`/push/rules*`、`/push/send` + `/_synapse/admin/v1/push/{process,cleanup}`                                 | `src/web/routes/push_notification.rs:350-372`                                                   |
| `vendor`（3 条）= `/_matrix/vendor/v1/{my_rooms,search_rooms,search_recipients}`，是**迁移遗留的分组注册器**（把私有端点从 client 前缀搬走后单独放的 manifest） | `src/web/routes/assembly.rs:296-308`（含迁移说明注释）                                          |
| `push_notification` 与 `vendor` 都真实注册进 router                                                                                                             | `assembly.rs:539`（merge `create_push_notification_router`）、`assembly.rs:72`（manifest）      |

SDK 侧的调用事实（读代码 + grep）：

| 路由族                                                 | SDK 调用点                                                                                              | 是否被"表"约束                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------- | --- |
| `/_matrix/vendor/v1/friends/*`（24 条）                | `src/friend/sub-managers/*.ts`，`prefix: VendorPrefix`，路径全手写                                      | ❌ 未导入 friend 表                     |
| `/_matrix/vendor/v1/my_rooms`                          | `src/room/RoomManager.ts:1221`（手写 "/my_rooms"）、`src/client-secure-backup-requests.ts:49`（`sp()`） | ❌（room 表里没有它）                   |
| `/_matrix/vendor/v1/search_rooms`、`search_recipients` | `src/client-secure-backup-requests.ts:58,73`（`srp()`）                                                 | 🟡 靠 search 表里**手抄的 legacy 条目** |
| `/\_matrix/client/r0/push/devices                      | rules                                                                                                   | send`（push_notification 家族）         | **零调用点**（SDK 与 Tjg 都没有） | ——  |
| `/_synapse/admin/v1/push/{process,cleanup}`            | **零调用点**                                                                                            | ——                                      |

---

## 2. `friend_room` 不是死表 —— 它缺 5 条路由（SDK-1 的前提）

最初的白名单理由是"表里是旧路由、代码走 vendor、两者不相交"，**这是错的**：表里有 24 条
`/_matrix/vendor/v1/friends/*`（`grep -c "/_matrix/vendor/v1" src/friend/__generated__/route-table.ts` = 24）。
真相是表与 ledger 双向都有缺口：

```
friend_room: 表 88 条 / ledger 93 条
ledger 有、表里没有的 5 条（正好都是写方法）：
  POST /_matrix/vendor/v1/friends
  POST /_matrix/vendor/v1/friends/dm/{user_id}
  POST /_matrix/vendor/v1/friends/groups
  POST /_matrix/vendor/v1/friends/search
  PUT  /_matrix/vendor/v1/friends/{user_id}/status
```

这 5 条**正是模块在调的**（`friend-request-manager.ts:147` POST `/friends`、
`friend-block-manager.ts:102` PUT `/friends/{id}/status` …）。原因见 §3：后端
`ROUTE_CONTRACT.md` 只列了这些路径的 GET 形态，而 ledger 里四种方法都有
（`grep -c "POST.*vendor/v1/friends" ROUTE_CONTRACT.md` = 0）。

**所以"停生成 friend 表"是错的方向**：应该反过来 —— 提高它的数据质量，然后让模块用它。

## 3. 根因：SDK 的两个契约镜像不同源（实测 24/49 模块漂移）

- `pnpm contract:sync` 把后端 ledger fixture 写成 `docs/api-contract/generated/{route-manifest.*.json, modules/*.json, index.json}`（ledger 的**完整**镜像，1407 条 all profile）。
- `pnpm contract:codegen` 渲染 `src/<module>/__generated__/route-table.ts` 时用的是
  **`ROUTE_CONTRACT.md`（人工文档，904 条）+ 该模块既有条目的并集**（`loadExistingEntries`），
  **不是** `modules/*.json`。生成文件头却写着 `Source: docs/api-contract/generated/modules/<dir>.json`
  （`scripts/sdk-contract-codegen.mjs:963`）—— 注释与实现不符。

于是两边各自漂移，实测（`probe-contract-drift.mjs`，24/49 个模块有差集）：

| 模块 → SDK 目录                     | 表条数       | 表有 ledger 无 | ledger 有表无 | 典型样本                                                                                                                                                                                           |
| ----------------------------------- | ------------ | -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| room                                | 192          | **53**         | 2             | 表里有 `/_matrix/client/r0/friends/groups/...`（friend 的路由！）、`anti_screenshot`、`threads`                                                                                                    |
| push                                | 37           | **10**         | 0             | 表里有 push_notification 的 9 条 + `GET /pushers/`                                                                                                                                                 |
| ~~msc4108_rendezvous → rendezvous~~ | 10           | 0              | 0             | **经 SDK-1 复核：不是漂移**。`src/rendezvous` 目录同时承载 ledger 的 `msc4108_rendezvous` 与 `rendezvous` 两个模块（映射多对一），两个路径族各有其模块声明 —— 原先按**模块**比对才误报成路径族漂移 |
| media                               | 41           | 9              | 0             | `/_matrix/media/v3/upload/token` 等                                                                                                                                                                |
| worker → worker-admin               | 26           | 11             | 0             | `/_synapse/worker/v1/*`                                                                                                                                                                            |
| sync                                | 11           | 4              | 0             | 混入 4 条 sliding-sync / my_rooms 路径                                                                                                                                                             |
| search                              | 13           | 2              | 0             | 手抄的 2 条 vendor search（ledger 归 `vendor` 模块）                                                                                                                                               |
| friend_room → friend                | 88           | 0              | **5**         | §2 的 5 条写方法                                                                                                                                                                                   |
| burn_after_read                     | 19           | 0              | 2             | `DELETE /_matrix/vendor/v1/rooms/{room_id}/burn/{event_id}` 等                                                                                                                                     |
| cas / e2ee / external_service       | 18 / 57 / 20 | 2 / 2 / 1      | 0 / 0 / 1     | ——                                                                                                                                                                                                 |

> 口径：`(method, path)` 精确比对，`{param}` 名字按字面。表里"多出来"的条目是
> `loadExistingEntries` 保留的历史条目；"缺少"的是文档未覆盖或路径族已变的部分。
> 文档 ↔ ledger 的粗算（归一化版本前缀后）：文档 834 / ledger 994，仅文档 286 / 仅 ledger 446 ——
> 文档里还混着相对路径写法，因此这个数字只是上界；**可验证的硬证据是 §2 的 5 条**。

**最佳实践对照**：契约驱动的正确形态是「**单一机器源 → 所有产物都从它派生**」。ledger 已经是
单一源（还带启动校验）；`ROUTE_CONTRACT.md` 应当只提供 ledger 表达不了的元数据（状态码、错误
场景、DTO 片段），而不是路由清单本身。

---

## 4. 对三个具体问题的建议

### Q1 `friend_room` / `push_notification` 要不要进 `SKIP_ROUTE_TABLE_MODULES`（停生成）？

| 模块                | 建议                                                                                 | 理由                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `friend_room`       | **不要停**。先修数据源（SDK-2/SDK-1），再把 `src/friend/**` 接到自己的表，删掉白名单 | 表覆盖了模块真正在调的路由族；接线后拼写错误变编译期错误（93 条路由的手写面很大），收益直接                                                                                                                         |
| `push_notification` | **暂不停，也暂不接线**；保持白名单 + 到期日，等后端 B-2 结论                         | 9 条路由 SDK/Tjg **零调用点**；其中 2 条是 Synapse-admin 兼容端点（可能属于 admin 面），7 条是 legacy push v1。若后端决定下线，这个模块会从 ledger 里消失，表与白名单一起自然消失 —— 那时停生成是**结果**而不是手段 |

### Q2 ledger `push_notification` 是否该映射到 `push` 目录？

**不建议。** 三条理由：

1. 两个模块是**不同路由族**：`push` = `/pushers`、`/pushrules*`、`/notifications*`；`push_notification`
   = legacy `/push/devices`、`/push/rules*`、`/push/send` + `/_synapse/admin/v1/push/*`。映射到 `push`
   目录等于让覆盖门禁指向一张**不包含这 9 条路径的表**（`push` 表里那 9 条是历史手抄条目，不是 ledger 派生）——
   这正是 C-1 刚修掉的假绿形态。
2. 现有别名表（`LEDGER_MODULE_ALIASES`，以 SDK 目录为键）本来就表达不了多对一；把它硬扩成
   `push_notification → push` 会让"一目录一模块"的隐含前提更模糊。
3. 真正该做的是让 `push` 表**不再手抄**别的模块的路由（SDK-3）：ledger 派生之后，`push` 表自动只剩它自己的 27 条，
   两族自然分开。

### Q3 `vendor` 这种"不对应任何 SDK 目录"的 ledger 模块怎么办？

- **首选（后端侧，B-1）**：这 3 条路由的语义归属是 `room`（`my_rooms`）和 `search`（`search_rooms`/`search_recipients`）。
  后端把它们的 `registered_by` 归回 feature 模块（或把 `vendor_route_manifest()` 拆进对应模块），
  ledger 里就不再有 `vendor` 这个分组；SDK 侧 room/search 表会从 ledger 得到这几条，
  `RoomManager.ts:1221` 的 `/my_rooms` 也就能被类型约束。
- **备选（SDK 侧，仅当后端要保留 vendor 分组）**：为"不 1:1 映射"的 ledger 模块提供专门的生成位
  （例如 `src/__contract__/<module>/route-table.ts`），由消费方直接 import。这是一次 codegen 特性，
  比给别名表打补丁干净。
- **不要做**：`vendor → room` 这类别名。用 141 条的 room 模块去"代表"3 条跨模块私有路由，
  会让覆盖率与证据都失真。

---

## 5. SDK 侧任务建议（按性价比排序，均未开工）

| 任务         | 内容                                                                                                                                                                               | 验收                                                                                        | 量级                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **SDK-2** ✅ | 新增「契约差集门禁」：把 `probe-contract-drift.mjs` 产品化 —— 每处 `表有 ledger 无` / `ledger 有表无` 必须登记（reason + 到期日），新增差集即红；并把两向计数接进 `quality:report` | 24/49 的漂移变成**逐条有结论**；新增漂移让门禁变红                                          | 小（门禁骨架可复用 codegen 覆盖门禁的登记表机制） |
| **SDK-1**    | 修 route-table 的数据源：ledger（`modules/*.json`）为权威路由源，`ROUTE_CONTRACT.md` 只提供元数据；顺带修掉生成头注释与实现不符                                                    | friend 表补齐 93 条；`push` 表不再含 push_notification 的 9 条；`contract:codegen:check` 绿 | 中（codegen 改动 + 双份产物一次性对齐）           |
| **SDK-1b**   | 数据源修好后，把 `src/friend/**` 接到 `StripVendor<FriendPathPattern>` + `fp()` 助手，删掉 `friend_room` 白名单                                                                    | 门禁强证据 +1；friend 的 93 条路径拼错即编译错误                                            | 中（约 10 个文件的路径调用点）                    |
| **SDK-3**    | `push` 表里的 10 条 legacy 条目逐条定性（9 条属 `push_notification` → 移出；`GET /pushers/` 等 → 后端补进 ledger 或 SDK 删除）                                                     | 表与 ledger 一致（差集为 0）                                                                | 小                                                |
| **SDK-4**    | 视 B-1 结论：为不 1:1 的 ledger 模块提供生成位；或后端改归属后关闭本项                                                                                                             | vendor 路由有类型归属                                                                       | 中                                                |
| **SDK-5**    | 按 SDK-2 的清单逐模块清理其余漂移（room 53、media 9、worker 11、sync 4、rendezvous 路径族 …）                                                                                      | 每个模块差集为 0 或已登记                                                                   | 大（可分模块 PR）                                 |

### SDK-2 实施记录（2026-09-13）

- 新增 `scripts/quality/check-contract-drift.mjs` + `scripts/quality/contract-drift-registry.json`
  （**116 条**：sdk-only 100 + ledger-only 16，覆盖 13 个模块，每条带具体 reason + 到期日 2026-12-31），
  已接入 `pnpm lint`；`--json` 供 `pnpm quality:report` 复用（新增「Contract Drift」小节）。
- 门禁语义与定时器门禁同款：未登记 / 缺 reason / 过期 → 红；**差集修好后没删登记 → stale 也红**，
  这样 SDK-1/SDK-3/SDK-5 每修一条就必须同步收缩登记表，数字只能往下走。
- 只检查**有 route-table 的模块**：9 个 SKIP 模块没有表，由覆盖门禁的白名单负责，不双重记账。
- 模块→目录映射直接 import 覆盖门禁的 `findSdkDirForModule`（同源，避免"门禁说 A、codegen 写 B"）。
- 负向测试 `spec/unit/contract-drift-gate.spec.ts` 9 例：读取/双向差集/未登记/缺 reason/过期/key 形状/
  登记表形状，以及一条**登记表与仓库现状一一对应**的用例（缺登记或 stale 都红）。
- 登记时又发现两处**后端侧**问题（进下面 B-8/B-9，本轮不改后端代码）。

### SDK-1 实施记录（2026-09-13）

- 新增 `scripts/contract-module-map.mjs`（+ `.d.mts`）：把「ledger 模块 ↔ SDK 目录」映射抽成**唯一真相源**，
  并补上反向查询 `findLedgerModulesForSdkDir`（映射是**多对一**的：`src/rendezvous` 同时承载
  `msc4108_rendezvous` 与 `rendezvous`，`src/push` 与 `src/notifications` 分别承载 `push` 与
  `push_notification`）。覆盖门禁改为从这个共享模块导入（原来是各自抄一份表）。
- `sdk-contract-codegen.mjs` 的 route-table 改为**三源合并**（按 `(method, path)` 去重）：
  ① 既有条目（向后兼容，不删任何 manager 依赖的路径）→ ② **ledger 清单**（`modules/*.json`，权威路由源）
  → ③ `ROUTE_CONTRACT.md`（只补 ledger 也没有、但文档声明的路径）。生成头注释同步改成
  `Entries: N (既有条目 ∪ ledger 清单 ∪ ROUTE_CONTRACT.md...)`（原来写 `Source: modules/<dir>.json`，与实现不符）。
- 效果（实测）：`ledger-only` 差集 **16 → 0**；friend 表 **88 → 93 条**，§2 里那 5 条写方法
  （`POST /friends`、`POST /friends/dm/{user_id}`、`POST /friends/groups`、`POST /friends/search`、
  `PUT /friends/{user_id}/status`）全部到位；生成物 diff 很小（44 文件、66+/50−，多数只改头注释）。
- 差集门禁口径随之修正为**按 SDK 目录 + 兄弟模块并集**比对（原按模块比对会把同目录兄弟模块的路由误报成漂移，
  `rendezvous` 就是这么被误报的）。登记表从 116 条收缩到 **94 条**（16 条 ledger-only 已修好被删，
  按设计这会让门禁报 stale 倒逼清理）。
- 验证：`contract:codegen:check` = 47 modules in sync；`tsc --noEmit` 通过；
  `spec/unit/contract-drift-gate.spec.ts` 9 例通过。

### SDK-1b 实施记录（2026-09-13）

- 新增 `src/friend/paths.ts`：`friendPath()` 把 friends 路径约束到 `StripVendor<FriendPathPattern>`
  （route-table 现在以 ledger 为权威源，93 条路由）。
- 三个子管理器共 **32 处** `path:` 全部改为 `friendPath(...)`（block 2 / list 23 / request 7）。
  **`tsc --noEmit` 一次通过** —— 说明模块手写的路径与 ledger 声明完全一致（这也是它今天能正常工作的原因），
  而现在任何拼写错误都会变成编译错误。
- 删除 `friend_room` 白名单：覆盖门禁里该模块从「有表没人读」升为**强证据**
  （`src/friend/paths.ts` 导入了 route-table）→ 强证据 **37**、白名单 **12**、弱证据只剩 `push_notification`。
- 新增 `spec/unit/contract-route-table-source.spec.ts` 4 例守住 SDK-1 的不变量：
  **每个目录的表必须覆盖该目录承载的全部 ledger 路由**（改了 ledger 不重新 codegen 即红）、
  friend 那 5 条写方法在表里、生成头注释写明三源合并、三个子管理器都用 `friendPath()`。

### SDK-3 实施记录（2026-09-13）

- codegen 新增一条**归属规则**：文档（`ROUTE_CONTRACT.md`）只补「ledger 完全没声明」的路径 ——
  一条路由只要 ledger 已声明（无论归哪个模块），就不再由文档塞进**别的** SDK 目录的表里
  （文档的章节归属与 ledger 的 `registered_by` 并不一致，push 章节里就写着 `push_notification` 的 7 条）。
- 按该规则**一次性剪掉** `src/push/__generated__/route-table.ts` 里那 9 条属 `push_notification` 的历史条目
  （后者在 `src/notifications/` 表里本来就有，且是 ledger 派生的）。剪完重新 codegen **不会复活**
  （已实测 `grep -c "r0/push/"` = 0），`tsc --noEmit` 一次通过 —— 说明它们确实没有调用点。
  push 表 37 → 28 条，该目录 sdk-only 漂移 10 → **1**（只剩 `/pushers/`，见 B-10）。
- 登记表随清理收缩：94 → **85** 条（9 条按 stale 规则删除）。
- 顺带查实 **B-10**：`/pushers/`（带尾斜杠）是 `push.rs:16` 真实注册的路由（GET+POST），
  ledger 里没有、文档只有 GET —— 与 B-8 同一类「router 有、manifest 无」，因此 SDK 表里这条
  既不能删也不该删（它是真实路由），只能等后端补 ledger。

### SDK-5 实施记录（2026-09-13，第一批：归他模块的历史条目）

先用一个分类脚本给全部 85 处差集取证（每条判：是否已由**别的** ledger 模块声明 / 后端 router 是否注册 / SDK 是否有调用点），
再按结论动手 —— 这一步直接推翻了我自己的一条后端结论（B-8 撤回）：

| 类别                                          | 条数 | 处置                                                                                                                                                           |
| --------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已由别的 ledger 模块声明（全局 ledger 命中）  | 67   | 从本目录表删除（含 room 的 50、worker-admin 的 11、sync 的 4、search 的 2）                                                                                    |
| 后端 router 有、ledger 无（B 类缺口）         | 9    | **保留**并登记（例：`/pushers/` B-10；room 的 `anti_screenshot`、`user/mutual_rooms`；media 的 `upload/provider`、`upload/token`；cas/e2ee 各 2 条待逐个核实） |
| 需人工核实（末段关键词有 SDK 命中，多为误报） | 7    | 暂留，逐条查后端与调用点                                                                                                                                       |
| 无注册也无调用点                              | 2    | 可删（media admin 变体）                                                                                                                                       |

本轮实际执行「已归他模块」中**除 search 之外**的 65 条（search 那 2 条 vendor 路由被 `srp()` 类型依赖，
且归属卡在后端 B-1，按纪律保留）：

- `src/room` 192 → **144** 条（删掉 50 条 friend / room_summary / mutual_rooms 等历史副本 —— 它们在
  `friend` 与 `room-summary` 表里本来就有）；
- `src/sync` 11 → **7** 条（删掉 3 条 sliding-sync + 1 条 my_rooms —— 分别在 `sliding-sync` 与 `vendor` 家族）；
- `src/worker-admin` 26 → **15** 条（删掉 11 条 `/_synapse/worker/v1/*` —— 它们是 ledger `worker_body` 家族，
  `worker-body` 表里本来就有；**这也正是 B-8 撤回的原因**）。
- `tsc --noEmit` 一次通过 → 这 65 条**没有任何 SDK 调用点**，是纯粹的重复数据；重新 codegen 不会复活（已实测）。
- 差集 **85 → 20**，登记表同步收缩到 **20 条**（stale 机制强制）。
- 剩余 20 条：media 9、cas 2、e2ee 2、search 2、room 3、external-service 1、push 1 —— 都属「B 类缺口」或
  「需人工核实」，下一批处理；**worker-admin 那 11 条不属于"不能清"**，可以清（已在第一轮清掉）。

> 更正：`msc4108_rendezvous` 那条**不是漂移**（见 §3 表格与 B-4 撤回）——`src/rendezvous` 目录同时承载 `msc4108_rendezvous` 与 `rendezvous` 两个 ledger 模块，两族路径各有声明。这也解释了为什么差集门禁必须**按目录 + 兄弟模块并集**比对。

---

## 6. 后端问题清单（只列，本轮不改后端代码）

| 编号        | 问题                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 证据                                                                                   | 建议                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-1**     | `vendor_route_manifest()` 是迁移遗留的**分组注册器**，3 条路由语义上属于 room/search，导致 ledger 出现一个不对应任何功能模块的分组，下游（SDK）无法映射                                                                                                                                                                                                                                                                                                                                                    | `assembly.rs:296-308`；`modules/vendor.json` 3 条；SDK 无 `src/vendor/`                | 把 `my_rooms` 归 room、`search_rooms`/`search_recipients` 归 search（改 `registered_by` 或拆 manifest）；这样 SDK 侧不需要任何别名特例        |
| **B-2**     | `push_notification` 的 7 条 legacy push v1 路由（`/push/devices`、`/push/rules*`、`/push/send`）与 `push` 模块的 spec 路由功能重叠，且**全栈无调用点**（只有它自己的单测引用）                                                                                                                                                                                                                                                                                                                             | `push_notification.rs:330-372`；`assembly.rs:539`；SDK/Tjg grep 0 命中                 | 明确它们的服务对象：若无客户端在用，建议下线或标注为"兼容保留"；若有，请在契约文档里写清与 `/pushers`、`/pushrules` 的关系                    |
| **B-3**     | `friend_room` 同时保留 client 前缀（r0/v1，64 条）与 vendor 前缀（29 条）两套；SDK 只用 vendor                                                                                                                                                                                                                                                                                                                                                                                                             | `friend_room.rs:400-444`；SDK `src/friend/**` 全用 `VendorPrefix`                      | 确认 client 前缀那套是否还有客户端在用；若无，建议在 ledger/文档里标注待弃用（配合 B-5）                                                      |
| ~~**B-4**~~ | **已撤回（2026-09-13）**：`msc4108_rendezvous` 不存在「两个路径族只有一个在线」的问题 —— `src/rendezvous` 目录同时承载 `msc4108_rendezvous` 与 `rendezvous` 两个 ledger 模块，unstable 与 v1 两族各有模块声明，表与 ledger 并集完全一致（0 差集）。原判断来自「按模块比对」的错误口径                                                                                                                                                                                                                      | –                                                                                      | 不需后端动作；差集门禁已改为**按 SDK 目录 + 兄弟模块并集**比对                                                                                |
| **B-5**     | ledger 缺少"弃用/兼容"元数据：`RouteEntry` 只有 method/path/registered_by/query_params/auth/rate_limit_exempt                                                                                                                                                                                                                                                                                                                                                                                              | `route_ledger.rs:48-70`                                                                | 增加 `deprecated_since` / `compat_only` / `owner` 一类字段。B-2/B-3 这类"还活着但没人用"的路由才能被契约表达，下游不必靠白名单+到期日手工记账 |
| **B-6**     | `ROUTE_CONTRACT.md`（人工文档）与 ledger 是**两个独立源**且已漂移：ledger 1407 条（all），文档 904 条；且文档缺少若干方法形态（例如 `POST /_matrix/vendor/v1/friends` 在文档里没有，却是在线路由）                                                                                                                                                                                                                                                                                                         | `route_manifest.all.json` vs `ROUTE_CONTRACT.md`；§2 的 5 条                           | 文档应由 ledger 生成（或加一条"文档路由 ⊆ ledger"的校验门禁）。这是 SDK 侧漂移的上游成因：SDK 的 route-table 正是从这份文档渲染的             |
| **B-7**     | （提示）`registered_by` 的语义是"注册文件"而不是"功能模块"，这与 SDK 的按功能分目录假设天然错位                                                                                                                                                                                                                                                                                                                                                                                                            | `route_ledger.rs:58-64` 注释 + §1 的事实表                                             | 短期靠 B-1 个案解决；中期可考虑给 `RouteEntry` 增加显式 `owner`/`feature` 字段，把"谁注册的"与"属于哪个功能面"分开                            |
| ~~**B-8**~~ | **已撤回（2026-09-13，SDK-5 清理时查实）**：那 11 条路由**在 ledger 里**，只是归 `worker_body` 模块（`modules/worker_body.json` 11 条全是 `/_synapse/worker/v1/*`），与 `worker` 模块（15 条）合计 26 条，正好等于 `worker.rs` 的注册数。我最初拿「模块 manifest vs router」比对，而不是「该目录承载的全部模块并集 vs router」，于是把自己的口径错误报成了后端缺口 —— 抱歉。真实情况是 SDK 的 `worker-admin` 目录表里混进了 `worker_body` 家族的 11 条（两模块分别映射到 `worker-admin` 与 `worker-body`） | `modules/worker_body.json`（11 条）+ `modules/worker.json`（15 条）= `worker.rs` 26 条 | 无需后端动作；SDK-5 已把 11 条从 `worker-admin` 表删除（它们本就在 `worker-body` 表里）                                                       |
| **B-9**     | 7 条 admin media 路由被声明成 `/_matrix/media/v3/_synapse/admin/v1/media*`（**双前缀**），后端实际只提供 `/_synapse/admin/v1/media_callbacks` 等；SDK 侧对这些路径**零调用点**                                                                                                                                                                                                                                                                                                                             | `src/media/__generated__/route-table.ts` 的 9 条 sdk-only；后端 `module.rs:880-913`    | 确认从未存在则从 SDK 表删除（SDK-5）；若历史存在过，请在契约文档记录迁移                                                                      |

| **B-10** | **ledger 又漏了一条真实路由**：`push.rs:16` 注册 `.route("/pushers/", get(get_pushers).post(set_pusher))`（带尾斜杠，GET+POST），但 ledger 的 `push` 模块里**没有** `/pushers/`（只有 `/pushers`），文档只列了 `GET /pushers/`。这是 B-8 同类问题（router 有、manifest 无），也解释了 SDK push 表里那条 `/pushers/` 为何既不在 ledger 也无法删除 | `push.rs:16` vs `modules/push.json` | 与 B-8 同一修法：让 manifest 与 router 注册同表派生 |

---

## 7. 附录：取证命令

```bash
# SDK 侧双向差集（24/49 模块）
cd matrix-js-sdk && node scripts/quality/probe-contract-drift.mjs

# friend 表缺哪 5 条
node -e "const j=require('./docs/api-contract/generated/modules/friend_room.json');
const t=require('fs').readFileSync('src/friend/__generated__/route-table.ts','utf8');
for (const e of j.entries) if (!t.includes('{ method: \"'+e.method+'\", path: \"'+e.path+'\" }')) console.log('缺:', e.method, e.path);"

# 后端：ledger 分组
cat docs/api-contract/generated/modules/{vendor,push,push_notification,friend_room}.json | \
  python3 -c "import sys,json;[print(json.loads(x)['module'], json.loads(x)['entry_count']) for x in sys.stdin.read().split('}\n{')]"

# 后端：vendor 分组来源与 push_notification 注册点
sed -n '296,308p' ../synapse-rust/src/web/routes/assembly.rs
sed -n '350,372p' ../synapse-rust/src/web/routes/push_notification.rs
grep -rn "push_notification" ../synapse-rust/src/web/routes/assembly.rs
```
