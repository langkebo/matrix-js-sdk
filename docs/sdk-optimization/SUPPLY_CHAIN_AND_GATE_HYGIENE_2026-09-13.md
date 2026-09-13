# SDK 供应链审计与门禁卫生（2026-09-13 批次）

本批次主题：**依赖安全可见性** 与 **质量门禁的“假绿/僵尸基线”**。全部结论都有可复现命令与原始输出。
本批次只改 `matrix-js-sdk`，未触碰 `synapse-rust` 代码；后端事项在第 6 节只列不改。

---

## 0. 结论摘要

| #   | 结论                                                                                                                                                                    | 严重度 | 状态                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- |
| S-1 | 全量依赖审计曾有 **19 条 high**（全是 dev 工具链的传递依赖，均有补丁版），而 `release.yml` 的 `pnpm audit --audit-level=high` 一直在跑全量口径 → **发布门禁实际是红的** | 高     | ✅ 已清零               |
| S-2 | 质量报告安全段是**假红**：`❌ Vulnerabilities found` 却把所有计数显示成 0 —— `pnpm audit` 非零退出时 stdout 被 `runCommand()` 丢弃                                      | 中     | ✅ 已修                 |
| S-3 | `audit:high` 是 `--prod` 口径，**dev 依赖的高危在 PR 级 CI 完全不可见**；新增 PR 级 `dependency_audit` job 跑与 release 同一条全量命令                                  | 中     | ✅ 已修                 |
| S-4 | `swallow-fallback-baseline.json` 52 条里 **31 条已 stale（60%）**，真正生效的是源码里的 `@swallow-error` 注释；基线是僵尸记录，且 stale 只告警不阻断                    | 中     | ✅ 刷新 + stale 转红    |
| S-5 | `synapse-ledger-sync.yaml` 仍列已退役的 `openclaw` profile，与后端导出器/`contract-sync.mjs` 三方不一致 → 每次交接都误判“有语义变化”                                    | 低     | ✅ 已修 + 新增门禁 spec |
| S-6 | **自我纠错**：`synapse-ledger-export` 交接**两端都在**（后端 `ledger-export.yml:80` 派发、SDK `synapse-ledger-sync.yaml` 接收）；此前“无人监听/两头都断”的判断是错的    | —      | 已纠正                  |
| S-7 | **自我纠错**：后端 SDK fixture 车道与 SDK 镜像**已零差集**（后端 `e70ce0f2` 重生成到 schema 2），此前“87 条 SDK 独有/车道陈旧”属 **feature 车道混用**造成的误判         | —      | 已纠正                  |

---

## 1. S-1：19 条 high 的逐条处置

审计命令（全量口径，含 dev）：

```bash
cd matrix-js-sdk && pnpm audit --json
# 处置前 metadata.vulnerabilities = {"info":0,"low":2,"moderate":8,"high":19,"critical":0}
```

| 包                            | 条数 | 漏洞范围                     | 补丁版本       | 处置                                                                                |
| ----------------------------- | ---- | ---------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `brace-expansion`             | 6    | `<1.1.18` / `>=4.0.0 <5.0.9` | 1.1.18 / 5.0.9 | `pnpm.overrides`（**按版本区间**分别钉，避免 1.x 与 5.x 互相污染）                  |
| `js-yaml`                     | 3    | `>=4.0.0 <4.3.2`             | 4.3.2          | `pnpm.overrides`                                                                    |
| `nanoid`                      | 2    | `<3.3.18`                    | 3.3.18         | `pnpm.overrides`（`vitest>vite>postcss>nanoid`）                                    |
| `browserslist`                | 2    | `<=4.28.6`                   | 4.28.7         | `pnpm.overrides`                                                                    |
| `linkify-it`                  | 2    | `<=5.0.1`                    | 5.0.2          | 经 `markdown-it` override 到 14.3.2 带上                                            |
| `vite`                        | 1    | `>=7.0.0 <=7.3.4`            | 7.3.5          | **显式进 `devDependencies`（`^7.3.5`）**，见下方坑位                                |
| `postcss`                     | 1    | `<=8.5.22`                   | 8.5.23         | `pnpm.overrides` → 8.5.28                                                           |
| `smol-toml`                   | 1    | `<=1.7.0`                    | 1.7.1          | `pnpm.overrides`（`knip`）                                                          |
| `ws`                          | 1    | `>=8.0.0 <8.21.0`            | 8.21.0         | `pnpm.overrides`（`happy-dom`）                                                     |
| `esbuild`（low）              | 1    | `>=0.27.3 <0.28.1`           | 0.28.1         | `pnpm.overrides` —— 先核对 `vite@7.3.6` 声明 `^0.27.0 \|\| ^0.28.0`，落在支持区间内 |
| `fflate`（唯一 runtime 中危） | 1    | `>=0.8.0 <0.8.3`             | 0.8.3          | **直接依赖** `dependencies.fflate` `^0.8.2` → `^0.8.3`                              |

