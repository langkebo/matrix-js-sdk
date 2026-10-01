# SDK 封装优化：核验后的方案与执行结果

> 生成时间：2026-09-18
> SDK 仓：`feat/sdk-contract-gap-implementation` @ `9348fe0d`
> 后端锚点：`synapse-rust` @ `7cb39946`（ledger schema v4）
> 本文取代 `synapse-rust/artifacts/sdk-project-optimization-plan.md` 与
> `synapse-rust/artifacts/sdk-optimization-execution-plan.md` 的事实前提。
> 那两份文档的执行步骤**可以直接用**，但它们的现状判断有 12 处与实测不符（见 §1），
> 照发会让工程师去做 5 天不存在的工作。

---

## 0. 一句话结论

原计划书的三条主线——「400+ 路由待补」「6 个新模块缺失」「MSC 语义分裂需修」——**经实测三条都不成立**。
真正该做的是 4 件事，本轮全部完成，客户面封装缺口从 **2 条收敛到 0 条**。
另外查出一个比缺口本身更值得修的问题：**仓库自带的 `contract:check` 门禁在结构上永远检测不到后端漂移**。

---

## 1. 计划书断言 vs 实测（逐条核验）

证据环境：SDK `9348fe0d`、后端 `7cb39946`、`docs/api-contract/generated/route-manifest.all.json`。

| # | 计划书断言 | 实测结果 | 判定 |
|---|---|---|---|
| 1 | 后端路由 1147 条 | ledger fixture `entry_count=1147` | ✅ |
| 2 | 封装面 ≈ 916/917 条 | 把「路由条数」当成了「封装方法数」。镜像实际 1124 条 → 刷新后 1147；Manager getter 只有 **108** 个 | ❌ |
| 3 | Getter 数量 151 个 | `lib/matrix-client-extensions.d.ts` 实测 **108**；`src` 侧 107 | ❌ |
| 4 | Getter 108 个（执行方案） | 与前一条自相矛盾，但 **108 正确** | ✅ |
| 5 | `scripts/quality/generate-sdk-route-manifest.mjs` | 不存在 | ❌ |
| 6 | `scripts/audit/compare-routes.py` | 不存在（`scripts/audit/` 整目录原先都没有） | ❌ |
| 7 | `scripts/audit/generate-cross-reference-report.mjs` | 不存在 | ❌ |
| 8 | Voice `🔴 缺失`，需「创建 VoiceManager」 | `src/voice/index.ts` 已存在，已封装 `/voice/stats`、`/voice/room/{id}/stats`、`/voice/user/{id}/stats`、`/voice/config`、`/voice/upload` 等（走 `VendorPrefix`） | ❌ |
| 9 | Telemetry `🔴 缺失`，需「创建 TelemetryManager」 | `src/telemetry/` 已存在（route-table 7 条）。**同一份执行方案 §3.2.1 又写「TelemetryService → TelemetryManager 已完成」——自相矛盾** | ❌ |
| 10 | Key Rotation `🟡 部分封装` | `src/key-rotation/index.ts` 已封装 `status` / `rotate` / `history/{device_id}` / `revoke` / `config` | ❌ |
| 11 | AI Connection `🟡 部分封装` | `src/ai/` 已存在 | ❌ |
| 12 | Friends 65 条待补 | `src/friend/` 已存在，route-table 94 条 | ❌ |
| 13 | MSC4204/4155/4156/3967「❌ 错配，需修」 | 按仓库唯一真相源 `MSC_SEMANTICS.md`：**4156 ✅ 一致**；4204/4155/3967 是「编号借用」且**已被既有 SDK API 覆盖**（`setPassword(..., logoutDevices)` / `ThreadingManager.getSubscribedThreads()`）。两个「旧语义孤儿」符号**早已加好 JSDoc 草案标注**并引用该文档 | ❌ 工作已完成 |
| 14 | 「400+ 新模块路由待补」 | 客户面真实缺口：刷新前 2 条 → 修复解析器误报后 1 条 → 补完 **0 条** | ❌ |
| 15 | 分页 `next_batch` 需补 | `SubscribedThreadsResponse` 类型问题需单独核（本轮未动） | ⏸ 待核 |
| 16 | `pnpm quality:exports` / `quality:manager-codegen` / `quality:generated-dto-strictness` | 三个 script 都存在 | ✅ |
| 17 | MSC 真相源位置 `synapse-rust/docs/synapse-rust/MSC_SEMANTICS.md` | 存在（SDK 侧另有一份 `docs/MSC_SEMANTICS.md`） | ✅ |

