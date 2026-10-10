# matrix-js-sdk 全方位审查报告（2026-10-11）

> 审查人：SDK 审计（火眼眼）。全部结论来自本轮**实跑**（非引用旧审计结论）。
> 基线：develop @ `b1e066f4f`，版本 40.2.0-langkebo.6，工作区干净。

## 一、总体印象

项目的**质量门禁体系是显著强项**：22 段契约门禁 + 88 个门禁类 npm script、契约驱动架构（ledger → manifest → codegen → 编译期路径字面量）、棘轮台账只降不升、豁免到期硬失败。本轮实跑**全部通过**（详见附录 A）。近期 C1-C6 公共面收窄重构（累计删除约 1100+ 行死后代码）无残留引用，抽查 spec 全绿。

主要问题集中在三处：**release 线门禁缺口未收敛**、**结构性盲区（前端裸调）未收口**、**存量巨型文件无收敛计划**。

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

#### P0-2 前端裸调零门禁（批次 L 未做）

Tjg（另一仓）绕过 SDK 直接调后端 API 的调用点**无任何契约判据**。W-04 已实证该模式能同时犯三类错（期望 JSON 而恒 302、带认证打登录前端点、第二真源）。这是继「路径 → 报文 → URL 构造器」之后的**第四层盲区**，也是唯一尚未建判据的一层。

**建议**：沿用既有范式（默认 skip + `--strict`）建跨仓静态判据；样本可从 W-04/W-06/W-07 的修复历史反推。

### 🟡 P1 应修问题（7 项）

#### P1-1 存量巨型文件无收敛计划

实测 `src/` 超 LARGE_FILE_THRESHOLD(1500 行) 的文件共 **7 个**：

| 文件                           | 行数 |
| ------------------------------ | ---- |
| src/client.ts                  | 4382 |
| src/models/room.ts             | 4234 |
| src/web-rtc/call.ts            | 3125 |
| src/rust-crypto/rust-crypto.ts | 2569 |
| src/sync.ts                    | 2076 |
| src/models/event.ts            | 1792 |
| src/web-rtc/groupCall.ts       | 1730 |

`quality:large-file-check` 只拦「本次 diff ≥ 50 行」的**增量**，存量无棘轮下降机制。client.ts 虽已分解出 49 个 client-\*.ts 模块，主文件本身仍持续膨胀。**建议**：给门禁加「超限文件清单只降不升」棘轮（与 path-contract-coverage 同型），或按 C 批次模式逐文件收窄。

#### P1-2 Manager 注册表命名不一致（99 keys）

实测仍存在：`"external-service"`、`"saml-auth"` 为 kebab-case 混在 camelCase 联合类型中；`"BurnAfterReadManager"` 残留 Manager 后缀。`manager-accessor-wiring-baseline` 有守卫不会误接线，但认知负担高、新成员易错，且与 `manager-extensions/index.ts` 的 kebab-case 注册键**不可直接比对**。

#### P1-3 空 catch 基线债 71 处

`swallow-fallback` 基线 71（matched: 71, stale: 0），只棘轮不收敛。静默吞错是线上疑难杂症高发区，建议按模块分批清偿并下调基线。

#### P1-4 ESLint 60 警告（no-explicit-any 为主）

0 错误不挡 CI，但 `no-explicit-any` 集中区（如 `src/managers/cache-manager.ts` 3 处 any + 1 处未用变量 `prefix`）恰是类型安全盲点。3 处可 `--fix` 自动修复。建议设 any 数量棘轮（type-coverage 已有分模块 ≥95% 门禁，可加总量只降不升）。

#### P1-5 公共 API 文档缺口大（棘轮只保证不涨）

实测：**1202 个导出无 JSDoc / 713 无 @example / 210 处 throw 缺 @throws**（143 个类、488 个可达文件口径）。对下游 Tjg 的使用体验影响直接——SDK 的类型提示质量取决于此。

#### P1-6 1 个 moderate 漏洞未处置

`pnpm audit --audit-level=high` 通过（2 个 high 已在 `pnpm.auditConfig.ignoreGhsas` 登记豁免），但残留 **1 个 moderate** 未豁免也未通过 overrides 升级。建议查明归属后二选一处置，避免滚成 high。注意 overrides 已有 12 条，追加需同步 lockfile（沙箱内跑不了 `pnpm install`）。

#### P1-7 knip 死代码检测未接线 CI

