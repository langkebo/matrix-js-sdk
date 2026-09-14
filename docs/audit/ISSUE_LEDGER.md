# ISSUE_LEDGER.md — 问题关闭台账

> **目的**：落实复核报告 §4「阶段 4 第 1 项」与「文档声明必须可执行」原则——凡台账写「已完成」的条目，必须能被一条命令 + 一个可 `git show` 的 commit 验证。
> **创建日期**：2026-09-14 · **来源**：`matrix-js-sdk-成熟度实测复核-2026-09-13.md`（二轮/三轮复核）
> **诚实声明**：本台账只收录在 SDK 仓库 `git log` 中**可实查**的 commit；外部仓库（Tjg/后端）的 hash 不在此列，单独标注归属。`matrix-js-sdk-审核报告.md` 不在本仓库内（已用 `git ls-files` 与 `find` 核实），无需「标注历史版本」——该项为报告误记。

## 记录格式

| 字段        | 说明                                               |
| ----------- | -------------------------------------------------- |
| 编号        | 沿用复核报告 P0-x / P1-x / P2-x / S-x / 阶段任务号 |
| 状态        | ✅ 已关闭 / 🟡 进行中 / ⏳ 待决策 / ❌ 误报作废    |
| 关闭 commit | 可在 SDK 仓库 `git show <hash>` 验证               |
| 验收命令    | 关闭后应 exit 0 的命令                             |

---

## 阶段 0 · 止血（SDK commit `2fe518dce`，除注明外）

| 编号                 | 问题                                       | 状态 | 关闭 commit                                  | 验收命令                                                                                |
| -------------------- | ------------------------------------------ | ---- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0.1 / P1-5 / P0-1(a) | 429 写请求重试语义过度修正                 | ✅   | `2fe518dce`（止血）→ `e28ee98cd`（分层精修） | `npx vitest run spec/unit/room-summary.spec.ts spec/unit/managers/base-manager.spec.ts` |
| 0.2 / P0-1(b)        | S-13 fail-closed 与测试对立                | ✅   | `2fe518dce`                                  | `npx vitest run spec/unit/hula-extension-support.spec.ts`                               |
| 0.3 / P0-1(c)        | megolm-backup 假定时器死循环               | ✅   | `2fe518dce`                                  | `npx vitest run spec/integ/crypto/megolm-backup.spec.ts`                                |
| 0.4 / P0-2           | exports.md 缺 `./rendezvous`/`./threading` | ✅   | `2fe518dce`                                  | `pnpm quality:contracts`                                                                |
| 0.5 / P0-3           | `check-bundle-size.mjs` 缺失               | ✅   | `2fe518dce`（脚本随此提交新增）              | `pnpm quality:bundle-size`                                                              |
| 0.5 / P0-3           | audit:high 19 条高危                       | ✅   | `2fe518dce`（`package.json` overrides）      | `pnpm audit --audit-level=high`                                                         |
| 0.6                  | Prettier 阻断（bounded-collections）       | ✅   | `2fe518dce`                                  | `pnpm lint`                                                                             |

## 阶段 1 · 契约可追溯性

| 编号 | 问题                                | 状态 | 关闭 commit | 验收命令                                                 |
| ---- | ----------------------------------- | ---- | ----------- | -------------------------------------------------------- |
| 1.1  | 跨仓 pin 门禁缺失（P0-4）           | ✅   | `e338fd265` | `node scripts/quality/check-cross-repo-pin.mjs --cwd ..` |
| 1.2  | 契约镜像落后 594 提交               | ✅   | `22df2d53a` | `pnpm contract:check`                                    |
| 1.3  | CI 接线                             | ✅   | `2b67f8682` | `pnpm lint:workflows`                                    |
| 1.x  | openclaw / ai-connection 死模块退休 | ✅   | `22df2d53a` | `npx tsc --noEmit`                                       |

## 阶段 2 · 让门禁真的会红

