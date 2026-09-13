# 阶段 3 排期与方案：网络语义与资源治理

> 排期日期：2026-09-13
> 依据：`matrix-js-sdk-成熟度实测复核-2026-09-13.md` §4 阶段 3、`matrix-js-sdk-审核报告.md` §4（L4 定义）/ ISSUE-10、`docs/governance/adr/ADR-0005-generated-dto-openness-policy.md` 后续工作
> 起始基线：SDK `a46446607` / 后端 `59d527f9` / Tjg `cbdbf3e8`
> 状态：**已排期，未开工**（每项开工前先补一条会红的测试）

本文件把阶段 3 拆成可独立验收的工作流，标注依赖、批次与验收命令。所有"现状"数字均为本机实测，
命令与文件行号随排期一并给出，便于开工时复核而不是重查。

---

## 0. 排期总览

| 工作流                    | 目标                                                | 依赖                           | 批次                              | 验收命令（必须 exit 0，且负向注入能红）                                       |
| ------------------------- | --------------------------------------------------- | ------------------------------ | --------------------------------- | ----------------------------------------------------------------------------- |
| P3-1 网络语义分层         | 重试决策可按「方法 × 错误 × 幂等性」解释            | 无                             | 批次 1 ✅                         | `pnpm test spec/unit/managers/`（新增决策表用例）+ `pnpm lint`                |
| P3-2 弱网设施（L4）       | 30% 丢包送达 ≥99.9% 无重复；断网恢复重连 ≤3s        | P3-1；重连项另依赖后端 A-1/A-2 | 批次 1 ✅（送达）/ 批次 3（重连） | `pnpm test:real-backend:l4`（新增）+ nightly                                  |
| P3-3 定时器配对与生命周期 | 每个 `setInterval` 都有配对清理与生命周期收口       | 无                             | 批次 2                            | `pnpm quality:timer-pairing`（新增）+ `pnpm test`                             |
| P3-4 `console.*` → logger | ——                                                  | ——                             | **作废**                          | 见 §4：实测为误报，`no-console: error` 早已生效                               |
| P3-5 `client.ts` 拆分     | 高风险子域出栈，回归面收窄                          | 无                             | 批次 2                            | `pnpm quality:entrypoints` + `pnpm test`（按 A1 口径：复杂度/回归，而非行数） |
| P2 遗留衔接               | ADR-0005 的 DTO-1/2/3；5 个「仅运行时调用」模块迁移 | ADR-0005 已 Accepted           | 批次 2                            | `pnpm quality:contracts` + `pnpm quality:generated-dto-strictness`            |

**批次划分（建议执行顺序）**

1. **批次 1 —— 语义与可观测 ✅（2026-09-13 完成）**：P3-1（SDK `e28ee98cd`，决策表 13 例先红后绿）→ P3-2 送达/去重用例（真机实测 8 条 / 60 条两档：SDK 内部重试 4 次 / 19 次消化全部断链，测试侧 0 次兜底，每条恰好一次）。
2. **批次 2 —— 资源与结构（进行中）**：P3-3 定时器配对 ✅ → DTO-1 key-backup 改形 ✅ → DTO-2 事件内容收敛 / codegen 消费迁移 → P3-5 `client.ts` 拆分。
3. **批次 3 —— 依赖后端的部分**：P3-2 的断网恢复重连 ≤3s（等后端 A-1/A-2 落地后开工）。

---

## 1. P3-1 网络语义分层

### 1.1 现状取证（已实现的部分）

