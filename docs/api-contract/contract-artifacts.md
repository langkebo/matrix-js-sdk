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
| 4   | `src/*/__generated__/route-table.ts` 文件数                            | 其中**真正生成了路由表**的模块；其余只生成 `dto.ts`                                                       |   47 |
| 4b  | 上述 47 张表的条目总数                                                 | SDK 侧可被 `import` 的字面量路由条目                                                                      |  977 |

> 记忆锚点：**1032 是后端的，977 是前端的**；49 是后端模块视角，48/47 是 SDK 目录视角。

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

### 48 → 47：1 个模块被显式跳过，只生成 DTO

`SKIP_ROUTE_TABLE_MODULES`（`scripts/sdk-contract-codegen.mjs`）列出 1 个**不生成 route-table** 的模块：

```
federation        # 服务端面（S2S / key-server），客户端 SDK 不承担 —— 见 §五
```

跳过 ≠ 免检：`quality:manager-codegen` 要求后端每个模块都落到一个**明确归类** ——
COVERED（有 route-table 消费者）、`SERVER_ONLY_MODULES`（本口径不适用）或 `WAIVED_MODULES`
（有期限的欠账，每条带 reason + 过期时间）。**未归类而缺表会直接失败**（`missing` / `NO_CONSUMER`）。

`federation` 的 `dto.ts` 仍然生成，所以 `__generated__` 目录数是 48 而不是 47。

### 977 vs 1032：两张表的构造规则不同

- `route-manifest.all.json` = **纯后端 ledger**。
- `route-table.ts` = **既有条目 ∪ ledger 清单 ∪ `ROUTE_CONTRACT.md`** 三者按 `(method, path)` 去重。

也就是说 route-table 是「SDK 曾经手写过的路径」与「后端声明的路径」的并集，
因此它的条目**不一定**是 manifest 的子集。跨模块重复由
`quality:contract-entrypoint` 强制为零（实测当前 47 张表之间 0 重复）。

---

## 三、该用哪个数字

| 想问的问题                       | 用哪个                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| 后端一共暴露了多少 API？         | **1032**（`route-manifest.all.json`）                                   |
| SDK 能给出多少条字面量路由常量？ | **977**（47 张 route-table），入口见 `matrix-js-sdk/contract`           |
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

## 五、WAIVED 收编线（2026-10-15 收口，当前归零）

`quality:manager-codegen` 的 **WAIVED 已归零** —— 无 route-table 约束的路由从 **315 条降到 0**、
模块维度覆盖率 79.2% → **100%**。下表是这条线收掉的 **9 个模块 / 260 条**，以及每条**原豁免理由**
经回源核对后的**实际成因**。这张表的价值在于：**多数原始理由与事实不符**。

| 模块                                    |      条数 | 原豁免理由 → 实测成因                                                                                                                             |
| --------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delayed_events`                        |         7 | 「1 route；manager 不需要表」→ 后端已补齐 7 条，且 `LEDGER_MODULE_ALIASES` 与文档章节**两条通道都没登记**                                         |
| `dm` / `key-rotation` / `feature-flags` | 5 / 9 / 4 | 「no route-table consumer」→ 实为「自持前缀 + 字面量相对路径」，前缀与契约逐字一致                                                                |
| `invite_blocklist`                      |         4 | 「后端无该章节」→ 枚举源实为**本仓** `CONTRACT_INDEX.md` 的文档链接，建页即可收编                                                                 |
| `app_service`                           |        39 | 「纯服务端面」→ 实为 17 admin + 12 AS + 10 客户端面；**且 `LEDGER_MODULE_ALIASES` 键名写错**（`appservice` vs `app-service`）⇒ 表生成但是**空的** |
| `cas`                                   |        12 | 「运行时前缀拼接、需独立改造」→ 全是方法内局部常量 + 字面量，无拼接                                                                               |
| `reactions`                             |         1 | 消费点在 `src/client.ts`（会碰 large-file 门禁）→ 真正构造点在 `src/room-events/index.ts`                                                         |

| 模块    | 条数 | 障碍（2026-10-15 实测）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` |  179 | **最大块，且被两类问题阻断（见 §六）**。实测：`this.adminRequest(...)` 调用点 **240 处**（11 个 sub-manager），**227 处可批量包装**（76 字面量 + 151 模板字面量）—— 脚本已验证一次成功；**`apu()` 就是现成挂载点**（13 处已在用）。⚠️ 纠正：**93 处显式类型实参不是障碍**（它只堵死"给方法加类型参数"这条路，用外部 `apu` 包装可绕开）。真正的阻断是：① admin 目录**跨 7 个 ledger 模块**（admin / feature_flags / module / telemetry / external_service / room / event_report），断言须 union 多表且覆盖 6 种前缀；② **§六 的 4 条契约外路径**须先处置。 |

