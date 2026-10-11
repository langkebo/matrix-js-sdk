# matrix-js-sdk 全方位审查报告（2026-10-11）

> 审查人：SDK 审计（火眼眼）。全部结论来自本轮**实跑**（非引用旧审计结论）。
> 初版基线：develop @ `b1e066f4f`，版本 40.2.0-langkebo.6，工作区干净。
> **二轮复核基线（2026-10-11）**：`release/contract-entrypoint-next @ 3fc1e0d38`。develop 与 release/消费线已分叉（merge-base `7e4c26dfb`，各领先 4 个提交），本轮 I-01~I-10 修复落在 **release 消费线**；下文各条以该线实跑为准。

## 一、总体印象

项目的**质量门禁体系是显著强项**：22 段契约门禁 + 88 个门禁类 npm script、契约驱动架构（ledger → manifest → codegen → 编译期路径字面量）、棘轮台账只降不升、豁免到期硬失败。二轮实跑 19 项核查中 **17 项 ✅、1 项 ❌（`quality:msc` 转红）、1 项 ⚠️（巨型文件 diff 判据）**（详见 §三）；C1-C6 公共面收窄重构（累计删除约 1100+ 行死后代码）无残留引用，抽查 spec 全绿。

初版列出的三处主要问题中，**前两项（release 线门禁缺口、前端裸调盲区）经复核认定闭环**；第三项（存量巨型文件）**已建成棘轮，但被 I-10 文档补全显著抬高**。同时新增两项待跟踪：`quality:msc` 门禁红（MSC3952）、巨型文件棘轮基线刷新仅在工作区未提交。

> **复核更新（2026-10-11）**：前两项经复核**认定闭环** —— P0-1（release 线 5 门禁）在 Tjg 消费的 pin `9d0229a21` 上已全部存在（台账豁免仅因 `DEFAULT_REF` 指向已淘汰旧分支）；P0-2（前端裸调门禁）在 Tjg 仓已建成并接 CI（实测绿）。逐条结论见下文各自「复核闭环」注记。
>
> **I-10 副作用（2026-10-11）**：I-10 公共 API 文档补全（`3fc1e0d38`，147 文件 / +19868 行**纯 JSDoc**）把 `src/client.ts` 由 4383 行抬到 **7307 行（+67%）**，并使 `room-summary/index.ts`(2113)、`room/RoomManager.ts`(2230) **首次越过 1500 线** —— 存量巨型文件由 7 个增至 **9 个**（详见 P1-1）。

## 二、问题清单

### 🔴 P0 结构性问题（2 项）

#### P0-1 release 线缺 5 大核心契约门禁（D-01 尾巴）

`check-cross-line-gate-parity` 实测：release/contract-entrypoint 线**缺少**以下 5 个门禁（已登记、有 F5 守卫跟踪，但**未收敛**）：

- `verify-path-contract.mjs`（路径契约）
- `check-wire-format.mjs`（报文契约）
- `check-url-constructors.mjs`（URL 构造器，批次 K 新增）
- `check-route-set-parity.mjs`（路由集合对账）
- `check-admin-response-contract.mjs`（响应体契约）

**影响**：Tjg 实际消费的 release 线上，路径与报文一致性**无机器判据**——develop 上修得再好，release 未追平前消费侧裸奔。非门禁差集 30 条已**顶满棘轮上限**（supportGrew=false 恰好卡线），一旦 develop 再新增支撑文件即红。

**建议**：按 F5 台账已登记的口径，优先移植这 5 条（其中 K4 已解耦为可独立移植形态，`25be6a889`）；`f3503aa43` 已记录「F3 高依赖组」口径被证伪，移植障碍比预估低。

> **复核闭环（2026-10-11，I-08）**：Tjg 真正消费的 pin 提交 **`9d0229a21`**（位于 `release/contract-entrypoint-next`）经逐条 `git cat-file` 校验**已含上述 5 条门禁**；台账中 5 条豁免仅因 `DEFAULT_REF` 指向**已淘汰的本地旧分支** `release/contract-entrypoint`（`802781b4f`）而保留。「消费线缺判据」的原始风险已不存在 —— 认定闭环，`check-cross-line-gate-parity` 实测 `ok`。详见 issue-fix-report §5 / plan §11.6。

#### P0-2 前端裸调零门禁（批次 L 未做）

