# 契约产物口径说明

本文件回答一个反复被问到的问题：**「SDK 到底覆盖了多少后端路由？」**

答案不是一个数字，而是四个 —— 它们统计的是**四件不同的事**，此前没有任何地方解释过差异，
于是四个数字被混用、互相「打脸」。本文件把口径固定下来，并由
`quality:docs-counts` 从代码/生成物实时计算、与本文比对，任一不一致即 CI 失败。

---

## 一、四个数字

| #   | 产物                                                                   | 口径（统计的是什么）                                                                                      | 数量 |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---: |
| 1   | `docs/api-contract/generated/route-manifest.all.json` 的 `entry_count` | **后端 ledger 声明的全部路由**。`state_profile=all`，即 oidc / worker / saml 三个特性开关全开时的最大集合 | 1032 |
| 2   | `docs/api-contract/generated/modules/*.json` 文件数                    | 后端按 `registered_by` 拆出的**逐模块镜像**。文件名沿用后端模块名（snake_case）                           |   49 |
| 3   | `src/*/__generated__/` 目录数                                          | 有 SDK 侧生成产物的模块。目录名是 **SDK 目录名**（kebab-case），经 `CONTRACT_MODULE_MAP` 折叠/改名而来    |   48 |
| 4   | `src/*/__generated__/route-table.ts` 文件数                            | 其中**真正生成了路由表**的模块；其余只生成 `dto.ts`                                                       |   46 |
| 4b  | 上述 46 张表的条目总数                                                 | SDK 侧可被 `import` 的字面量路由条目                                                                      |  798 |

> 记忆锚点：**1032 是后端的，798 是前端的**；49 是后端模块视角，48/46 是 SDK 目录视角。

---

## 二、差异是怎么产生的

### 1032 → 49：后端 ledger 按 `registered_by` 分桶

`route-manifest.all.json` 的每条 entry 形如
`{ method, path, registered_by, path_params, query_params }`，
`entry_count` 就是 entry 数组长度。`modules/` 下的 49 个文件是同一批 entry 按 `registered_by` 分桶的结果，
因此 **49 个文件合计的 entry 数 = 1032**（同一批数据，两种视图）。

### 49 → 48：后端模块名与 SDK 目录名不是同名可比

这是最容易误判的一层。两侧命名规约不同，且**多个后端模块会折叠到同一个 SDK 模块**：

| 后端模块（snake_case）               | SDK 目录（kebab-case）                 |
| ------------------------------------ | -------------------------------------- |
| `account_data`                       | `account-data`                         |
| `friend_room`                        | `friend`                               |
| `worker`                             | `worker-admin`                         |
| `worker_body`                        | `worker-body`                          |
| `thirdparty`                         | `third-party`                          |
| `assembly`                           | （映射到多个 SDK 模块，本身无目录）    |
| `3PID` / `AI 连接` / `其他` / `装配` | **无 SDK 对应**（章节名映射为 `null`） |

映射表是代码里的 `CONTRACT_MODULE_MAP`（`scripts/sdk-contract-codegen.mjs`），
以**后端文档 heading 的中文名**为键（如 `账户 → auth`、`Worker → worker-admin`）。

因此**不要**用文件名做集合差：`set(modules/*.json) - set(src/*/__generated__)` 会因为命名规约不同
而报出一大堆假差异（实测两侧各有约 17-20 个「对不上」的名字，绝大多数是同一模块的两种写法）。

### 48 → 46：2 个模块被显式豁免，只生成 DTO

`SKIP_ROUTE_TABLE_MODULES`（`scripts/sdk-contract-codegen.mjs`）列出 2 个**不生成 route-table** 的模块：

```
admin · federation
```

豁免不是「免检」：coverage 门禁要求每个条目各有一条 waiver（带 reason + 过期时间），
且**未列入白名单的模块缺表会直接失败**。这 7 个模块的 `dto.ts` 仍然生成，
所以 `__generated__` 目录数是 48 而不是 46。

### 798 vs 1032：两张表的构造规则不同

- `route-manifest.all.json` = **纯后端 ledger**。
- `route-table.ts` = **既有条目 ∪ ledger 清单 ∪ `ROUTE_CONTRACT.md`** 三者按 `(method, path)` 去重。