**另设 `SERVER_ONLY_MODULES`（2026-10-15）**：`federation`（55 条）已从 WAIVED **移出**，归入
与 `UMBRELLA` 并列的独立类别 —— 它与 WAIVED 的性质不同：WAIVED 隐含"本应覆盖、目前暂缺"（有期限的欠账），
而 federation 是"**本口径不适用**"（路由由 homeserver 之间与 key server 调用，客户端 SDK 天然不承担）。
归类依据是**逐条实测**的路径前缀（见门禁脚本内 `SERVER_ONLY_MODULES.federation.evidence`），
不是凭印象。门禁输出现在会显式打印 `server-only 55 条属服务端面`，不会被静默吞掉。

> **通用判据（本线用 5 次返工换来的）**：拿到 WAIVED / 豁免条目，先**回源读代码**再动手 ——
> 理由里的「需独立改造 / 运行时拼接 / 无消费者 / 后端无该章节」经常已过期或是误判；
> 真正的障碍通常是**登记缺失**（alias 键名写错、章节未映射、页不存在）。

收编通用范式见 `docs/api-contract/delayed-events.md` 与 `docs/api-contract/invite-blocklist.md`
的「当前审计结论」节；`admin` 的多表 union 断言范式见 `src/admin/admin-base-manager.ts` 的
`AdminScopedPath` / `StripAdminModule`。

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

**处置状态（2026-10-15 收口）**：**A 已修**（2 条）；**B 经复核撤回**（原结论有误，见上）；
**admin 已收编** —— 断言设计落地为 7 表 union + 6 种前缀剥离，221 处调用点批量接入 `apu()`。

> **`app_service` 的收编还纠正了两处既有错误**（与 §五 上表同源）：
>
> ① **映射键写错**：`LEDGER_MODULE_ALIASES` 的键原为 `appservice`，而 SDK 目录实名是 **`app-service`**
> ⇒ `findSdkDirForModule("app_service")` 指向不存在的目录，**ledger 通道永远取不到该模块**（实测
> codegen 对 `src/app-service/` 输出 `(0 entries)`）；改为实名后表恢复 39 条。
>
> ② **豁免理由与事实不符**：原 waiver 按"纯服务端面"豁免，实际 39 条 = 17 条 admin 面 + 12 条 AS 面
>
> - 10 条客户端面，且 `src/app-service/index.ts` 的 21 处路径与之逐条对应（其中 4 处 thirdparty
>   路由借 third-party 模块表，同 `room-summary` 借 `RoomPath` 之例）。
>
> **`cas` 的收编同理**纠正了一处与代码不符的 waiver 描述：原写"CasManager 经 `resolvePath` 运行时
> 二元前缀拼接、从不 import route-table"—— 实际 11 处路径构造点全是「方法内局部常量
> `const path = "…"`」或字面量，并无运行时拼接。接入 `apu()` / `cpu()` 断言后即受管辖。

### 🔴 C. 补抽取器盲区后新发现的 1 条 404（2026-10-15 已修）

**背景**：`quality:path-contract` 的两个抽取器存在一个**静默盲区** ——
`this.request({ method, path: <恒等助手>("…"), prefix })` 这种**对象形态 × 助手包装**的调用点，
位置抽取器（`extractWrapperCalls`）只扫位置形态，对象抽取器（`extractObjectCalls`）又只认
`path:` 后**紧跟裸字面量** ⇒ **两边都看不见**。实测全仓约 **287 处**，其路径从未被本门禁校验过
（也从未进"未校验"桶，故门禁长期恒绿）。

**补法**：给 `extractObjectCalls` 加可选 `identityHelpers`，复用 `unwrapIdentityPath` 展开第一实参
（默认不传 ⇒ 行为与修正前完全一致，便于灰度）。启用后当场报出 1 处不符：