| 行为                                            | 现状                                                         | 证据                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 429 / `M_LIMIT_EXCEEDED` 即便非幂等也可重试     | ✅ 已实现（S-8：限流是执行前拒绝，无副作用）                 | `src/managers/base-manager.ts:300-302`、`504-512`                                                                       |
| 5xx 默认**不**重试写请求                        | ✅ 已实现（`canRetry = idempotent \|\| retryNonIdempotent`） | `src/managers/base-manager.ts:294-304`                                                                                  |
| `Retry-After` 被尊重                            | 🟡 仅限限流错误                                              | `computeRetryDelay` → `src/managers/base-manager.ts:771-786`；`isRateLimitError()` 只认 429（`src/http-api/errors.ts`） |
| 写请求可显式开启重试                            | ✅ `retryNonIdempotent: true`                                | `src/managers/base-manager.ts:42-55、265-272`                                                                           |
| 发送路径的 `txnId` 在重试期间稳定               | ✅ `resolveTxnId` 在 `withRetry` **之前**解析一次            | `src/sending/index.ts:107-129`                                                                                          |
| 指数退避 + 可选 jitter                          | ✅                                                           | `src/managers/base-manager.ts:276-318`                                                                                  |
| 并发安全的重试深度计数（避免嵌套重试/重复计数） | ✅                                                           | `src/managers/base-manager.ts:145-171`                                                                                  |

### 1.2 缺口（实测，均为「声明与行为不一致」）

**G1 — `TimeoutError` 声明可重试，但重试器不认它。**

- `TimeoutError` 构造时传 `isRetryable: true`（`src/errors.ts:268-282`）；
- 但 `withRetry` 的判定是 `normalized instanceof RetryableError || (HTTPError && status >= 500)`
  （`src/managers/base-manager.ts:297-299`），**没有读 `isRetryable`**；
- 结论：幂等 GET 的超时**永不重试**，与"幂等请求应享受重试"的目标相反；非幂等超时不重试（这部分符合预期）。

**G2 — 非限流的 5xx 带 `Retry-After` 时被忽略。**

- `computeRetryDelay` 只在 `isRateLimitError()`（429 / `M_LIMIT_EXCEEDED`）时取 `retryAfter`
  （`src/managers/base-manager.ts:771-786`）；
- 503 会重试（`status >= 500` 且幂等），但退避用 SDK 自己的 `retryDelay × backoffMultiplier`，
  **无视服务端给的等待时间** → 服务端明确说"30 秒后再来"，SDK 1 秒后就重试。

### 1.3 任务拆解

| 任务 | 内容                                                                                                                                                                     | 验收                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| T1.1 | 决策表测试（**先写、先红**）：`方法（GET/POST/PUT/DELETE）× 错误（429/503/500/408/超时/网络中断/401/404）× 幂等性 × retryNonIdempotent` → 断言 retry/no-retry 与重试次数 | 新增用例；对 G1/G2 断言当前**错误**行为（红）                           |
| T1.2 | 修 G1：`isRetryableErr` 纳入 `normalized.isRetryable`，并明确 `TimeoutError.isUserCancelled()`（AbortController 主动取消）**不**重试                                     | T1.1 中幂等 GET 超时 → 重试；用户取消 → 不重试                          |
| T1.3 | 修 G2：`Retry-After` 对所有「可重试的 5xx」生效（`computeRetryDelay` 不再以 `isRateLimitError()` 为唯一入口），并保留 `x-ratelimit-after` / `x-retry-after-ms` 的解析    | T1.1 中 503 + `Retry-After: 30` → 退避 ≥30s（用假时钟断言，不真等）     |
| T1.4 | 写请求幂等键放开：对 `/send/{txnId}` 这类**天然幂等**的路由，允许按路由声明自动重试，而不是要求业务方逐个传 `retryNonIdempotent`                                         | T1.1 新增「PUT /send/{txnId} 5xx 默认重试」用例，并说明为何不是全局放开 |

### 1.4 明确不做

- 不对 5xx/超时的**非幂等且无幂等键**请求默认重试（会重复提交）。
- 不引入全局重试中间件（会绕过 `_retryObserved` 的重复提交保护，见 `base-manager.ts:160-171`）。

---

## 2. P3-2 弱网设施（L4 / toxiproxy）

### 2.1 现状

- **设施完全不存在**：三个仓库内 `toxiproxy` 仅出现在文档（`matrix-js-sdk-审核报告.md`、
  `docs/superpowers/plans/2026-08-10-l2-real-backend-spec.md` §1.2 的层级表），**0 处配置/脚本/CI**。
- L4 的目标指标（审核报告 §4）：