也就是说 route-table 是「SDK 曾经手写过的路径」与「后端声明的路径」的并集，
因此它的条目**不一定**是 manifest 的子集。跨模块重复由
`quality:contract-entrypoint` 强制为零（实测当前 46 张表之间 0 重复）。

---

## 三、该用哪个数字

| 想问的问题                       | 用哪个                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| 后端一共暴露了多少 API？         | **1032**（`route-manifest.all.json`）                                   |
| SDK 能给出多少条字面量路由常量？ | **798**（46 张 route-table），入口见 `matrix-js-sdk/contract`           |
| 有多少模块有 SDK 侧生成物？      | **48**                                                                  |
| 后端按模块拆成了多少份？         | **49**                                                                  |
| 某条具体路径 SDK 有没有覆盖？    | 查 `src/contract/index.ts` 的 `SDK_CONTRACT_ROUTES`，不要看上面任何计数 |

---

## 四、口径本身的守卫

- `quality:contract-entrypoint` —— 保证 `src/contract/index.ts` 的模块清单
  与磁盘上的 route-table 集合**双向严格一致**，且跨模块无重复路由。
- `quality:docs-counts` —— 从生成物实时计算上表的数字，与**本文档**及
  `CLAUDE.md` / `AGENTS.md` 中声明的数字比对，不一致即失败。
- `contract:codegen:check` —— 保证 `__generated__` 与 manifest 同步。

因此：**改动 codegen、增删模块、或调整豁免名单后，本文档的数字会被 CI 要求同步更新** ——
这正是它不会再腐烂的原因。

---

## 五、剩余 1 个豁免的收编路径（2026-10-15 实测改造量）

`quality:manager-codegen` 当前 WAIVED **1 个模块 / 179 条**无 route-table 约束路由。
逐个的体量与**实测**障碍（避免下次重新侦查）：

| 模块    | 条数 | 障碍（2026-10-15 实测）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` |  179 | **最大块，且被两类问题阻断（见 §六）**。实测：`this.adminRequest(...)` 调用点 **240 处**（11 个 sub-manager），**227 处可批量包装**（76 字面量 + 151 模板字面量）—— 脚本已验证一次成功；**`apu()` 就是现成挂载点**（13 处已在用）。⚠️ 纠正：**93 处显式类型实参不是障碍**（它只堵死"给方法加类型参数"这条路，用外部 `apu` 包装可绕开）。真正的阻断是：① admin 目录**跨 7 个 ledger 模块**（admin / feature_flags / module / telemetry / external_service / room / event_report），断言须 union 多表且覆盖 6 种前缀；② **§六 的 4 条契约外路径**须先处置。 |

**另设 `SERVER_ONLY_MODULES`（2026-10-15）**：`federation`（55 条）已从 WAIVED **移出**，归入
与 `UMBRELLA` 并列的独立类别 —— 它与 WAIVED 的性质不同：WAIVED 隐含"本应覆盖、目前暂缺"（有期限的欠账），
而 federation 是"**本口径不适用**"（路由由 homeserver 之间与 key server 调用，客户端 SDK 天然不承担）。
归类依据是**逐条实测**的路径前缀（见门禁脚本内 `SERVER_ONLY_MODULES.federation.evidence`），
不是凭印象。门禁输出现在会显式打印 `server-only 55 条属服务端面`，不会被静默吞掉。

**已收编（8 个模块 / 81 条）**：`delayed_events`(7)、`dm`(5)、`key-rotation`(9)、`feature-flags`(4)、
`invite_blocklist`(4)、`app_service`(39)、`cas`(12)、`reactions`(1)。收编通用范式见 `docs/api-contract/delayed-events.md` 与
`docs/api-contract/invite-blocklist.md` 的「当前审计结论」节。

---

## 六、收编中发现的「契约外路径」（2026-10-15，为 `admin` 做批量断言时暴露）

给 `admin` 的 227 处调用点批量加 `PathAssert` 后，`tsc` 立刻报出 **42 处不匹配**。逐条回源核对
（对照 `synapse-rust` 源码）后分两类 —— **这两类正是"收编"的价值所在**：

### 🔴 A. 真实缺陷（SDK 调用后端不存在的端点 ⇒ 404）— **均已修复（2026-10-15）**

| 位置                                                                      | SDK 调用                                                         | 后端实际                                                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/admin/sub-managers/admin-federation-manager.ts:221`                  | `POST /_synapse/admin/v1/federation/destinations/{server}/reset` | 仅注册 `…/reset_connection`（`admin/federation.rs:25`）；**同文件 L183 用的正是 `/reset_connection`** ⇒ 该处疑为笔误 |
| `src/admin/sub-managers/admin-room-manager.ts:630`（`deleteRoomMessage`） | `DELETE /_synapse/admin/v1/rooms/{room_id}/messages/{event_id}`  | 后端只有 `GET …/rooms/{room_id}/messages`（`admin/room/mod.rs:120`）⇒ **无 DELETE 形态**，该方法恒 404               |