`knip.ts` 配置存在但不在任何 workflow / npm 链中。C 批次手工删了约 1100 行死后代码——本可机器化持续防复发。建议挂入 lint 链或 CI。

### 💭 P2 观察项（4 项）

1. **spec/integ/real-backend/ 混合形态**：同树共存 Vitest 套件与 tsx 独立脚本，直接 `vitest run` 会踩坑（AGENTS.md 已警告）。建议目录层面隔离（`real-backend/scripts/` vs `real-backend/spec/`）。
2. **manager-codegen 弱证据豁免 1 条**（cas：WAIVED 且有表没人读）——豁免理由是"弱证据"而非"确认不消费"，宜补强证据或移除。
3. **契约可比面覆盖上限**：wire-format 覆盖桶 `route-contract-unavailable: 588`（655 可比对 vs manifest 1027 条）、admin-response-contract 可比面 139/129。这是抽取能力上限而非缺陷，但意味着**约四成路由的报文仍无机器判据**，扩抽取器时按纪律先量比对面。
4. **`matrix-events-sdk@0.0.1`**：版本号古老但为上游 matrix-org 同款类型包、仅 4 个类型文件引用，风险低；升级需跟随上游。

## 三、验证记录（本轮实跑）

| 检查项              | 命令                                                    | 结果                                      |
| ------------------- | ------------------------------------------------------- | ----------------------------------------- |
| 类型                | `pnpm lint:types` (tsc --noEmit)                        | ✅ 0 错                                   |
| Lint                | `pnpm lint:js`                                          | ✅ 0 错 / 60 警                           |
| 路径契约            | `pnpm quality:path-contract`                            | ✅ 豁免 20 处在期                         |
| 路由对账            | `pnpm quality:route-set-parity`                         | ✅ 729 条全命中 / 豁免 0                  |
| URL 构造器          | `pnpm quality:url-constructors`                         | ✅ 15 条登记全命中                        |
| 报文契约（CI 预演） | `SYNAPSE_RUST_REPO=/nonexistent-xyz …check-wire-format` | ✅ exit 0，桶与基线一致                   |
| 响应体契约          | `pnpm quality:admin-response-contract`                  | ✅ 无违规                                 |
| 跨线差集            | `pnpm quality:cross-line-parity`                        | ✅ 5 门禁差集已登记；非门禁 30/30 顶线    |
| 豁免到期            | `pnpm quality:waiver-expiry`                            | ✅ 91 条全在期                            |
| manager codegen     | `pnpm quality:manager-codegen`                          | ✅ 38/38 消费（10 documented 非消费者）   |
| DTO 严格度          | `pnpm quality:generated-dto-strictness`                 | ✅ current 67 / new 0                     |
| 类型覆盖            | `pnpm quality:type-coverage`                            | ✅ 各模块 ≥95%                            |
| 空 catch            | `pnpm quality:swallow-fallbacks`                        | ✅ 71=基线（见 P1-3）                     |
| 债务标记            | `pnpm quality:debt-markers`                             | ✅ 0                                      |
| MSC 文档            | `pnpm quality:msc`                                      | ✅ 63/63                                  |
| 敏感日志            | `pnpm quality:log-sensitive`                            | ✅ 0                                      |
| 安全审计            | `pnpm audit:high`                                       | ✅（2 high 豁免登记；1 moderate 见 P1-6） |
| C6 波及 spec 抽查   | `vitest cas.spec device-keys.spec`                      | ✅ 22/22                                  |
| 删除残留            | WidgetsManager / widget 残留引用                        | ✅ 零残留                                 |

已核对 CI workflow step 清单（`systemic_refactor_quality_gate.yml` 17 步）与本地链差异：`large-file-check`、`contract-provenance`、`granular-coverage`、coverage 四门禁、`audit:high`、`perf:ci` 为 CI-only，本地逐段已补跑可跑项。

## 四、优先级建议

1. **先建判据再修实例**（项目既有纪律）：P0-2（批次 L）与 P0-1（release 移植 5 门禁）先行。
2. P1-1 巨型文件棘轮 + P1-6 moderate 漏洞处置。
3. P1-3/P1-4/P1-5 三项台账债按模块分批清偿。
4. P2 观察项随手清。

---

_本报告由火眼眼审查工作流产出；「改坏输入必须变红」验收纪律适用于上述所有门禁类建议。_