| 场景                               | 指标                          | 出处                    |
| ---------------------------------- | ----------------------------- | ----------------------- |
| 30% 丢包 + 200ms 抖动，1000 条消息 | 最终送达率 ≥99.9%，**无重复** | 审核报告 §4 / §1 性能表 |
| 断网 30s 后恢复                    | 重连 ≤3s                      | 同上                    |

### 2.2 任务拆解

| 任务 | 内容                                                                                                                                                                                                                              | 验收                                                                                                                                               | 状态      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| T2.1 | toxiproxy 服务加入集成 compose（SDK 侧 `weak-network/docker-compose.toxiproxy.yml`，挂后端 `synapse_network` 外部网络），暴露 8474（API）+ 8666（代理入口）                                                                       | `docker compose up -d` 后 `curl /proxies` 可用                                                                                                     | ✅        |
| T2.2 | `spec/integ/real-backend/weak-network/toxiproxy.ts`（`Toxiproxy` 类：`isAvailable` / `ensureProxy` / `addToxic` / `setEnabled` / `reset` / `withToxics`）+ `scripts/run-l4-weak-network.mjs`（把 baseUrl 指到代理并复用 CA 注入） | `spec/unit/toxiproxy-helper.spec.ts` 5 例（假控制面）：不可用→false、幂等重建、回调抛错也恢复链路、`setEnabled(false)` 真的落到控制面、非 2xx 抛错 | ✅        |
| T2.3 | spec A（送达 + 去重）：延迟 + 30% 连接重置 + 确定性断链窗口下发送 N 条，断言全部送达、每条只出现一次                                                                                                                              | `pnpm test:real-backend:l4` 真机跑通（见 2.4 实测）                                                                                                | ✅        |
| T2.4 | spec B（断网恢复）：切断代理 30s → 恢复 → 断言 `SYNCING` 并在 ≤3s 内回到 `SYNCED`                                                                                                                                                 | **依赖后端 A-1/A-2**（审核报告：后端多实例 30s 延迟未修）；未落地前该 spec 标记 skip 并注明原因                                                    | ⬜ 批次 3 |
| T2.5 | 挂 nightly：`.github/workflows/` 新增 nightly job（compose up → 起后端 → 跑 L4 spec）                                                                                                                                             | workflow lint 通过；nightly 手动触发可绿                                                                                                           | ⬜        |

### 2.3 实测发现的三个坑（都已写进代码注释与断言）

1. **toxiproxy 2.12 没有 `loss` toxic**。`type: "loss"` 与 `type: "toxicity"` 都返回
   `400 invalid toxic type`；可用类型实测为 `latency / reset_peer / slicer / timeout /
bandwidth / limit_data / slow_close`。所以"30% 丢包"用「约 30% 新连接被 RST + 200ms
   延迟 + 100ms 抖动」等价表达。
2. **`reset_peer` 是按连接生效的，不是按请求**。同样 toxicity 0.3：curl（每次新连接）
   连打 20 次失败 **5 次（25%）**；SDK（复用 keep-alive 连接）发 8 条**一次都没触发**。
   → 只靠 toxics 会让用例假绿。
3. **SDK 内部重试成功时，测试侧调用次数仍然是 1**。第一版用「测试侧首次尝试失败数」当
   扰动生效的证据，结果断链窗口明明触发了（日志有 `Retry attempt 1/3 ... ConnectionError`），
   该指标却仍是 0。→ 证据改成 `getSendingManager().getRequestStats().retried`（SDK 自己的
   重试计数），并把它作为**断言**：断链窗口存在时 `sdkRetries > 0`，否则用例红。

### 2.4 真机实测（2026-09-13，本机 Docker 后端 `matrix.test`）

| 场景                  | 断链窗口 | SDK 内部重试 | 测试侧兜底 | 送达  | 去重          |
| --------------------- | -------- | ------------ | ---------- | ----- | ------------- |
| `L4_MESSAGE_COUNT=8`  | 2        | 4            | 0          | 8/8   | 每条恰好 1 次 |
| `L4_MESSAGE_COUNT=60` | 15       | 19           | 0          | 60/60 | 每条恰好 1 次 |