**结论：第 2、3、5、6、7、8、9、10、11、12、13、14 共 12 条不成立。**

---

## 2. 本轮实际执行的四件事

### A. 刷新契约底座（原计划书未列为独立项，实为最高优先级）

之前镜像停在 `synapse_rust_commit = 576e0d81`，落后后端 **21 条路由**，分布在 10 个模块。
底座不刷新时，所有覆盖率/缺口数字都建立在过期清单上。

| 指标 | 刷新前 | 刷新后 |
|---|---|---|
| `route-manifest.all.json` | 1124 | **1147** |
| `route-manifest.default.json` | 1105 | **1128** |
| `route-manifest.worker.json` | 1116 | **1139** |
| `index.json` 记录的 commit | `576e0d81` | **`7cb39946`** |

增量分布（+23，10 个模块）：`media +4`、`admin/assembly/e2ee/room 各 +3`、`account_data/push 各 +2`、`cas/presence/room_summary 各 +1`。

执行：`pnpm contract:sync && pnpm contract:codegen`，随后重钉 46 个模块文档的 `generated_hash`。

### B. 升级 `scripts/pin-module-docs.mjs`：从「只增不改」到「可刷新」

刷新底座后，仓库自带门禁报 **46 个文档 `generated_hash` 失配**。原脚本注释明确写着
「Pages that already carry a YAML frontmatter block are skipped」——它只会给没有 frontmatter 的页面
**新增**，无法**更新**失效哈希；而 `contract-sync --check` 给出的补救是「从 index.json 手工重抄 sha256」，
意味着每次刷新要手改 ~46 个文件。

修了 3 个缺陷：

1. **新增 REFRESH 能力**：只重写 `generated_hash` 一行，其余字段原样保留。
   刻意**不动 `last_reviewed`**——重钉是完整性同步，不是内容复核，不能让文档谎称被复审过。
2. **`ledger_schema` 硬编码 `1`** → 改为取自清单自身的 `ledger_schema`（现为 `4`）。
   原写法新增的页面会**立刻**过不了 `validateFrontmatter`（它要求等于 pin 版本）。
3. **第三份重复映射表** → 改为「优先用页面自述的 `generated_from`，回退到
   `contract-module-map.mjs` 的 `LEDGER_MODULE_ALIASES`」。
   原来的表里 `e2ee → e2ee_routes` 已过期（真实模块就叫 `e2ee`），导致 `e2ee.md` 被当成
   「无匹配」静默跳过，哈希一直修不好。

验收：幂等（连跑两次第二次 0 改动）、prettier 干净。

### C. 修审计器的 4 个解析盲区（直接消灭了 1 条假缺口）

| 盲区 | 后果 | 修法 |
|---|---|---|
| `prefix:` 只认常量/枚举，不认**字符串拼接** | `ClientPrefix.Unstable + "/org.matrix.msc2965"` 解析失败 | `unwrapPrefix` 支持 `+` 二元表达式 |
| `prefix:` 只从**路径实参**旁找，不看 options 对象 | 前缀挂在第 5 个实参上时丢失，回退成默认 `v3` | 扫描全部实参里的 `{ prefix }` |
| 前缀只支持**单值**，遇三元表达式即放弃 | `useStable ? V1 : Unstable+...` 这种双候选场景判不出来 | 引入多候选前缀数组，任一命中即算已封装 |
| 外层守卫要求 `node.expression` 是 `PropertyAccessExpression` | **裸调用 `request<T>(...)` 被整体跳过**（只有 `this.request(...)` 能匹配） | 同时接受 Identifier 被调名 |