| 位置                                          | SDK 实际发出                                                                          | 后端 / 契约表                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/room/RoomManager.ts` `createPrivateRoom` | `POST …/client/v3/rooms/create_private`（**调用点显式传 `prefix: ClientPrefix.V3`**） | `POST /_matrix/vendor/v1/rooms/create_private`（`synapse-web/src/routes/room.rs:170`；room 契约表 L64） |

⇒ **运行时必然 404**，已改为 `prefix: VendorPrefix`（同文件另有 5 处 vendor 路由本来就这样写，属漏改）。

> ⚠️ **顺带暴露一个断言设计的结构性缺口（未修，待议）**：
> `PathAssert<P, StripXxx<XxxPath>>` 只保证「**相对路径字符串**在表内」，
> **不校验调用点传入的 `prefix:` 是否与表项前缀一致**。本例中 `rp("/rooms/create_private")`
> 能通过 `tsc`（该相对路径在表内存在，来自那条 vendor 条目），但运行时前缀却是 v3
> ⇒ **`tsc` 与 `path-contract` 都抓不到，只有把对象形态纳入抽取后才暴露**。

**顺带修掉一个假阳性类**：新纳入的调用点里有 22 处用 **ES 简写** `prefix,`（= `prefix: prefix`），
而原正则只认 `prefix: X` ⇒ `prefixExpr` 为 `null` ⇒ `resolvePrefix(null)` **静默**按默认
`/_matrix/client/v3` 处理 ⇒ 把 `getVoiceStats(prefix: string = VendorPrefix)` 这类**正确**调用点
误报为"契约不符"。已在抽取器里识别简写（记为不可解前缀而**跳过**，而不是猜默认值）。

### 🔴 D. 由「模块级常量前缀」不可解而遮蔽的 3 条不符（2026-10-15；**#1 判读已订正、#2/#3 已定调**）

`quality:path-contract` 的 `--verbose` 会列出「动态跳过」的调用点。当前 **99 处**里，

| 前缀表达式                            |   处数 | 性质                                                                                      |
| ------------------------------------- | -----: | ----------------------------------------------------------------------------------------- |
| `""` / `authedRequest` / `request` 等 |     47 | 报告标签含糊（多为位置形态的位置推断）                                                    |
| `prefix`（**ES 简写** `prefix,`）     |     22 | 已识别，正确记为"求不出"而跳过（见 §六 C）                                                |
| **模块级字符串常量**                  | **30** | `const CAS_PROTOCOL_PREFIX = "/_synapse/cas";` 这类 —— **源码里就能解出，只是解析器没做** |

后一类里，用常量前缀解出后与 ledger 比对，**3 处不符**（已逐条回源 `synapse-rust` 核实）：

| #   | 位置                                                                                        | SDK 实际发出                                                                                                       | 后端                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/dehydrated-device/index.ts:189` `claimDevice()`                                        | **POST** `…/org.matrix.msc3814.v1/dehydrated_device/{device_id}/events`                                            | **后端 GET + POST 都注册了**（`assembly.rs:217-221` 为 `get(..).post(..)`）⇒ 这不是后端缺陷，是** ledger 只导出了 GET** —— 判读已订正，见下                                                   |
| 2   | ~~`src/dehydrated-device/index.ts` `getDeviceEvent()`~~                                     | `GET …/dehydrated_device/{device_id}/**initial_device**`                                                           | ✅ **已处置（2026-10-15，方案 A）** —— 全仓无 `initial_device` 路由（该族现为 **6 条**：`dehydrated_device` 的 GET/PUT/DELETE、`/status`、`/{device_id}/events` 的 GET+POST）⇒ 方法**已删除** |
| 3   | `src/external-service/index.ts`（原 `triggerOpenclawWebhook` / `triggerTrendradarWebhook`） | `…/external/openclaw/{service_id}/webhook`（**后端已删**）`…/external/trendradar/{service_id}/webhook`（后端待删） | ✅ **已处置（2026-10-15）** —— 见下                                                                                                                                                           |

**判读与建议**（不擅自改，因为三条都需要产品/后端意图）：

- **#1 ✅ 判读已订正（2026-10-15 二次核实，推翻上一版结论）**：上一版写「疑为后端注册成了 GET」—— **该判断有误**。
  实测 `synapse-web/src/routes/assembly.rs:217-221` 为 `.route(path, get(..).post(..))`，即**后端 GET 与 POST 都注册了**，
  且源码注释明确写「POST = MSC3814/ruma 规范形态；GET = Synapse v1.157 兼容别名（弃用中）」。
  ⇒ 真正的问题是 **ledger 只导出了 GET**（`derived_route_table_always.inc.rs:139-141` 仅列 GET；
  `route-manifest.all.json` 亦仅 GET），属**契约导出漏项**。**SDK 的 `claimDevice()`（POST）本来就是对的，不需要改**。
