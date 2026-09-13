# 阶段 3 排期与方案：网络语义与资源治理

> 排期日期：2026-09-13
> 依据：`matrix-js-sdk-成熟度实测复核-2026-09-13.md` §4 阶段 3、`matrix-js-sdk-审核报告.md` §4（L4 定义）/ ISSUE-10、`docs/governance/adr/ADR-0005-generated-dto-openness-policy.md` 后续工作
> 起始基线：SDK `a46446607` / 后端 `59d527f9` / Tjg `cbdbf3e8`
> 状态：**已排期，未开工**（每项开工前先补一条会红的测试）

本文件把阶段 3 拆成可独立验收的工作流，标注依赖、批次与验收命令。所有"现状"数字均为本机实测，
命令与文件行号随排期一并给出，便于开工时复核而不是重查。

---

## 0. 排期总览

| 工作流                    | 目标                                                | 依赖                           | 批次                           | 验收命令（必须 exit 0，且负向注入能红）                                       |
| ------------------------- | --------------------------------------------------- | ------------------------------ | ------------------------------ | ----------------------------------------------------------------------------- |
| P3-1 网络语义分层         | 重试决策可按「方法 × 错误 × 幂等性」解释            | 无                             | 批次 1                         | `pnpm test spec/unit/managers/`（新增决策表用例）+ `pnpm lint`                |
| P3-2 弱网设施（L4）       | 30% 丢包送达 ≥99.9% 无重复；断网恢复重连 ≤3s        | P3-1；重连项另依赖后端 A-1/A-2 | 批次 1（送达）/ 批次 3（重连） | `pnpm test:real-backend:l4`（新增）+ nightly                                  |
| P3-3 定时器配对与生命周期 | 每个 `setInterval` 都有配对清理与生命周期收口       | 无                             | 批次 2                         | `pnpm quality:timer-pairing`（新增）+ `pnpm test`                             |
| P3-4 `console.*` → logger | ——                                                  | ——                             | **作废**                       | 见 §4：实测为误报，`no-console: error` 早已生效                               |
| P3-5 `client.ts` 拆分     | 高风险子域出栈，回归面收窄                          | 无                             | 批次 2                         | `pnpm quality:entrypoints` + `pnpm test`（按 A1 口径：复杂度/回归，而非行数） |
| P2 遗留衔接               | ADR-0005 的 DTO-1/2/3；5 个「仅运行时调用」模块迁移 | ADR-0005 已 Accepted           | 批次 2                         | `pnpm quality:contracts` + `pnpm quality:generated-dto-strictness`            |

**批次划分（建议执行顺序）**

1. **批次 1 —— 语义与可观测**：P3-1（含决策表测试）→ P3-2 的送达/去重用例（不含重连）。
2. **批次 2 —— 资源与结构**：P3-3 定时器配对 → P2 遗留衔接（DTO 改形 + codegen 消费迁移）→ P3-5 `client.ts` 拆分。
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

| 任务 | 内容                                                                                                                                                                                         | 验收                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T2.1 | toxiproxy 服务加入集成 compose（后端仓库侧或新增 `docker-compose.netem.yml`），暴露可控端口                                                                                                  | `docker compose up -d toxiproxy` 后 `curl /proxies` 有 proxy                                    |
| T2.2 | `spec/integ/real-backend/weak-network/` + helper：`withToxiproxy({ latency, jitter, loss })`，把 SDK 的 `baseUrl` 指向代理端口；复用现有 CA 注入链（`scripts/run-real-backend-with-ca.mjs`） | helper 单测（不依赖真后端）：代理开关幂等、异常时清理                                           |
| T2.3 | spec A（送达 + 去重）：30% 丢包 + 200ms 抖动下发送 N 条（CI 用 100 条，nightly 用 1000 条），断言全部送达且 `event_id` 无重复                                                                | 新 spec 在 nightly 跑；本地可设 `L4_MESSAGE_COUNT` 降规模                                       |
| T2.4 | spec B（断网恢复）：切断代理 30s → 恢复 → 断言 `SYNCING` 并在 ≤3s 内回到 `SYNCED`                                                                                                            | **依赖后端 A-1/A-2**（审核报告：后端多实例 30s 延迟未修）；未落地前该 spec 标记 skip 并注明原因 |
| T2.5 | 挂 nightly：`.github/workflows/` 新增 nightly job（compose up → 起后端 → 跑 L4 spec）                                                                                                        | workflow lint 通过；nightly 手动触发可绿                                                        |

### 2.3 依赖与风险

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

### 3.2 任务拆解

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

| 任务  | 内容                                                                                                         | 验收                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| DTO-1 | codegen 模板支持索引签名接口；先改 `key-backup`（7 处 `auth_data`/`session_data`）                           | `auth_data.public_key` 类型为 `string`；未知键可访问；`pnpm contract:codegen:check` 绿 |
| DTO-2 | 事件内容收敛到 `IContent` 风格（sliding-sync 5 处 + `ephemeral`/`sync`/`room` 的 `Record<string, unknown>`） | 同一概念不再有三种写法                                                                 |
| DTO-3 | 基线随改形下降并提交（禁止手工刷）                                                                           | 基线条数 = 实际命中条数（当前 109）                                                    |

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