即：真实网络中断由 SDK 自己的重试消化（测试侧一次都没兜底），且**没有产生重复事件** ——
这正是审计 §4 要的「最终送达 + 无重复」，也是 P3-1 幂等键与 ISSUE-03 稳定 txnId 的联合验证。

### 2.5 依赖与风险

- T2.3 与 P3-1 互为验证：L4 的"无重复"直接检验 T1.4 的幂等键放开。
- toxiproxy 面向的是 `matrix.test` 的自签证书环境，证书与代理端口要一起配（复用
  `run-real-backend-with-ca.mjs` 的信任注入，不要另起一套）。

---

## 3. P3-3 定时器配对与生命周期

### 3.1 现状实测（2026-09-13）

| 范围          | `setInterval` | `clearInterval` | `setTimeout` | `clearTimeout` | 合计 set / clear |
| ------------- | ------------- | --------------- | ------------ | -------------- | ---------------- |
| `src/web-rtc` | 9             | 6               | 22           | 13             | **31 / 19**      |
| 全 `src`      | 24            | 15              | ——           | ——             | ——               |

分文件（web-rtc）：

| 文件                                  | set | clear |
| ------------------------------------- | --- | ----- |
| `src/web-rtc/call.ts`                 | 15  | 9     |
| `src/web-rtc/groupCall.ts`            | 11  | 8     |
| `src/web-rtc/stats/groupCallStats.ts` | 3   | 1     |
| `src/web-rtc/callFeed.ts`             | 2   | 1     |

> 计数口径：`set*` 含 `setTimeout`。**不等配对不代表泄漏**（一次性定时器、`Promise.race` 超时、
> 已触发即失效的定时器都不需要 clear），所以本项的目标不是"数字相等"，而是**逐个给出处置结论**。

### 3.2 实施结果（2026-09-13）

**结论：审计当时没有真泄漏，但原因是"人工纪律"，不是机制。** 逐点核对结果：