- **#2 ✅ 已处置（2026-10-15，方案 A）**：不是拼写笔误，而是「把请求体字段名误当路径段」的构造错误。
  `getDeviceEvent()` **已删除**（含 spec 2 例与 `CHANGELOG` BREAKING 条目）。完整取证见 **§七 7.2**，方案对照见 **§七 7.3**。
- **#3 ✅ 已处置（2026-10-15）**：`openclaw` 在后端**全仓已无痕迹**（本轮实测确认），
  `trendradar` 由后端一并下线。SDK 侧两个封装 `triggerOpenclawWebhook()` 与
  `triggerTrendradarWebhook()` **已移除** —— 公共 API 变更记入 `CHANGELOG.md` 的 **BREAKING** 条目；
  通用入口 `triggerWebhook()`（`…/external/webhook/{service_id}`，后端**仍注册**）保留。
  `docs/api-contract/external-service.md` 的服务类型清单与「封装覆盖率」口径同步订正
  （该页原先写「已封装 0 / 覆盖率 0%」，是从未填写的占位）。

> **复现命令**（不依赖任何门禁，只读）：
>
> ```
> node scripts/quality/verify-path-contract.mjs --verbose   # 看「跳过的动态调用」
> ```
>
> 再用常量前缀手工拼完整路径与 `docs/api-contract/generated/route-manifest.all.json` 比对。

**下一步（未做）**：在抽取层支持**模块级字符串常量**前缀（`const X = "…"`）。
启用后上面这些调用点会一并进入校验，故有**两个前置**：

1. **#2**：按 §七 E 选定处置（推荐方案 A：**删除**）—— 否则那条不存在的路径会直接把门禁打红；
2. **#1**：**ledger 需先补 `POST …/{device_id}/events`** —— 后端**有**该路由（`assembly.rs:220`）而 ledger 只有 GET，
   于是 SDK 的 `claimDevice()`（POST、规范形态）在 ledger 里「无对应条目」，启用校验后会同样被判不符。
   补 ledger 属**契约/后端侧**动作（与 invite 那次同型的"导出不全"）。

> **关于本节的路径写法**：表格里的 SDK 路径写成 `…/xxx`（省略前导 `/_synapse`）而非完整字面量，
> 因为 `quality:api-contract-doc-paths` 会把**任何**反引号包裹的 `/_matrix` / `/_synapse` 路径
> 拿去和 ledger 比对，而本节记录的正是"ledger 里不存在"的路径 ⇒ 写全会被该门禁判为"陈旧路由行"
> （棘轮只降不升）。这是门禁判据正确的表现，不是文档偷懒。

---

## 七、`dehydrated_device`：一个完全不受契约管辖的模块（2026-10-15）

### 7.1 结构盲区 —— 这是 §六 D 的 #2 能长期隐藏的根本原因

`dehydrated_device` 的 5 条路由在 ledger 里归属 **`assembly` 桶**。而 codegen 的**模块枚举源**
是本仓 `docs/api-contract/CONTRACT_INDEX.md` 的**文档链接**（不是后端文档）：

- `CONTRACT_INDEX.md` **没有** dehydrated 行；
- `docs/api-contract/` 下**没有**该模块页；
- `scripts/contract-module-map.mjs` / `sdk-contract-codegen.mjs` 里**没有任何** `dehydrat` 登记。

⇒ 该模块**从不进入 codegen 枚举**：既不在 `COVERED`，也不在 `WAIVED` / `SERVER_ONLY`，
**连 `Missing` 都不报**（`Missing` 的判据是"枚举进来了却没交付"）。
结果是 **SDK 侧从未生成 route-table、从未有 `PathAssert`** ⇒ `src/dehydrated-device/index.ts` 的
**8 处调用点全部处于管辖外**。而门禁把 `assembly` 的 105 条按 `umbrella` 单列、**不计入覆盖率分母**，
所以这个洞不会被任何数字暴露。