Tjg（另一仓）绕过 SDK 直接调后端 API 的调用点**无任何契约判据**。W-04 已实证该模式能同时犯三类错（期望 JSON 而恒 302、带认证打登录前端点、第二真源）。这是继「路径 → 报文 → URL 构造器」之后的**第四层盲区**，也是唯一尚未建判据的一层。

**建议**：沿用既有范式（默认 skip + `--strict`）建跨仓静态判据；样本可从 W-04/W-06/W-07 的修复历史反推。

> **复核闭环（2026-10-11，I-09）**：该判据**已建成** —— Tjg 仓 `scripts/check-bare-matrix-paths.mjs`（`pnpm check:bare-matrix-paths`），CI 接线于 `.github/workflows/quality-gate.yml:77`；实测绿（扫描 1230 文件，命中 168，登记缺陷 0，`EXIT=0`）。故「第四层盲区（前端裸调）尚缺判据」已不成立 —— 认定闭环。详见 issue-fix-report §5 / plan §11.6。

### 🟡 P1 应修问题（7 项）

#### P1-1 存量巨型文件（9 个）—— 棘轮已建成，但被 I-10 抬高

实测 `src/` 超 `LARGE_FILE_THRESHOLD`（1500 行）的文件共 **9 个**：

| 文件                           | 行数 |
| ------------------------------ | ---- |
| src/client.ts                  | 7307 |
| src/models/room.ts             | 4234 |
| src/web-rtc/call.ts            | 3126 |
| src/rust-crypto/rust-crypto.ts | 2570 |
| src/room/RoomManager.ts        | 2230 |
| src/room-summary/index.ts      | 2113 |
| src/sync.ts                    | 2077 |
| src/models/event.ts            | 1793 |
| src/web-rtc/groupCall.ts       | 1731 |

> **复核闭环 + 副作用（2026-10-11，I-04）**：初版建议的「超限文件清单只降不升棘轮」**已建成** —— `check-large-file-changes.mjs` 新增内嵌基线 `LARGE_FILE_RATCHET_BASELINE`（与 path-contract-coverage 同型：新增超限文件或基线内增长即失败，无 `--accept-new` 拒绝写入）。但同期的 I-10 文档补全（`3fc1e0d38`，纯 JSDoc）**当天就把基线顶高**：`client.ts` 4383 → 7307（+2925 行），`room-summary/index.ts`(2113) 与 `room/RoomManager.ts`(2230) 首次越线入账 —— 基线由 7 条增至 **9 条**。棘轮只拦「新增/增长」用例，拦不住**一次性大规模加注释**这种合法写入。
>
> **两处遗留须跟踪**：① 该基线刷新**当前仅在工作区未提交**（`git status`：` M scripts/quality/check-large-file-changes.mjs`），提交前需以 `--accept-new` 复核；② diff 级判据对 `HEAD~1...HEAD` 实测 **EXIT=1** —— `client.ts`(diff 2956) / `room-summary`(1056) / `RoomManager`(730) 触发 `[REVIEW]`，需 `ARCH_REVIEW_APPROVED=true` 放行。
>
> **建议**：对「纯注释/纯文档」增量单列豁免口径，或把 API 文档补全挪出 `src/**`（如独立 `docs/api-jsdoc/`），避免注释膨胀持续顶高代码体量棘轮。

#### P1-2 Manager 注册表命名不一致（99 keys）

~~实测仍存在：`"external-service"`、`"saml-auth"` 为 kebab-case 混在 camelCase 联合类型中；`"BurnAfterReadManager"` 残留 Manager 后缀。~~

**已修复（2026-10-11）**：`ManagerName` 联合类型三个离群键收敛为统一 camelCase —— `"external-service"` → `externalService`、`"saml-auth"` → `samlAuth`、`"BurnAfterReadManager"` → `burnAfterRead`，`ManagerTypeMap` 与三处 `registerManagerClass`/`getOrCreateManager` 调用点同步；`pnpm quality:manager-extensions` 97 条目不变、相关 spec 99 passed。`manager-extensions/index.ts` 的 kebab-case 属**另一命名空间**（扩展模块目录键），保持原样。

#### P1-3 空 catch 基线债（71 → 38）

初版实测基线 71（matched: 71, stale: 0），只棘轮不收敛。