**处置（2026-10-15）**：

- `admin-federation-manager.resetFederationDestination` ⇒ 去掉 `/reset` 试探与 404 fallback，**单请求**直打
  `…/destinations/{server}/reset_connection`（与 `delayed_events` 当年的 action-in-PATH 试探同型缺陷）；
  `spec/unit/admin-new-endpoints.spec.ts` 的两个"prefers/falls back"用例合并为「只发一次请求」。
- `admin-room-manager.deleteRoomMessage` ⇒ **删除该方法**（后端无对应端点，自加入起即恒 404；
  需删消息请用同级 `cascadeRedactEvent`）。删的是方法体 + jsdoc，同文件对它的 `{@link}` 引用已改写。

### ⚠️ B. ~~ledger 覆盖缺口~~ → **本结论有误，已撤回（2026-10-15 复核）**

> **撤回说明**：曾判定 `/_synapse/admin/v1/invite/{blocklist,allowlist}` 属"后端有注册、ledger 没导出"。
> 复核发现 **ledger 里其实有这 2 条**（admin 表各含 `GET|POST` 两形态）。原判断的匹配用了
> `path.endsWith(相对路径)`，被 SDK 调用点"**多一段 userId**"（`/invite/blocklist/{user_id}`）
> 掩盖 ⇒ 误报为"无模块命中"。**教训：用后缀匹配反查归属时，必须先确认段数一致**。
>
> **真正的问题在 SDK 侧**（与 §六 A 同类，属真实缺陷而非缺口）：
> `admin-config-manager.ts` 有 4 处调用使用**带 userId** 的路径 ——
> `POST|DELETE /_synapse/admin/v1/invite/blocklist/{user_id}`、`/invite/allowlist/{user_id}`，
> 而后端 `admin/server.rs:29-36` 只注册**无参数**的全局形态
> （`get_invite_blocklist_admin` / `set_global_invite_blocklist_admin`，及 allowlist 对应两个）
> ⇒ 这 4 处**恒 404**。后端的形态是"全局名单整体设置"（body 传集合），SDK 的 "单用户增删"
> 需改为**读—改—写**（与 `InviteBlocklistManager.addToBlocklist` 同款），或收敛掉这组方法。
> 处置方案与跨仓确认项见 `artifacts/sdk-backend-handoff-2026-10-15.md`。

**处置顺序建议**：先修 A 的两条（行为缺陷）→ 后端补 B 的导出 → 再做 admin 收编
（断言设计：多前缀（6 种）+ 多模块 union（7 张表））。

> **`app_service` 的收编还纠正了两处既有错误**：
> ① **映射键写错**：`LEDGER_MODULE_ALIASES` 的键原为 `appservice`，而 SDK 目录实名是 **`app-service`**
> ⇒ `findSdkDirForModule("app_service")` 指向不存在的目录，**ledger 通道永远取不到该模块**（实测
> codegen 对 `src/app-service/` 输出 `(0 entries)`）；改为实名后表恢复 39 条。
> **`cas` 的收编同理纠正了一处与代码不符的 waiver 描述**：原写"CasManager 经 `resolvePath` 运行时
> 二元前缀拼接、从不 import route-table"——实际 11 处路径构造点全是「方法内局部常量 `const path = "…"`」
> 或字面量，并无运行时拼接。接入 `apu()`/`cpu()` 断言后即受管辖（现仅剩 3 个豁免）。
>
> ② **豁免理由与事实不符**：原 waiver 按"纯服务端面"豁免，实际 39 条 = 17 条 admin 面 + 12 条 AS 面
>
> - 10 条客户端面，且 `src/app-service/index.ts` 的 21 处路径与之逐条对应（其中 4 处 thirdparty
>   路由借 third-party 模块表，同 `room-summary` 借 `RoomPath` 之例）。