第 4 条最隐蔽，影响最大：修复后 T1 调用点从 326 涨到 **342**，找回了 15 个此前完全不可见的裸调用点。
`src/client-auth.ts:60` 的 `GET /_matrix/client/unstable/org.matrix.msc2965/auth_issuer`——我上一轮把它
判成「真实缺口」，**那个结论是错的，它是解析器的锅**。现已归入 T1。

同时加了受 `ROUTE_AUDIT_DEBUG` 环境变量保护的调试出口（打印解析器**实际记下了什么**），
下次再出启发式偏差不必靠猜。

### D. 补齐最后一条客户面缺口

`POST /_matrix/client/v3/admin/room/{room_id}/redact`（后端 `admin::room` → `synapse-web/src/routes/admin/room/management.rs`）

- 语义：管理端**按时间范围批量撤回**（`before_ts` / `after_ts` / `limit` / `reason`），
  与 Element Synapse 同名端点一致；响应 `{ "redacted": <条数> }`；后端校验 `limit ∈ [1,10000]`。
- 为什么之前没封装：该端点挂在 **C-S v3 命名空间的 `admin/` 子路径**下，而 `AdminBaseManager.adminRequest`
  把前缀写死成 `AdminPrefix.V1` → 不能复用，必须走 `this.request({ prefix: ClientPrefix.V3 })`。
- 落地：`AdminRoomManager.redactRoomEvents()` + 2 个类型（`AdminRoomRedactPayload` / `AdminRoomRedactResult`）
  + **14 个单元测试**（含 1 条专项回归守卫：断言**不是** `/_synapse/admin/v1` 前缀）。

补充判定依据：**Tjg 前端对该端点 0 裸调、无批量撤回功能**，所以它不阻塞任何现有功能；
但它是 1147 条里最后一条客户面缺口，实现成本低于留档成本，故本轮补齐。

---

## 3. 关键机制澄清（此前被误用，务必记住）

### 3.1 SDK 有**两个互不同源**的契约镜像

| 镜像 | 生成源 | 消费者 |
|---|---|---|
| `docs/api-contract/generated/modules/*.json` | 后端 ledger（启动时校验过） | `contract:sync` 门禁、审计 |
| `src/<dir>/__generated__/route-table.ts` | **既有条目 ∪ ledger 清单 ∪ `ROUTE_CONTRACT.md`** 三者并集 | 编译期路径字面量 |

来源：`check-contract-drift.mjs` 头部注释 + `sdk-contract-codegen.mjs:589`。
我已验证 `check-contract-drift` 实测 250 条 `sdk-only`（route-table 里有、ledger 里没有），
其中大量是 `/_matrix/client/r0/...` 历史条目——正因如此：

> **`route-table.ts` 绝不能作为「SDK 已实现该端点」的证据。**
> 它甚至包含人工文档里的条目。缺口判定必须用三级证据（L1 声明 / L2 调用点 / L3 构造），
> 只认「三级全无」。

### 3.2 `contract:check` 结构性检测不到后端漂移

```js
const DEFAULT_CHECK_SOURCE_DIR = GENERATED_DIR;   // --check 把 generated/ 自己当源
```

`--check` 从已提交的 `route-manifest.*.json` 反推 `modules/*.json` 与 `index.json`，只验**内部自洽**。
所以：**后端新增 21 条路由、镜像过期的情况下，`pnpm contract:check` 依然一路绿灯。**
本次刷新前就是这种状态——这是本轮最重要的发现，比缺口本身更值得修。

### 3.3 `--check --source=<外部>` 曾被 commit stamp 不对称打成「全量漂移」