> **⚠️ 与 `invite_blocklist` / `delayed_events` **不同型** —— 这是本节最关键的订正**：那两个模块在
> ledger 里**有独立模块**，补登记即可收编；而 `dehydrated_device` **不是 ledger 模块**（它的 6 条只是
> `assembly` 桶的一部分）⇒ ①「建页 + 加索引行」**不够**：codegen 会枚举到新页，但
> `loadLedgerEntriesForSdkDir("dehydrated-device")` 返回**空**（`assembly` 只映射到 `auth`，
> 见 `LEDGER_MODULE_TO_SDK_DIR`）⇒ 会生成一张**空表**（比没有更糟：看似受管辖、实则零约束）；
> ② 也**登记不了** `LEDGER_MODULE_ALIASES`（ledger 侧没有这个模块名）。故本轮改为**借表**（见 7.4）。

### 7.4 本轮实际做法：**借 `auth` 表**（已实施，零机制改动）

**没有**新建该模块的独立契约表，而是按既有映射**借用 `auth` 表**做断言 —— `assembly → auth` 是
`contract-module-map.mjs` 里**早已存在**的映射，`src/auth/__generated__/route-table.ts`（105 条）
本就含这 6 条 msc3814 路由。这与 `room-events` 借 `ReactionsPath`、`app-service` 借 `ThirdpartyPath`、
`room-summary` 借 `RoomPath` **完全同型**。

实施：新增 `StripMsc3814`（剥离 `/_matrix/client/unstable/org.matrix.msc3814.v1`），
本目录 **7 处** `path` 接入 `dp()`。auth 表里不带该前缀的条目会落到 `StripPrefix` 的 fallback（`never`）
而被丢弃 ⇒ **实际放行的只有该前缀下的 6 条**。

**变异自证（3 组，全部按预期报红）**：

| 变异                                                            | 结果                                                |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `/dehydrated_device` → `/dehydrated_devicez`                    | ❌ TS2345                                           |
| `/dehydrated_device/status` → `/dehydrated_device/statuz`       | ❌ TS2345                                           |
| **`…/events` → `…/initial_device`（复现 §六 D #2 的历史缺陷）** | ❌ **TS2345** —— 证明该断言**本可以拦住那个真缺陷** |

**代价（已知、可接受）**：断言面是「auth 表里带 msc3814 前缀的条目」而非"独立成表"；
且本目录**仍不在 `quality:manager-codegen` 的管辖清单里**（该门禁按 ledger 模块遍历，
而 `dehydrated_device` 不是 ledger 模块）。

### 7.5 若要让该模块"真正纳入管辖"：需要 codegen 的**子集切分**（待议，本轮未做）

彻底办法是给 codegen 加"从某 ledger 模块按路径前缀切出子集"的机制，例如：

```js
// scripts/contract-module-map.mjs
export const LEDGER_MODULE_SLICES = {
    "dehydrated-device": {
        fromLedgerModule: "assembly",
        pathPrefix: "/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device",
    },
};
```

再让 `loadLedgerEntriesForSdkDir` 优先走 slices、`contract-sync` 允许"多页共享同一镜像源"
（两个页面的针脚同指 `assembly.json`）。

**评估**：改动涉及 codegen 的模块发现、镜像指针与门禁枚举口径，属**机制扩展**；
而收益是「断言面 6 条 vs 借表的 6 条」—— **实际等价**，额外收益仅是形式更干净与门禁可管辖。
⇒ 本轮**不做**，仅记录。**更根本的做法在后端侧**（见 7.6）。

### 7.6 后端建议：让 ledger 能给该族独立模块（P2）

`dehydrated_device` 之所以不是独立模块，是因为它的路由由 `assembly::create_router` 直挂
（`derived_route_table_always.inc.rs` 里的 `registered_by` 即 `assembly::create_router`），
而 ledger 导出器按 `registered_by` 分桶（`ledger_export.rs` 的 `moduleKeyFor`）。

若后端把 msc3814 那一族注册到**独立 sub-router**（`registered_by` 变成如
`dehydrated_device::create_router`），ledger 就会给它独立模块 ⇒ SDK 侧可生成独立表并纳入门禁。
已写入 `artifacts/sdk-backend-handoff-2026-10-15.md`。

### 7.2 #2 的完整取证：`initial_device` 到底是什么

**结论：它不是 `events` 的拼写笔误，而是「把请求体字段名误当路径段」。** 三方证据如下：