> **复核闭环（2026-10-11，I-03）**：已分批清偿并下调基线 —— 实测 `current: 38, baseline: 38 [matched: 38, stale: 0], new: 0`，门禁 ✅（EXIT=0）。剩余 38 处为存量在期豁免（`waiver-expiry` 台账 `swallow-fallback: 38`），继续按模块收敛。

#### P1-4 ESLint 警告（60 → 0）

初版实测 60 警告（`no-explicit-any` 为主），0 错误不挡 CI，但 any 集中区是类型安全盲点。

> **复核闭环（2026-10-11，I-01）**：`pnpm exec eslint src spec perf scripts` 实测**无输出、0 错 0 警**（EXIT=0）；overrides 将 `smol-toml@<=1.8.0` 升至 `1.9.1`（I-02）以消解对应告警。any 总量可继续作为观察项（`type-coverage` 已有 src 总量 ≥98%、分模块 ≥95% 门禁兜底）。

#### P1-5 公共 API 文档（1202 → 0）

初版实测：**1202 个导出无 JSDoc / 713 无 @example / 210 处 throw 缺 @throws**（143 个类、488 个可达文件口径）。下游 Tjg 的类型提示质量直接取决于此。

> **复核闭环（2026-10-11，I-10 收官）**：`3fc1e0d38` 完成全域补全 —— 实测口径「52 个 export 入口 / 488 个可达文件 / 143 个类」，**缺口 0 无 JSDoc / 0 无 @example / 0 throw 缺 @throws**，`public-api-docs-ledger.json` 回落 **0/0/0**，门禁 ✅ `无违规`（EXIT=0）。代价见 P1-1（纯 JSDoc 增量显著抬高巨型文件体量）。

#### P1-6 依赖漏洞（moderate → 0）

初版残留 **1 个 moderate** 未豁免也未通过 overrides 升级，建议查明归属后处置，避免滚成 high。

> **复核闭环（2026-10-11，I-02）**：`pnpm audit --audit-level=moderate` 实测 `2 vulnerabilities found / Severity: 2 high (2 ignored)` —— 即 **0 moderate**（EXIT=0）；2 个 high 仍在 `pnpm.auditConfig.ignoreGhsas` 登记豁免。overrides 现 **12 条**（含新增 `smol-toml@<=1.8.0 → 1.9.1`），已随 lockfile 落地。

#### P1-7 knip 死代码检测（未接线 → 已接线）

初版：`knip.ts` 配置存在但不在任何 workflow / npm 链中，C 批次手工删的死后代码无法机器化防复发。

> **复核闭环（2026-10-11，I-05）**：`lint` 链已接入 `pnpm lint:knip`（`package.json#scripts.lint`），实测 `knip` **EXIT=0 / 0 findings**。

### 💭 P2 观察项（5 项）

1. **`quality:msc` 门禁转红（MSC3952）**：二轮实测 `Current MSC count: 64 / Baseline count: 63`，报 `❌ 文档未覆盖 (1条): MSC3952`，**EXIT=1**。该引用由 I-10 文档补全（`3fc1e0d38`）在 `src/client.ts:6088` 的 JSDoc 中引入（`git log -S MSC3952` 唯一命中 `3fc1e0d38`），而 `docs/MSC_SDK_MAPPING.md` 未同步登记。**须补一条映射条目或移除该注释**，否则 release 线该门禁持续红。
2. **spec/integ/real-backend/ 混合形态**：同树共存 Vitest 套件与 tsx 独立脚本，直接 `vitest run` 会踩坑（AGENTS.md 已警告）。建议目录层面隔离（`real-backend/scripts/` vs `real-backend/spec/`）。
3. **manager-codegen 弱证据豁免 1 条**（cas：WAIVED 且有表没人读，实测仍为 `弱证据，1`）——豁免理由是"弱证据"而非"确认不消费"，宜补强证据或移除。
4. **契约可比面覆盖上限**：wire-format 覆盖桶 `route-contract-unavailable: 588`（655 可比对 vs manifest 1027 条）、admin-response-contract 可比面 `139/129`。这是抽取能力上限而非缺陷，但意味着**约四成路由的报文仍无机器判据**，扩抽取器时按纪律先量比对面。
5. **`matrix-events-sdk@0.0.1`**：版本号古老但为上游 matrix-org 同款类型包、仅 4 个类型文件引用，风险低；升级需跟随上游。