```js
if (args.mode !== "check") { applyBackendCommitStamp(profiles); }   // 旧代码
```

写入模式把 fixture 的占位 commit `00000000` 换成活的 HEAD；check 模式不换。
于是 `--check --source=<fixture>` 变成「带 stamp 的盘上内容 vs 不带 stamp 的算得内容」——
**每个文件都报漂移**，一个真正陈旧的镜像和一个新鲜的镜像表现完全一样，该用法彻底失效。
（我最初就是被这个假信号带偏过，所幸靠 entry_count 独立证据纠正了。）

已修：显式传 `--source` 时也 stamp。默认门禁路径**行为不变**。

**变异自证**（证明修完的门禁真会失败，而不是永远通过）：

| 源 | 结果 |
|---|---|
| 默认（generated/ 自身） | `in sync`，exit 0 |
| `--source=<后端 fixture>`（正确源） | `in sync`，exit 0 |
| `--source=<ledger_export>`（条目数不同的旧 fixture） | **11 个文件漂移**，exit 1 |

---

## 4. 交付验收（实测）

| 项 | 结果 |
|---|---|
| 客户面封装缺口 | **0**（原 2 条） |
| 客户面实现覆盖率 | **684 / 767 = 89.2%**（原 681/767 = 88.8%） |
| T1 调用点证据 | 342（原 326） |
| 镜像 vs 后端 | `落后 0 / 多出 0` |
| `contract-sync --check`（仓库门禁） | exit 0 |
| `contract-sync --check --source=<后端 fixture>` | exit 0 |
| `sdk-contract-codegen --check` | exit 0 |
| `tsc --noEmit` | exit 0（零错误） |
| `check-vendor-prefix-migration` | exit 0 |
| `check-manager-codegen-coverage` | exit 0 |
| `check-generated-dto-strictness` | exit 0 |
| 新增单测 | 14 passed |
| admin 回归 | 252 passed（5 个 spec 文件） |

---

## 5. 未处置项 —— 需要你决策

### 5.1 文档 ↔ 后端「路由声明」漂移（门禁仍红，但已可精确定位）

原始状态：`check-sdk-contract-alignment.mjs` exit 1，报 7 个文档「后端代码路径不存在」。
根因：后端 crate 重组后 `src/web/routes/` 已变成 **`synapse-web/src/routes/`**，而文档指针没跟着改。

我已修掉这 7 处指针（`event-report` / `key-rotation` / `moderation` / `reactions` / `relations` /
`thirdparty` / `typing`），验证目标文件全部真实存在。**这是净收益**：门禁从「7 个无法解析」
变成 **5 条可精确定位的真实漂移**：

| 文档 | 声明的端点 | 后端实际声明 | 差异 |
|---|---|---|---|
| `moderation.md:41` | `POST /_matrix/client/**{r0,v1,v3}**/rooms/{room_id}/report/{event_id}` | 仅 `v1`、`v3` | 文档多声称 **r0** |
| `moderation.md:74` | `PUT .../{event_id}/score` | 仅 `v1`、`v3` | 同上 |
| `relations.md:70` | `GET .../relations/{event_id}/{rel_type}` | 仅 `v1`、`v3` | 同上 |
| `relations.md:87` | `PUT .../{rel_type}/**{target_event_id}**` | `.../{rel_type}/**{txn_id}**` | **参数名分歧** |
| `relations.md:137` | `GET .../aggregations/{event_id}/{rel_type}` | 仅 `v1`、`v3` | 文档多声称 **r0** |

**为什么我停下**：这 5 条要求判断「文档还是后端为准」。前 4 条看形态像文档过度声称版本别名，
第 4 条是真实语义分歧（`txn_id` vs `target_event_id`），可能需要动后端或前端调用方。
**不该由审计脚本来决定，请你定调。**

### 5.2 `check-contract-drift` 245 条未登记（既有，非本轮引入）

已在 HEAD 上做基线对比确认：**改前改后同为 245 条**，与我的改动无关。
但本轮的底座刷新让其中 **5 条登记变成了 stale**（漂移已修好，登记该删）：