| 站点类别                  | 处数 | 处置                                                                                                                                                                                                                            |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setInterval`（全 `src`） | 11   | 8 处同文件 `clearInterval`（`paired`），3 处由 `stopClientLifecycleServices` 跨文件清理（`owned`）                                                                                                                              |
| 存句柄的 `setTimeout`     | 30   | 全部 `paired`；其中 `sync.ts` 的 `this.keepAliveTimer`（3 处赋值）、`beacon.ts` 的 `this.livenessWatchTimeout`（2 处）、`EncryptionManager` 的 `keysEventUpdateTimeout`（2 处）复核确认"先清旧句柄"或"互斥分支"，没有覆盖式泄漏 |
| 丢弃句柄的 `setTimeout`   | 11   | 一次性语义，只统计不登记                                                                                                                                                                                                        |

`useKeyTimeout` 不在同文件直清，而是存进 `setNewKeyTimeouts` 集合、由 `stop()` 遍历
`clearTimeout`（`EncryptionManager.ts:180`）→ 登记为 `owned` + `clearCollection`。

新增门禁 `pnpm quality:timer-pairing`（已接入 `pnpm lint`）：
`scripts/quality/check-timer-pairing.mjs` + `scripts/quality/timer-pairing-registry.json`
（41 条：36 paired + 5 owned + 0 waived）。它不只查"登记没登记"，还会**去 grep 清理语句**：
`paired` 说同文件有清理就必须真有，`owned` 说别处清理就必须在指定文件里找得到，`waived`
必须有 reason + 未过期 expires；登记表里已失效的条目同样红。判定对
`globalThis.clearTimeout(...)`、`clearTimeout(x as NodeJS.Timeout)` 等写法都做了归一化
（这些是实测踩到的误判），并把 `public setInterval(` 这类**方法声明**排除在站点之外。

T3.3 生命周期收口用例 `spec/unit/client-lifecycle-teardown.spec.ts` 5 例：两个客户端级
interval 都被清掉、`clientWellKnownIntervalID` 未设置时不会 `clearInterval(undefined)`、
单个 Room / manager 抛错不中断其余清理、连续停止两次幂等。

> 能力边界（写清楚）：静态门禁只能证明"清理语句存在"，证明不了"清理路径一定被走到"；
> 后者由 T3.3 的用例兜住。两者都不覆盖"定时器回调里再建定时器"这类动态增长。

### 3.3 任务拆解

| 任务 | 内容                                                                                                                                                                                 | 验收                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| T3.1 | 新增 `scripts/quality/check-timer-pairing.mjs`：静态列出每处 `setInterval`/`setTimeout`，标注是否有同文件 clear、是否登记在豁免表（含 reason + 到期日，与 codegen 覆盖门禁同款机制） | `pnpm quality:timer-pairing` 输出逐点清单；新增未登记定时器 → 红             |
| T3.2 | 逐点处置：能配对的补 `clearInterval`/`clearTimeout`；属于一次性/已触发语义的登记豁免并写理由                                                                                         | 清单里每点都有结论；`call.ts`/`groupCall.ts` 的 `setInterval` 全部配对或豁免 |
| T3.3 | 生命周期收口测试：`stopClient` / `stopClientLifecycleServices` 后断言无活跃 interval（用 `vi.useFakeTimers()` + spy 计数）                                                           | 新用例；漏掉一个清理即红                                                     |
| T3.4 | `stopClientLifecycleServices` 覆盖到所有 manager 的 `setInterval`（当前覆盖清单待审计）                                                                                              | 覆盖清单与 T3.1 清单一致                                                     |

---

## 4. P3-4 `console.*` → logger：**作废（实测为误报）**

复核报告原文的"69 处裸 `console.*`"不成立：非注释命中只有 3 处，且全是既有已豁免的合法用法
（`src/logger.ts` 的 logger 实现、`browser-index.ts:40` 启动告警、`code-gen/generateApis.ts` 里的生成字符串），
`eslint` 早已对 `src/**/*.ts` 配置 `no-console: "error"`（用探针文件实测生效）。
原始数字是把 JSDoc 里的示例代码也算进去了。

**处置**：本项不排期。若后续需要，只做一件事——把 `console` 在全仓的 grep 结果与 ESLint 规则
对齐成一条 `pnpm quality:no-console` 门禁（当前 `no-console: error` 已在 lint 链里，无需重复）。

---

## 5. P3-5 `client.ts` 拆分

- 现状：`src/client.ts` **4129 行**（复核报告时 4075 行，仍在增长）。
- A1 的验收口径已修订（见 `docs/governance/P0_RISK_CLOSURE_PLAN.md`）：以**复杂度下降 + 回归率下降**
  为准，而不是单纯砍行数。

| 任务 | 内容                                                                                                                | 验收                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| T5.1 | 先量化：按方法簇统计 `client.ts` 的职责分布，选出 3 个高风险子域（建议：同步编排 / 房间状态发送 / legacy 兼容分支） | 产出一份「子域 → 方法 → 目标模块」清单                            |
| T5.2 | 逐子域搬出（mixin/委托，保持公开 API 与调用点不变），每个子域单独 PR                                                | `pnpm quality:entrypoints` + 全量 `pnpm test` 绿；公开 API 无变化 |
| T5.3 | 收口：`client.ts` 只保留编排与转发；目标 <2000 行仅作为参考指标                                                     | `pnpm test` 与 A1 复测通过                                        |

---

## 6. 与阶段 2 遗留的衔接

### 6.1 ADR-0005 的 DTO 改形（DTO-1/2/3）

已作为决策记录在 `docs/governance/adr/ADR-0005-generated-dto-openness-policy.md`。要点：
**开放性保留，但形式从 `Named | Record<string, unknown>` 改为索引签名接口**（实测该并集既丢具名类型
又拒绝未知键，是两处都亏的写法），并把事件内容统一到 `IContent` 风格。

| 任务  | 内容                                                                                                                                                                                                                                | 验收                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTO-1 | ✅ `key-backup` 改形完成：`EncryptedData`/`AuthData` 各加 `[key: string]: unknown`，去掉 7 处 `X \| Record<string, unknown>` 并集。**修正**：codegen 模板无需改动 —— 契约文档里的 ```typescript 块才是 DTO 来源，索引签名原样透传   | `pnpm contract:codegen:check`（47 modules in sync）+ `tsc --noEmit` 绿；`spec/unit/key-backup-dto-openness.spec.ts` 5 例（含 `@ts-expect-error` 反面断言） |
| DTO-2 | 事件内容收敛到 `IContent` 风格（sliding-sync 5 处 + `ephemeral`/`sync`/`room` 的 `Record<string, unknown>`）                                                                                                                        | 同一概念不再有三种写法                                                                                                                                     |
| DTO-3 | ✅ 基线随改形下降：**109 → 97**（record-unknown 47→40、bare-unknown 62→57）                                                                                                                                                         | 基线条数 = 实际命中条数                                                                                                                                    |
| DTO-4 | ⬜ 新发现：手写公开类型同病 —— `src/crypto-api/keybackup.ts` 的 `auth_data: ISigned & (Curve25519AuthData \| Aes256AuthData)` 也让具名键不可直取（`rust-crypto/*` 遍地 `as Curve25519AuthData`）。属公开 API + 影响 Tjg，需单独评估 | 具名键可直接访问；`as` 断言下降                                                                                                                            |

### 6.2 codegen 覆盖门禁的「弱证据」模块

`pnpm quality:manager-codegen` 现在把覆盖证据分两层输出（实测）：

- **强证据（33）**：模块目录内有文件 import 了本模块的 `__generated__/route-table`。
- **弱证据（5）**：`account_data`、`friend_room`、`search`、`sliding_sync`、`sync` —— 目录内只有
  HTTP 调用，没有 route-table 导入（可能通过共享 helper 消费，也可能压根没消费）。

| 任务 | 内容                                                                                                                                        | 验收                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| C-1  | 逐个判定这 5 个模块：真消费 → 改成显式 import 生成表（升为强证据）；不消费 → 移入 `SKIP_ROUTE_TABLE_MODULES` + 白名单（带 reason + 到期日） | 门禁输出里「弱证据」清单为空或每条都有结论 |
| C-2  | 把「弱证据数」接进质量报告（`pnpm quality:report`），避免"100% 覆盖"掩盖证据强度                                                            | 报告出现强/弱两栏                          |

---

## 7. 验收与门禁总表

| 命令                                                               | 覆盖                                       |
| ------------------------------------------------------------------ | ------------------------------------------ |
| `pnpm test`                                                        | 全量单测（新增决策表/定时器/类型断言用例） |
| `pnpm lint`（含 `quality:real-backend-types`）                     | 类型 + 新增静态门禁                        |
| `pnpm quality:manager-codegen`                                     | codegen 覆盖（强/弱证据 + 白名单到期）     |
| `pnpm quality:timer-pairing`（新增）                               | 定时器配对与豁免                           |
| `pnpm quality:contracts` / `pnpm quality:generated-dto-strictness` | 契约与 DTO 严格性                          |
| `pnpm test:real-backend:batch`                                     | L2 回归（P3-1 不得破坏现有语义）           |
| `pnpm test:real-backend:l4`（新增）                                | L4 弱网                                    |

## 8. 风险与回退

| 风险                          | 影响              | 缓解                                                                                        |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| 放开幂等重试导致重复提交      | 数据正确性        | 只对带幂等键的路由放开；保留 `_retryObserved` 的"已成功则不重试"保护；L4 的"无重复"用例把关 |
| 尊重 `Retry-After` 后单测变慢 | CI 时长           | 用假时钟断言退避值，不真等                                                                  |
| toxiproxy 与自签证书冲突      | L4 跑不起来       | 复用 CA 注入链；代理端口一并纳入信任测试                                                    |
| 后端 A-1/A-2 未修             | 重连 ≤3s 无法验收 | 该 spec 先 skip（写明原因），不写成"通过"                                                   |
| DTO 改形 diff 巨大            | 评审困难          | 按模块分批（DTO-1 只动 key-backup），生成物单独提交                                         |