## 三、验证记录（二轮实跑，基线 `release/contract-entrypoint-next @ 3fc1e0d38`）

| 检查项          | 命令                                                | 结果                                                                     |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| 类型            | `pnpm lint:types` (tsc --noEmit)                    | ✅ 0 错                                                                  |
| Lint            | `eslint src spec perf scripts`                      | ✅ 0 错 / 0 警                                                           |
| 类型覆盖        | `pnpm quality:type-coverage`                        | ✅ src 98.80%；各模块 ≥95%                                               |
| 路径契约        | `pnpm quality:path-contract`                        | ✅ 豁免 20 处在期                                                        |
| 路由对账        | `pnpm quality:route-set-parity`                     | ✅ route-table 39 文件/729 条全命中 ledger / 豁免 0                      |
| URL 构造器      | `pnpm quality:url-constructors`                     | ✅ 15 条登记全命中                                                       |
| 响应体契约      | `pnpm quality:admin-response-contract`              | ✅ entries=129 / 可比对 139 / 无违规                                     |
| 跨线差集        | `pnpm quality:cross-line-parity`                    | ✅ 5 门禁差集已登记；非门禁 30/30 顶线                                   |
| 豁免到期        | `pnpm quality:waiver-expiry`                        | ✅ 58 条全在期（path-contract 20 / swallow 38）                          |
| manager codegen | `pnpm quality:manager-codegen`                      | ✅ Covered 38 / Waived 10 / Missing 0（100%）                            |
| DTO 严格度      | `pnpm quality:generated-dto-strictness`             | ✅ current 67 / new 0                                                    |
| 空 catch        | `pnpm quality:swallow-fallbacks`                    | ✅ 38 = 基线（见 P1-3）                                                  |
| 债务标记        | `pnpm quality:debt-markers`                         | ✅ 0                                                                     |
| 公共 API 文档   | `pnpm quality:public-api-docs`                      | ✅ 缺口 0/0/0（143 类，见 P1-5）                                         |
| knip 死代码     | `pnpm lint:knip`                                    | ✅ 0 findings（见 P1-7）                                                 |
| MSC 文档        | `pnpm quality:msc`                                  | ❌ 64/63，缺 **MSC3952**（EXIT=1，见 P2-1）                              |
| 敏感日志        | `pnpm quality:log-sensitive`                        | ✅ 0                                                                     |
| 安全审计        | `pnpm audit --audit-level=moderate`                 | ✅ 0 moderate（2 high 已豁免登记）                                       |
| 巨型文件        | `node scripts/quality/check-large-file-changes.mjs` | ⚠️ 存量棘轮 ok（9 文件在限内）；diff 判据 **EXIT=1 [REVIEW]**（见 P1-1） |

> 说明：报文契约（`check-wire-format`，需 `SYNAPSE_RUST_REPO`）与 C6 波及 spec 抽查沿用初版结论（本轮未复跑）。`quality:msc` 为二轮**新转红**项，是本轮唯一 ❌。

已核对 CI workflow step 清单（`systemic_refactor_quality_gate.yml` 17 步）与本地链差异：`large-file-check`、`contract-provenance`、`granular-coverage`、coverage 四门禁、`audit:high`、`perf:ci` 为 CI-only，本地逐段已补跑可跑项。

## 四、优先级建议

1. **先建判据再修实例**（项目既有纪律）：P0-2（批次 L）与 P0-1（release 移植 5 门禁）两项复核后**已认定闭环**，无需再投入。
2. **P2-1（`quality:msc` 红）应最先处置** —— 一行映射/注释即可消红，且该门禁在 release 线上现在持续失败，属"改坏输入必须变红"的直接体现。
3. **P1-1 巨型文件**：棘轮已建成，重点是 ① 提交前的基线刷新复核（`--accept-new`）；② 梳理 I-10 副作用、评估"纯注释增量"豁免口径，避免注释膨胀继续顶高体量棘轮。
4. P1-3（剩余 38 处空 catch）/ P1-4（any 观察项）按模块分批续清。
5. P1-5 / P1-6 / P1-7 已复核闭环（见各条注记）。
6. P2-2~P2-5 观察项随手清。

---

_本报告由火眼眼审查工作流产出；「改坏输入必须变红」验收纪律适用于上述所有门禁类建议。_