**坑位（值得写进经验）**：`vite` 是 `vitest` 的 **peer dependency**，`pnpm.overrides` 对 peer **不生效** —— 实测 override 已写进 `pnpm-lock.yaml`（`vite@>=7.0.0 <=7.3.4: 7.3.5`）但安装结果仍是 `vite@7.3.2`。必须把它提升为直接 `devDependency` 才能约束版本。同理 `@vitest/mocker` 只需随 `vitest` 升到 `^4.1.11` 即可（同版本号同步）。

处置后：

```bash
pnpm audit
# No known vulnerabilities found          # 全严重级（low 起）+ 全 scope
pnpm audit --prod --audit-level=high       # exit 0
```

链路复验（依赖升级不是零风险，必须回归）：

```bash
CI=true pnpm test
# Test Files  376 passed (376)
#      Tests  5623 passed (5623)
```

---

## 2. S-2：质量报告安全段假红（根因与修法）

**现象**：`docs/governance/quality-reports/quality-report-2026-09-13.md` 的安全段

```
| Severity | Count |
| Critical | 0 |
| High     | 0 |
...
**Status**: ❌ Vulnerabilities found
```

计数全 0 却判红 —— 既掩盖了 19 条 high，也让人无法从报告里知道到底有什么问题。

**根因（实测）**：

```bash
pnpm audit --audit-level=high --json   # exit 1，metadata.vulnerabilities.high = 19
pnpm audit --prod --audit-level=high --json  # exit 0，{"moderate":1}
```

`pnpm audit` **只要命中就非零退出**，而 `scripts/quality-report.mjs` 的 `runCommand()` 在非零退出时 `return null`，于是“最需要报告的那一刻”恰好把 payload 丢掉，落到 `{ error: "pnpm audit failed" }`，markdown 渲染用的是 `report.metrics.security?.vulnerabilities?.critical || 0` → 全 0 + ❌。

**修法**：

1. 新增 `runCommandCapture()`：非零退出也保留 `stdout`。
2. 新增 `summariseAuditPayload()`：按 `advisories` 归类计数，并保留 high/critical 的明细（包名、漏洞范围、补丁版本、scope）。
3. 报告改为**双口径**（runtime `--prod` / 全 scope）+ 明细表；状态由计数推导：
   `passed = all.high === 0 && all.critical === 0`。
4. 反向修一个我自己引入的小错：一开始想从全量 payload 的 `findings[].dev` 推导 runtime 口径，实测 **pnpm 的 advisory payload 里没有 `dev` 字段**，于是把 7 条 dev 工具链问题全算成 runtime（真实 `--prod` 只有 1 条）。现在 runtime 口径由独立的 `pnpm audit --prod --json` 得出，不再靠推导。

---

## 3. S-3：审计脚本语义收敛

| 脚本         | 之前                                   | 现在                                   | 说明                                      |
| ------------ | -------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `audit:high` | `pnpm audit --prod --audit-level=high` | `pnpm audit --audit-level=high`        | 与 `release.yml` 同一条全量命令，消除盲区 |
| `audit:prod` | （无）                                 | `pnpm audit --prod --audit-level=high` | 保留 runtime 单口径，供快速自查           |
| `audit:all`  | `pnpm audit --audit-level=high`        | `pnpm audit`                           | 名副其实：全 scope + 全严重级             |

并新增 PR 级 CI job（`.github/workflows/static_analysis.yml` → `dependency_audit`），跑 `pnpm run audit:high`。
此前只有 `systemic_refactor_quality_gate.yml`（非 PR 触发）和 `release.yml` 跑审计，**PR 阶段没有任何依赖审计**；`release.yml` 又因 `continue-on-error` 之外的静默失败被忽略（见 S-1）。