| 来源                                                                            | `initial_device` 作为**路径段** | 说明                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游 `element-hq/synapse`（`develop`，全仓代码搜索）                            | ❌ 不存在                       | 该词仅以**字段** `initial_device_display_name` 出现（`rest/client/devices.py:448,475`、`handlers/device.py`、`rest/client/register.py` 等）—— 那是登录/注册时的「**初始设备显示名**」，与 dehydrated device 无关 |
| 上游 msc3814 路由全集（`rest/client/devices.py`，唯一实现文件）                 | ❌ 不存在                       | 带 `device_id` 的只有一条：`…/dehydrated_device/{device_id}/events`；另有 `…/dehydrated_device` 的 GET/PUT/DELETE 与 `/status`                                                                                   |
| 上游 `matrix-org/matrix-js-sdk`（`src/rust-crypto/DehydratedDeviceManager.ts`） | ❌ 不存在                       | 全文件 `initial_device` 出现 **0** 次；只调 `…/dehydrated_device` 与 `…/dehydrated_device/$device_id/events`；其响应类型注释即 `The response body of GET …/{device_id}/events`                                   |
| MSC3814 / ruma `dehydrated_device::get_events`                                  | ❌ 不存在                       | 规范端点即 `…/{device_id}/events`（由后端 handler 注释与上游实现双向印证）                                                                                                                                       |
| **本仓 `synapse-rust` + ledger**                                                | ❌ 不存在                       | 全族 **5 条**，无 `initial_device`                                                                                                                                                                               |
| **本仓 SDK 自身**                                                               | ⚠️ **唯一出处**                 | `src/dehydrated-device/index.ts:14` 的**请求体字段** `initial_device_display_name?: string`（属 `CreateDehydratedDeviceRequest`）                                                                                |

⇒ 该词在本模块里的**唯一出处就是这个请求体字段**，因此高度吻合已知根因
「**照 API 清单补方法**而非照后端契约补」（见 `docs/sdk-encapsulation-audit.md`）。

**更进一步：`getDeviceEvent()` 的方法意图本身就自相矛盾**（三个信号互不一致）：

1. **名字** `getDeviceEvent`（单数）—— 同文件另有 `getDevices()`（复数、同为 `GET …/dehydrated_device`）；
2. **jsdoc** 写「获取 dehydrated device 的 **initial_device 事件**」—— 但 `initial_device` 并不是事件名；
3. **spec 里 mock 的响应形状**是 `{ algorithm: "test", account: "test" }` —— 那是 **`device_data`** 的形状，
   而 events 端点的真实响应是 `{ events, next_batch }`（上游 `DehydratedDeviceEventsResp`）。

**能力重复**：它想做的两件事都已被正确方法覆盖 ——
取 `device_data` 用 `getDevice(deviceId)`（`GET …/dehydrated_device`）；
拉 to-device 事件队列用 `claimDevice()`（`POST …/{device_id}/events`，规范形态）。

**调用者**：全仓 `src` / `spec` / `docs` 仅命中本文件与它自己的 spec；**Tjg 前端侧零调用**
（唯一命中来自 `Tjg/node_modules` 里的 SDK 包副本）。

### 7.3 处置方案（三档，推荐 A）

| 方案                          | 动作                                                                                         | 评价                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A ✅ 已实施（2026-10-15）** | **删除 `getDeviceEvent()`** + 删 spec 2 例 + `CHANGELOG` 加 BREAKING + 本页记录              | 与 `deleteRoomMessage`（后端无该端点）、`triggerOpenclawWebhook`（后端已删）**同型处置**：从未能工作的公开 API 不该留在公开面。无调用者、能力已有正确替代          |
| B                             | 改名 `claimDeviceEvents()` + 路径改为 `…/{device_id}/events`（GET，Synapse v1.157 兼容别名） | 仅当后端承诺长期保留 GET 别名时才有意义；后端自己标注「**弃用中**」，且与 `claimDevice()`（POST）重复 ⇒ 等于新增一个「弃用形态」的公开 API，与收敛公开面的方向相反 |
| C                             | 保留方法名，仅把 `initial_device` 改成 `events`                                              | 等同 B，但方法名仍不准确（`getDeviceEvent` 表达不了"分页拉取事件队列"）；不推荐                                                                                    |

> **独立的第二条线（与选哪档无关，但必须做）**：把 `dehydrated_device` **纳入 codegen 管辖**（见 §7.1）。
> 否则即使改了路径，它仍**没有 `PathAssert`**，同类问题下次照样漏 —— 这正是 §六 D 的 #2 能长期存在的原因。