| 编号             | 问题                                       | 状态 | 关闭 commit     | 验收命令                                                                            |
| ---------------- | ------------------------------------------ | ---- | --------------- | ----------------------------------------------------------------------------------- |
| 2.1 / P1-6       | JSDoc 门禁假绿（空 baseRef）               | ✅   | `b031f2cbe`     | `JSDOC_PUBLIC_API_FULL_SCAN=1 node scripts/quality/check-public-jsdoc-examples.mjs` |
| 2.2              | 43 处 JSDoc 缺口                           | ✅   | `b031f2cbe`     | 同上，输出 `43 … checked`                                                           |
| 2.3 / P1-7       | DTO 严格性（ADR-0005 改形）                | ✅   | SDK `9fa23f00`  | `pnpm quality:generated-dto-strictness`                                             |
| 2.4 / P1-8       | codegen 覆盖 72%→100%                      | ✅   | `9fa23f00`      | `pnpm quality:manager-codegen`                                                      |
| 2.5 / P1-9       | 关键模块清单双份 + 绝对路径恒红            | ✅   | `b031f2cbe`     | `node scripts/quality/check-critical-coverage.mjs coverage/lcov.info`               |
| 2.5/2.6 负向测试 | 关键覆盖率门禁自测                         | ✅   | `a46446607`     | `npx vitest run spec/unit/critical-coverage-gate.spec.ts`                           |
| 2.7              | JSDoc 假绿负向测试                         | ✅   | `b031f2cbe`     | `npx vitest run spec/unit/check-public-jsdoc-examples.spec.ts`                      |
| 2.8 / 新发现 B   | real-backend 类型门禁（continue-on-error） | ✅   | SDK `e1bdcad67` | `pnpm quality:real-backend-types`                                                   |
| 2.6              | 全局 vitest 阈值 70/70/60/70               | ✅   | `f68e05cd9`     | `npx vitest --run --coverage`                                                       |

## 阶段 3 · 网络语义与资源治理

| 编号 | 问题                                                                      | 状态           | 关闭 commit                                         | 验收命令                                                               |
| ---- | ------------------------------------------------------------------------- | -------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| G1   | `TimeoutError.isRetryable` 声明 true 但 `withRetry` 不认                  | ✅             | `e28ee98cd`                                         | `npx vitest run spec/unit/managers/base-manager.spec.ts`（决策表用例） |
| G2   | `computeRetryDelay` 仅在限流读 `Retry-After`，5xx 带 `Retry-After` 被无视 | ✅             | `e28ee98cd`                                         | 同上                                                                   |
| P3-2 | WebRTC 定时器 31/19 疑似泄漏（P2-11）                                     | ✅（误报作废） | 有门禁 `quality:timer-pairing`；人工复核无真泄漏    | `pnpm quality:timer-pairing`                                           |
| P3-4 | `console.*` 69 处绕过 logger（P2-10）                                     | ❌ 误报作废    | 非注释命中 3 处且全合法；`no-console: error` 已生效 | `npx eslint src`                                                       |

## 阶段 4 · 治理与文档防腐

| 编号     | 问题                                        | 状态    | 关闭 commit                                                   | 验收命令                             |
| -------- | ------------------------------------------- | ------- | ------------------------------------------------------------- | ------------------------------------ |
| 4.1      | 建 `ISSUE_LEDGER.md`（本文件）              | ✅      | 本轮提交                                                      | `test -f docs/audit/ISSUE_LEDGER.md` |
| 4.1 附带 | 标注 `matrix-js-sdk-审核报告.md` 为历史版本 | ❌ 无需 | 该文件**不在本仓库**（`git ls-files` 为空，find 亦无）        | `git ls-files "*审核*"`              |
| 4.4      | 依赖审计归零 + 门禁卫生                     | ✅      | SDK 见 `SUPPLY_CHAIN_AND_GATE_HYGIENE_2026-09-13.md` 对应批次 | `pnpm audit`                         |
| 4.3      | 性能基线刷新（每月 + perf:compare）         | ✅      | `f68e05cd9`（baseline-2026-09-14）                            | `pnpm perf:baseline`                 |

## 三轮复核新增（schema 门禁盲区）

| 编号 | 问题                                                            | 状态 | 关闭 commit                                                                  | 验收命令                                        |
| ---- | --------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| P0-5 | 跨仓 pin 不校验 `ledger_schema`（pin=1 vs SDK/后端=4 静默漂移） | ✅   | SDK `d9f8ed5ac`（门禁三连）；Tjg 外部仓库 `411a5aa5`（pin 刷新，非本仓可查） | `node scripts/quality/check-cross-repo-pin.mjs` |

---

## 仍在账面的卫生项（未关闭，如实登记）

| 编号  | 问题                                                        | 状态        | 下一步                  |
| ----- | ----------------------------------------------------------- | ----------- | ----------------------- |
| P3-19 | 58 条 eslint `no-explicit-any` warning                      | ⏳ 待决策   | 不阻断，按需            |
| P3-20 | `client.ts` 4052 行巨型文件                                 | 🟡 已改善   | 持续按复杂度/回归率口径 |
| P3-21 | Prettier 对内存敏感（脚本写死 `--max-old-space-size=8192`） | ⏳ 现状接受 | —                       |

---

## 维护规则

1. 新增「已完成」条目必须带可 `git show` 的 commit；外部仓库 hash 须标注「非本仓可查」。
2. 「进行中」/「待决策」条目每轮复核时更新状态，超过两个迭代未推进升级为风险。
3. 误报作废的条目保留 ❌ 行并注明原因，防止再次被当缺陷提出来。