---

## 4. S-4：swallow-fallbacks 的僵尸基线

门禁加了 matched/stale/new 计数后，第一次跑就暴露了真相：

```
[swallow-fallback] quality gate passed (current: 67, baseline: 52 [matched: 21, stale: 31], new: 46)
```

- 67 条现存吞错点，**全部**带合法（未过期、有 owner）的源码注释 —— 因为非严格模式下 “new 且无注释” 是**阻断项**，而它 exit 0。
- 52 条基线里 31 条（60%）已经匹配不上任何现存条目（id 含行号，代码一动就腐化）。
- 结论：真正生效的机制是**源码注释（owner + 到期日）**，基线既没在“特赦”任何东西，也没在“棘轮”任何东西。

**修法**：

1. `--update-baseline` 刷新到 67 条（0 stale、0 new）。
2. `stale` 从 **warn 改为 error**（与 `contract-drift-registry` / `timer-pairing-registry` 同款纪律：登记表必须与现状一一对应）。
3. 汇总行固定打印 `matched / stale / new`，让基线腐化第一时间可见。

**证明可红**（注入一个不存在的 id 后重跑）：

```
[swallow-fallback] quality gate failed:
- [STALE] src/__nonexistent__.ts:1: baseline entry no longer matches any finding. Retire it with `node scripts/quality/check-swallow-fallbacks.mjs --update-baseline` ...
# exit 1
```

> 设计取舍：id 是 `file:line:sha1(snippet)`，行漂移会同时表现为 `stale`（旧 id）+ `new`（新 id）。
> 没有改成 “file + snippet” 的模糊匹配 —— 那会让一个被改过的吞错点继承另一个点的特赦，
> 属于**用便利换掉不变量**。现在的代价是：站点被修掉或行号变动后需要一次显式 `--update-baseline`，
> 这正是我们想要的人工确认点。

---

## 5. S-5：`synapse-ledger-export` 的 profile 四方一致性

交接链路上有四个端点，各写各的 profile 列表：

| 端点              | 位置                                                                                      | 之前                  | 现在   |
| ----------------- | ----------------------------------------------------------------------------------------- | --------------------- | ------ |
| 后端导出器        | `synapse-rust/.github/workflows/ledger-export.yml`（`for profile in default worker all`） | default/worker/all    | 一致   |
| 后端 fixture 生成 | `synapse-rust/scripts/generate_sdk_ledger_fixtures.sh`                                    | default/worker/all    | 一致   |
| SDK 接收器        | `matrix-js-sdk/.github/workflows/synapse-ledger-sync.yaml`（`profiles = [...]`）          | **多一个 `openclaw`** | 已对齐 |
| SDK 消费者        | `matrix-js-sdk/scripts/contract-sync.mjs`（`PROFILES`）                                   | default/worker/all    | 一致   |

`openclaw` 是已退役 profile（backend 删除了该能力，SDK 也早已从 `PROFILES` 移除并加了 stale-profile 清理）。
残留在接收器里的后果：`semantic-diff` 比较 `route-manifest.openclaw.json` 时永远 “文件不存在 → 有变化”，
于是每次交接都白跑一轮同步 + 渲染 draft（不致命，但让“有没有真变化”这个信号失效）。

**新增门禁**：`spec/unit/ledger-sync-workflow-contract.spec.ts`（6 条用例）——
断言四个端点的 profile 列表一致、接收器监听的事件类型是 `synapse-ledger-export`、artifact 名与后端
`ledger-export-<sha>` 对齐、后端用 `--features all-extensions` 生成。
后端不在旁边时（SDK 单独检出）用 `it.skipIf` 跳过两条跨仓用例。

**证明可红**：把 `openclaw` 塞回接收器 → `expected [ 'default', 'worker', …(2) ] to deeply equal [ 'default', 'worker', 'all' ]`；
恢复后 6/6 通过。

---

## 6. S-6 / S-7：交叉核对与自我纠错（附证据）

本轮重新核对后端，推翻了我此前两个判断，记录以免污染后续决策：

### 6.1 交接不是断的，两端都在