```
cas:sdk-only:GET /_matrix/client/v3/login/sso/redirect/cas
e2ee:sdk-only:GET /_matrix/client/v3/keys/history
e2ee:sdk-only:POST /_matrix/client/v3/keys/upload/{device_id}
push:sdk-only:GET /_matrix/client/v3/pushers/
room:sdk-only:GET /_matrix/client/v3/rooms/{room_id}/anti_screenshot
```

建议：这 5 条从 `scripts/quality/contract-drift-registry.json` 删除；其余 240 条按登记机制补 reason + 到期日。

### 5.3 其余待办（沿用原计划书，但请重新排优先级）

| 项 | 数量 | 说明 |
|---|---|---|
| `SERVER_ONLY` 缺口 | 56 | `/_matrix/app/v1/*`、`/_matrix/federation/v1/*` 等 **不属客户端 SDK 职责**，建议在文档里标注豁免而非补封装 |
| T2 弱证据（仅构造面） | 562 | 混着「变量路径（实为已封装）」与「死构造器（真问题）」，需按模块抽查 |
| Tjg 裸调收口 | `authedRequest` 42 处 / `_synapse/` 24 处 | 抽查显示**多数是路径常量与类型声明**，不是真裸调。原计划书写的「裸调点清零」需先按「真调用 / 常量 / 类型声明」三类分完再定指标 |
| `next_batch` 分页 | — | 原计划书点名 `SubscribedThreadsResponse`，本轮未核 |
| 文档后端路径腐烂（归档区） | 40+ 文档 | `docs/archive/**` 里大量 `src/web/routes/*` 指针。**我没有改归档**——改写历史归档等于篡改记录。`docs/MSC_SEMANTICS.md` 与 `synapse-rust` 侧同名文档的证据指针也仍是旧路径（如 `src/web/routes/handlers/thread.rs`，真实位置 `synapse-web/src/routes/handlers/thread.rs`），建议一并校正 |

---

## 6. 变更清单（123 项）

| 分组 | 数量 | 内容 |
|---|---|---|
| `docs/api-contract/generated/` | 54 | 3 个 profile 清单 + 50 个模块清单 + `index.json`（底座刷新） |
| `docs/api-contract/*.md` | 46 | `generated_hash` 重钉（另有 7 个含 `后端代码` 指针修正） |
| `src/**/__generated__/` | 18 | 9 个模块的 `route-table.ts` + `contract-assertions.ts` |
| `src/` 手写 | 2 | `admin/sub-managers/admin-room-manager.ts`（新方法）、`admin-room-types.ts`（新类型） |
| `scripts/` | 2 改 1 增 | `contract-sync.mjs`（stamp 修复）、`pin-module-docs.mjs`（REFRESH + 2 修）、`scripts/audit/compare-routes.mjs`（新增） |
| 新增 | 3 | `spec/unit/admin/sub-managers/admin-room-manager.spec.ts`、`artifacts/`、`scripts/audit/` |

---

## 7. 复现命令

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk

# 底座刷新（后端 ledger → SDK 镜像 → route-table → 文档重钉）
node scripts/contract-sync.mjs
node scripts/sdk-contract-codegen.mjs
node scripts/pin-module-docs.mjs

# 真·漂移检测（默认 contract:check 检测不到后端变化，必须显式指定后端 fixture）
node scripts/contract-sync.mjs --check --source=../synapse-rust/tests/unit/fixtures/ledger_export_sdk

# 缺口扫描（三级证据）
node scripts/audit/compare-routes.mjs --json artifacts/sdk-contract-gap.json
#   → artifacts/sdk-contract-gap-report.md
#   单条诊断：ROUTE_AUDIT_DEBUG='auth_issuer' node scripts/audit/compare-routes.mjs --quiet

# 验收
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/vitest/vitest.mjs run spec/unit/admin/
```