- 后端派发：`synapse-rust/.github/workflows/ledger-export.yml:15` `SDK_REPOSITORY: langkebo/matrix-js-sdk`，
  `:78-81` `event_type: synapse-ledger-export`（`client_payload` 带 `source_sha` / `workflow_run_id` / `artifact_name`）。
- SDK 接收：`matrix-js-sdk/.github/workflows/synapse-ledger-sync.yaml` 的 `on.repository_dispatch.types: [synapse-ledger-export]`。
- 因此“没有任何 workflow 监听该事件 / 交接两头都断”的说法是**错的**，作废。

真实剩余风险（只列，不改后端）：

| 编号 | 风险                                                                                                                   | 证据                                                                                                    | 建议                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| R-1  | 派发依赖 `MATRIX_JS_SDK_DISPATCH_TOKEN`，未配置时**静默成功**（exit 0），且该 step 是 `continue-on-error: true`        | `ledger-export.yml:69-80`                                                                               | 未配置 token 时改成显式 `warning`/失败，或加一条“7 天内无成功派发则告警”的巡检               |
| R-2  | 后端 fixture 车道（`tests/unit/fixtures/ledger_export_sdk/`）**没有 CI 校验**，而它是 SDK `contract:sync` 的默认摄取源 | 在 `synapse-rust/.github/workflows/` 全量 grep `generate_sdk_ledger_fixtures\|ledger_export_sdk` 无命中 | 加一条 job：跑生成脚本后 `git diff --exit-code`，防止车道再次腐化（历史上它曾停在 schema 1） |

### 6.2 SDK fixture 车道与镜像已零差集

```
backend fixture 车道 / SDK 镜像（(method, path) 精确比对）
default: 1381 / 1381  only_backend=0  only_sdk=0
worker : 1392 / 1392  only_backend=0  only_sdk=0
all    : 1407 / 1407  only_backend=0  only_sdk=0
```

剔除 `generated_at` / `synapse_rust_commit` 后，三个 manifest **逐字节相同**
（199126 / 200774 / 202520 字节）。后端 `e70ce0f2` 已把该车道重生成到 schema 2，
`8414f54d` 又加了 schema 文档-代码版本守卫。

顺带澄清一个容易误判的点：`node scripts/contract-sync.mjs --check --source=../synapse-rust/tests/unit/fixtures/ledger_export_sdk`
会报 **54 个文件 drift**，但这是**元数据**差异（fixture 车道按固定 `commit=00000000` 生成，镜像是从 CI artifact 车道同步的、记录 `b562ac61`），
不是路由差异 —— 同一命令换 artifact 车道即通过。**不要据此判断“车道漂移”**。

此前“SDK 目录独有 87 条路由”的结论同样作废：那是把 **default 特性**的 golden 车道（1295/1306/1320）
与 **all-extensions** 的 SDK 车道（1381/1392/1407）混比的结果，两条车道按设计就不同
（`generate_sdk_ledger_fixtures.sh` 顶部注释已把这条约定固化）。

---

## 7. 验证命令清单（本批次全绿）

```bash
cd matrix-js-sdk
pnpm audit                              # No known vulnerabilities found（全 scope + 全严重级）
pnpm audit --prod --audit-level=high    # exit 0
pnpm install --frozen-lockfile          # lockfile 与 package.json 一致
CI=true pnpm test                       # 376 files / 5623 tests passed
node scripts/quality/check-swallow-fallbacks.mjs      # passed (current: 67, baseline: 67 [matched: 67, stale: 0], new: 0)
npx vitest run spec/unit/ledger-sync-workflow-contract.spec.ts   # 6 passed
node scripts/quality/check-contract-drift.mjs         # 6 模块 / SDK 多 11 条 / ledger 多 0 条，全部已登记
node scripts/contract-sync.mjs --check                # 以 generated/ 自身为源，通过
pnpm quality:report                     # 安全段双口径真实计数
```

> 归档文档（`docs/security/CVE_CLOSURE_TRACKER_2026Q2.md` 等）曾声称 `high=0, moderate=0`，
> 与本轮实测的 19 high / 8 moderate 矛盾 —— 那些“已清零”记录在当时就已失真（`--prod` 口径 + 报告假红）。
> 本文件以可复现命令为准。
