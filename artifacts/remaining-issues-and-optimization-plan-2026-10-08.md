# matrix-js-sdk 剩余问题复盘与优化方案（2026-10-08）

> 触发点：对 `develop @ e84016df8` 做一轮**不预设结论**的全量复检 —— 不读历史结论当真，每条都实跑取证。
> 结论先行：**`pnpm lint` 在当前 HEAD 上是红的**（两条独立原因），而它**不是新引入的代码缺陷**，
> 是「本地提交守卫从未生效 + 台账腐烂」的合成结果。其余 20 余个门禁全绿，Tjg 侧的
> `matrix-js-sdk/contract` 断链**已在今日 08:58 闭环**。
>
> 关联文档：`artifacts/quality-gate-fingerprint-audit-2026-10-06.md`（门禁指纹与治理主线）、
> `.workbuddy/memory/2026-10-08.md`（§33~35 逐轮记录）。

---

## 0. 结论速览

| 级别     | 问题                                                            | 一句话                                                                     | 是否阻断 CI            |
| -------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| **P0-1** | `pnpm lint` 红：prettier 报 7 个文件未格式化                    | 6 个代码文件 + 1 个审计文档                                                | **是**（拦所有 PR）    |
| **P0-2** | 同一链第二条红：`quality:coverage:critical-files` 台账腐烂 2 条 | 条目已失效，门禁要求删除                                                   | **是**（被 P0-1 短路） |
| **P0-3** | 本地提交钩子**从未安装**                                        | husky 靠 `prepare` 装，而 `prepare` 是 `pnpm build`                        | 根因                   |
| **P1-1** | 覆盖率/契约盲区                                                 | 139 未校验路径调用点 + 3 未覆盖包装器 + 无路由集合对账                     | 否（棘轮已钉住）       |
| **P1-2** | 契约语义不匹配 / 后端缺路由                                     | `invite/blocklist` 整体替换 vs 逐个增删；`deleteFeatureFlag` 后端无 DELETE | 否（已登记 waiver）    |
| **P1-3** | 豁免与基线纪律不一致                                            | baseline 更新无条件全量重写；swallow 白名单过期只 warn                     | 否（策略债）           |
| **P2**   | 长尾与工程卫生                                                  | 3 个聚合/生成脚本无 spec；2 个已登记孤岛；101 提交未推                     | 否                     |

**整体判断**：门禁体系本身已经相当成熟（56 个受管辖门禁、52 可达、4 豁免、0 死门禁；判定类门禁
普遍有 spec + 变异自证）。**剩余问题不在"缺门禁"，而在三件事**：
① 门禁的**执行入口**（本地钩子）是断的；② 门禁的**台账**会腐烂且没有自动发现机制；
③ 判据"看得见的范围"仍有边界（139 / 3 / 7 三类盲区）。

---

## 1. 核查范围与基线

| 项          | 值                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------- |
| 仓库        | `matrix-js-sdk`（fork `@langkebo/matrix-js-sdk@40.2.0-langkebo.5`）                         |
| 分支 / HEAD | `develop` / `e84016df8`（`fix(esm): 修复主入口在 ESM 下无法加载`）                          |
| 与远端      | `ahead 101` 于 `langkebo/develop`（**这 101 个提交从未在 CI 上跑过**）                      |
| 工作区起点  | 仅 `artifacts/quality-gate-fingerprint-audit-2026-10-06.md` 为 `M`（外部进程回写，见 §3.4） |
| 跨仓        | `../Tjg`（vendor tarball / node_modules / ESM 解析）                                        |

实跑内容：`pnpm lint`（全链）、`pnpm quality:contracts`（16 段全链）、20 个单门禁、
4 个守卫 spec（151 例）、跨仓解析探针。

---

## 2. 门禁实况（本轮实测，非引用历史）

### 2.1 绿

| 门禁                                                                                                                                                                                                                                                                                                                    | 结果                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `quality:contracts`（16 段：exports / entrypoints / contract-entrypoint / sdk-contracts / contract:check / codegen:check / freshness / manager-codegen / dto-strictness / jsdoc-examples / public-api-docs / docs-examples / path-contract / admin-response-contract / msc / waiver-expiry）                            | exit 0                                                        |
| `quality:gate-reachability`                                                                                                                                                                                                                                                                                             | exit 0（56 受管辖 / 52 可达 / 4 豁免 / 2 已登记孤岛）         |
| `quality:admin-response-contract`                                                                                                                                                                                                                                                                                       | exit 0（`entries=129`、`requestEntries=58`、`deviations=16`） |
| `quality:path-contract`                                                                                                                                                                                                                                                                                                 | exit 0（提取 539 / 匹配 519 / 豁免 20 / 不匹配 **0**）        |
| `quality:real-backend-types`、`quality:contract-drift`、`quality:no-default-key`、`quality:swallow-fallbacks`、`quality:debt-markers`、`quality:msc`、`quality:waiver-expiry`、`quality:docs-counts`、`quality:manager-extensions`、`quality:contract-provenance`、`quality:granular-coverage`、`quality:log-sensitive` | exit 0                                                        |
| 守卫 spec：`verify-path-contract-gate`(47) / `admin-response-contract`(73) / `contract-entrypoint-gate`(23) / `manager-accessor-wiring`(8)                                                                                                                                                                              | **151 passed**                                                |

### 2.2 红

| 门禁                              | 结果                    | 证据                   |
| --------------------------------- | ----------------------- | ---------------------- |
| `lint:js` → `prettier --check .`  | **exit 1**，7 个文件    | `LINT_EXIT=1`，见 §3.1 |
| `quality:coverage:critical-files` | **exit 1**，2 条 `[R4]` | 见 §3.2                |

> `pnpm lint` 的链序是 `lint:types → test:types → type-coverage → lint:js → … → coverage:critical-files → gate-reachability → manager-extensions`。
> `lint:js` 在 `prettier` 那一步就失败，`&&` 短路 ⇒ **P0-2 这条红平时根本走不到**，是单独跑才暴露的。

---

## 3. 问题清单（逐条给证据）

### 3.1 P0-1 `pnpm lint` 红：prettier 7 个文件未格式化

**现象**

```
$ pnpm lint
…
Checking formatting...
[warn] artifacts/quality-gate-fingerprint-audit-2026-10-06.md
[warn] scripts/quality/check-coverage-critical-files.d.mts
[warn] scripts/quality/check-exports-docs.mjs
[warn] spec/unit/coverage-critical-files-gate.spec.ts
[warn] spec/unit/exports-docs-gate.spec.ts
[warn] spec/unit/large-file-changes-gate.spec.ts
[warn] spec/unit/msc-changes-gate.spec.ts
[warn] Code style issues found in 7 files. Run Prettier with --write to fix.
LINT_EXIT=1
```

**证据（可复现）**

```bash
# 6 个代码文件都不在工作区改动里（git status 为空）⇒ 不合格的是 HEAD 的内容本身
git status --short scripts/quality/check-coverage-critical-files.d.mts \
  scripts/quality/check-exports-docs.mjs spec/unit/coverage-critical-files-gate.spec.ts \
  spec/unit/exports-docs-gate.spec.ts spec/unit/large-file-changes-gate.spec.ts \
  spec/unit/msc-changes-gate.spec.ts          # → 空
node ./node_modules/prettier/bin/prettier.cjs --check <上面 6 个>   # → exit 1
```

引入提交（全部 2026-10-07、**全部未推送到 origin**）：

| 文件                                                                                                    | 引入提交    |
| ------------------------------------------------------------------------------------------------------- | ----------- |
| `scripts/quality/check-coverage-critical-files.d.mts`、`spec/unit/coverage-critical-files-gate.spec.ts` | `16fa0fa49` |
| `scripts/quality/check-exports-docs.mjs`、`spec/unit/exports-docs-gate.spec.ts`                         | `de17b8692` |
| `spec/unit/large-file-changes-gate.spec.ts`                                                             | `4e619c158` |
| `spec/unit/msc-changes-gate.spec.ts`                                                                    | `13b5a4c50` |

第 7 个是审计文档：`prettier --write` 对它的改动集中在 **2445–2472 行起的手写 CJK 表格**
（prettier 重排表头分隔行），实测 `diff` 约 **223 行**。用 `git show HEAD:<doc>` 抽到仓内单独
`--check` 也是 exit 1 ⇒ **不是工作区改动造成的，HEAD 本身就不合格**。

**根因**：这三个都是"手写 markdown 表格 + CJK 内容"，prettier 的列宽算法与人工对齐不同；
而 `pnpm lint` 从未在本地跑过（见 §3.3）。

**影响**：CI `Systemic Refactor Quality Gate` 的 `Lint and Typecheck` 步骤必红 ⇒ 推上去会拦掉所有 PR。

### 3.2 P0-2 `quality:coverage:critical-files` 台账腐烂（2 条 R4）

**现象**

```
[coverage-critical] FAILED: 2 violation(s).
违规:
  [R4] room-creation/index.ts
        listed in ledger but now covered by a spec (or no longer has HTTP calls)
        -> 该条目已失效 —— 从 coverage-critical-ledger.json 中删除
  [R4] sessions/index.ts
        listed in ledger but now covered by a spec (or no longer has HTTP calls)
        -> 该条目已失效 —— 从 coverage-critical-ledger.json 中删除
```

**取证（两条都是"条目失效"，不是门禁误报）**

- `src/room-creation/index.ts`：已**不再有 HTTP 调用**，全文件只剩 `import type { ICreateRoomOpts }`。
  ⇒ 它不再是"带 HTTP 调用的未测文件"，不该占关键覆盖台账。
- `src/sessions/index.ts`：**文件已被整体删除** ——
  `159e46d2d refactor(sessions): 删除整个 SessionsManager —— Matrix 里没有 session 概念`。
  台账里那条（`module: sessions`、`lines: 86`、`httpCalls: 2`、`deadline 2026-12-31`）是幽灵条目。

**影响**：`quality:coverage:critical-files` 在 `lint` 链里 ⇒ 与 P0-1 一起构成 HEAD 的双红。
真正的缺陷是**「台账没有随代码删除而收缩」的机制缺失**，不是这两行本身。

### 3.3 P0-3 根因：本地提交钩子从未安装

**现象**：`.husky/pre-commit` 在版本库里（内容 `npx lint-staged`，`origin/develop` 也有），
但本地三处证据表明它**从未生效**：

```bash
ls .husky/_                    # → No such file or directory   （husky v9 的运行时目录）
git config core.hooksPath      # → 未设置
ls .git/hooks/pre-commit       # → 不存在
```

**根因**：husky v9 靠 `package.json` 的 `prepare` 脚本里那条 `husky` 命令来安装钩子。
本仓 `prepare` 是 `pnpm build`（`origin/develop` 同样是 `pnpm build`）⇒ **`husky` 命令永不执行**
⇒ 钩子永不安装 ⇒ `.lintstagedrc` 那套 `prettier --write` / `eslint --fix` 拦截在本地提交时压根没跑。

**这直接解释了 P0-1**：4 个 2026-10-07 的 spec 提交带着格式问题进来，且因为未被推送、CI 也没看过。

**附带发现**：`.lintstagedrc` 的三条 glob 是 `*.(ts|tsx)` / `*.(py|md|yaml)` / `*.(mjs|cjs|js)`，
**`*.(ts|tsx)` 不匹配 `.d.mts`** —— 这正是 P0-1 里唯一那个非 `.ts` / 非 `.mjs` 的漏网文件后缀。

### 3.4 P3 工作区脏：审计文档被外部进程回写

`artifacts/quality-gate-fingerprint-audit-2026-10-06.md`（mtime `2026-10-08 08:25`）相对 HEAD：

- 全量 `git diff`：**837 insertions / 994 deletions**；`--ignore-all-space` 后 **69 / 226**。
- 内容级差异**只有三类**：① 表格分隔行被按另一套列宽规则重排（绝大多数）；
  ② 行尾两空格被删（破坏 markdown 硬换行）；③ **3 处中文被 HTML 实体化**：
  `的`→`&#x7684;`、`报`→`&#x62A5;`、`是`→`&#x662F;`（出现在 `**粗体**` 紧邻位置）。
- **未丢章节**：`^## ` 计数 14 / 14，`7.15-1 … 7.15-31` 小节齐全。

⇒ 判定为**编辑器/预览器的回写**（不是 `git checkout`，也不像 prettier），内容无损失但有语义破坏
（硬换行、实体转义）。处置见 §5 批次 A3。

### 3.5 P1-1 判据盲区（"看不见"的三类）

| 盲区                                       | 量化                                                                                                                 | 性质                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quality:path-contract` 未校验路径调用点   | **139**（棘轮基线，只降不升）                                                                                        | 路径实参是局部变量 / 方法返回值：`authedRequest(path)`、`requestV3(this.roomPath(id))`、`doRequest(...)`                                                                                                             |
| `quality:path-contract` 未覆盖包装器       | **3**：`requestOtherUrl` / `rawJsonRequest` / `sendToDeviceRequest`                                                  | 路径位置上**完全不参与校验**（既不进分母也不进 `skipped`）                                                                                                                                                           |
| 域外命名空间                               | **7**                                                                                                                | identity server 等，结构性不属于本 ledger（合理豁免，但要可见）                                                                                                                                                      |
| `quality:admin-response-contract` 未解析桶 | `route-not-resolved=15`、`request-shape-unknown=1`、`backend-shape-unknown=1`、`inline-type-arg=3`、`array-return=1` | 桶本身有棘轮，但**没有逐条 reason**，只能看总数                                                                                                                                                                      |
| 嵌套形状                                   | 只比**顶层键**                                                                                                       | 响应/请求体的嵌套对象键集不核；`§7.15-29` 的 `get_all_health_status` 值级类型推断同样遗留                                                                                                                            |
| 路由集合对账                               | **无门禁**                                                                                                           | `PathAssert` 的占位段边界：实测 `bu("/zzz/not-a-route")` → TS2345 生效，而 `bu("/background_updates/coun")`（少一个 `t`）→ **exit 0 全绿**（契约里有 `{job_name}` 占位段）。若契约类型与 ledger 漂移，两边都看不出来 |

> 未校验调用点 `byFile` 里最大的一处是 `src/room-summary/sub-managers/room-event-operation-manager.ts`（38 处）。

### 3.6 P1-2 语义不匹配 / 后端缺路由（需产品决策）

- `POST /invite/blocklist`：后端语义是**整体替换** `{user_ids}`，SDK 却按"逐个增删"封装
  （已挂 `path-contract-waivers.json` 的 `semantic-mismatch`）；**方法名仍在鼓励错误用法**。
- `deleteFeatureFlag`：后端 `feature_flags.rs` 只有 `POST|GET` 与 `GET|PATCH`，**没有 DELETE**
  ⇒ 10-07 已改正为连字符路径 + 补 ⚠️ JSDoc + 登记 `backend-missing` 豁免（expires 2026-12-31）。
  本条保留为"后端补 DELETE 或删方法"的决策项。

### 3.7 P1-3 豁免与基线纪律不一致（P2 / P3 遗留，均**未修**）

- **基线更新粗放（旧编号 P2）**：`grep -rn 'accept-new|acceptNew' scripts/quality/*.mjs` **0 命中**。
  `swallow` / `generated-dto` / `technical-debt` / `real-backend-types` 四个 baseline 型门禁的
  `--update-baseline` 仍是**无条件全量重写**：既没有 diff 分类（drift / new / removed），
  也没有"只接受 N 条新增"，"重记行号"与"静默放行新缺陷"共用同一个动作。
- **到期纪律双标（旧编号 P3）**：`path-contract-waivers.json` 有硬阻断
  （`quality:waiver-expiry`，当前 20 条全部在期）；而 `swallow-fallback-baseline.json` 的
  `@swallow-error { owner, expires }` 白名单**过期只 warn**
  （`check-swallow-fallbacks.mjs:445`），且 `waiver-expiry` 只读 path-contract 那一份台账。
  当前实测：**过期 0 条 / 30 天内到期 0 条**（所以是策略缺口，不是当下的火）。

### 3.8 P2 长尾与工程卫生

- 门禁自身 spec：`scripts/quality` 共 **55** 个 `.mjs`，其中 **20** 个在 `spec/**` 文本里找不到文件名。
  逐类看：**17 个 granular** 已全部改成"调用共享库 `scripts/quality/lib/granular-coverage.mjs` +
  配置数据"的形态（`grep -c 'function hasMethod'` 逐文件 = **0**，`importShared=2`），
  而该共享库有 `spec/unit/granular-coverage-gate.spec.ts` ⇒ **风险已收敛**，属"配置型调用方"。
  真正待补的是 `generate-coverage-report.mjs`（纯报告生成，与判定无关，建议登记豁免）与
  `run-granular-coverage-gates.mjs`（聚合入口）。
- 孤岛脚本 **2** 个（`scripts/audit/compare-routes.mjs`、`scripts/update-doc-hashes.mjs`），均已登记。
- `quality:cross-repo-pin` 在 `develop` 上**按设计红**（仅 `release/**` 触发）。
- 两轨覆盖率门禁（`quality:coverage:repo` / `quality:coverage:critical`）依赖
  `pnpm test --coverage` 产出的 `coverage/lcov.info`；本地没跑过测试就只有"缺 lcov"这一条，
  是设计而非缺陷（CI 里排在 coverage 之后）。
- **101 个提交未推送** ⇒ P0-1 / P0-2 至今没被远程 CI 发现。

---

## 4. 已闭环（本轮核实，不要再做）

| 项                                | 结论       | 证据                                                                                                                                                                                                               |
| --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Tjg `matrix-js-sdk/contract` 断链 | **已闭环** | `Tjg/vendor/matrix-js-sdk.tgz` 于 **今日 08:58** 重建（4 460 079 B）；`exports` 53 项含 `./contract`；含 `package/lib/contract/index.js`；`Tjg/node_modules/matrix-js-sdk` 同步；`Tjg/src` 已无 `matrix-js-sdk/src | lib` 深度导入 |
| ESM 解析                          | **OK**     | `node --input-type=module -e "import.meta.resolve('matrix-js-sdk/contract')"` → 解析到 `lib/contract/index.js`                                                                                                     |
| granular 门禁 18 份副本           | **已修**   | 17 个 granular 全部 `import` 共享库，`hasMethod` 副本计数 = 0                                                                                                                                                      |
| 守卫 spec                         | **全绿**   | 151 passed（4 个文件）                                                                                                                                                                                             |
| `swallow` 白名单到期              | 当前无过期 | 过期 0 / 30 天内到期 0                                                                                                                                                                                             |

> ⚠️ **更正上一轮的一个误判**：我曾用 `require.resolve('matrix-js-sdk/contract')` 复现出
> `ERR_PACKAGE_PATH_NOT_EXPORTED` 并据此判"Tjg 解析不了"。实际原因是我用了 **CJS 入口**——
> 该包 `exports` 的每个条目**只声明 `import` / `types` 条件，没有 `require`**，而 Tjg 是 Vite/ESM。
> ESM 侧一切正常。**若将来出现 CJS 消费者**，需要给 `exports` 补 `require` 条件（见 §5 E4）。

---

## 5. 优化方案（按批次，每批可独立验收）

### 批次 A —— 恢复 lint 绿（P0，低风险，**建议立即做**）

| 步  | 动作                                                                                                                 | 验收                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A1  | `prettier --write` 那 6 个代码文件 + 审计文档                                                                        | `node ./node_modules/prettier/bin/prettier.cjs --check .` → **exit 0** |
| A2  | 删 `scripts/quality/coverage-critical-ledger.json` 里 `room-creation/index.ts` 与 `sessions/index.ts` 两条           | `pnpm quality:coverage:critical-files` → **exit 0**                    |
| A3  | 先把 §3.4 的外部回写文件**从 HEAD 恢复**（证据已备份），再做 A1 ⇒ 只留一个"prettier 规范化"的 hunk，不和回写混在一起 | `git diff --stat` 该文件只反映 prettier 重排                           |
| A4  | 全链回归：`pnpm lint` + `pnpm quality:contracts` 各跑一遍                                                            | 两条都 **exit 0**                                                      |

**注意**：A2 是**删除**条目，不是 `--update-baseline` 重记 —— R4 的语义是"条目已失效"，重记等于把幽灵留着。
**不要**为了 A1 把 `artifacts/` 加进 `.prettierignore`（那是把真问题藏起来；文档就该能被 prettier 重排）。

### 批次 B —— 把"提交前守卫"真正装上（P0 根因，低风险）

| 步  | 动作                                                                                                                           | 验收                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --- | ------- | ----------------------------------------------------------------- |
| B1  | `package.json`：`prepare` 改为 `husky && pnpm build`（husky v9 的命令就是 `husky`，不是 `husky install`）                      | `rm -rf .husky/_ && pnpm install` → `.husky/_` 生成、`git config core.hooksPath` = `.husky/_`     |
| B2  | `.lintstagedrc` 补 `.d.mts`（如 `"*.d.{ts,mts}": ["prettier --write"]`，或把第一条扩成 `\*.(ts                                 | tsx                                                                                               | mts | cts)`） | 造一个未格式化的 `.d.mts` 暂存 → 提交时被 `prettier --write` 修正 |
| B3  | 新增 `scripts/quality/check-git-hooks.mjs`（**本地自检**：`core.hooksPath` 未指向 `.husky/_` 就 warn；CI 上 `CI=true` 时跳过） | `pnpm quality:git-hooks` 在未装钩子时 exit 1                                                      |
| B4  | 变异自证                                                                                                                       | 故意造未格式化文件 → `git commit` **必须被拦**；删掉钩子后再提交 → 放行（证明拦的是钩子不是别的） |

**风险**：`prepare` 同时在 CI 的 `pnpm install` 里执行。husky 在无 `.git` 的浅克隆/打包环境里
会打印错误并**可能非零退出** ⇒ B1 实施时要用 `husky || true` 或 `husky` 的 `HUSKY=0` 保护，
并在 `systemic_refactor_quality_gate.yml` 的 `Install Deps` 步骤验证一次。

### 批次 C —— 收缩判据盲区（P1，中风险，**必须变异自证**）

| 步  | 动作                                                                                                                                                                                                                                                                      | 验收 / 判据                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `quality:path-contract` 的 **139** 处：把 `admin-contract.mjs` 的 `findLetBinding` / 链式解析手法**移植到 TS 侧**（局部变量追踪 + 有限的方法返回值推断，`MAX_RESOLVE_DEPTH` 同款，**fail-closed**），把 `authedRequest(path)` / `requestV3(this.roomPath(id))` 追到字面量 | `uncheckedPathArg` 显著下降且**棘轮收紧**（只降不升）；`byFile` 用 `--refresh-coverage` 显式接受新基线                                                                            |
| C2  | 3 个未覆盖包装器 `requestOtherUrl` / `rawJsonRequest` / `sendToDeviceRequest`：**要么纳入识别、要么显式登记**为"路径位置不校验"，**不许静默**                                                                                                                             | 报告新增一行"未覆盖包装器（路径位置不校验）: 3"，并进台账                                                                                                                         |
| C3  | 新增对账门禁 `quality:route-set-parity`：`src/**/__generated__/route-table.ts` 的路由集合 ↔ 后端 ledger（`ledger_export_sdk/all.json`）/ `route-manifest.all.json` 逐条对账，比对前抹掉命名空间段与版本段（`looseKey`）                                                   | 变异自证：在 route-table 里删一条 / 改一条 ⇒ 门禁红；占位段拼错（`/background_updates/coun`）⇒ **契约集合不变，故本门禁不覆盖**（在文档里写明它治的是"集合漂移"不是"占位段拼错"） |
| C4  | 嵌套形状：对 `entries` / `deviations` 里"顶层键集相等但值类型不同"的条目做一层**值级递归**（承接 §7.15-29 的 `get_all_health_status` 遗留）                                                                                                                               | 新覆盖桶计数只降不升；每个新解析器形态配一条 spec                                                                                                                                 |
| C5  | `route-not-resolved=15` 逐条定性：能解析的解析掉，不能的登记 waiver 并**写清 reason**（不允许只留一个数字）                                                                                                                                                               | `unresolved` 桶里每条都有 `reason` 字段；`deviations` 有 `expires`                                                                                                                |

**统一要求**：每个抽取器新形态都要走「**改坏输入必须变红**」——本仓抽取器累计错 24 次，
**24/24 全是"静默给错答案"**，没有一次是报错。

### 批次 D —— 统一豁免与基线纪律（P1/P2，中风险）

| 步         | 动作                                                                                                                                                                                                                       | 验收                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| D1（先做） | 把 `swallow-fallback-baseline.json` 的 `whitelist.expires` 纳入到期硬阻断：`quality:waiver-expiry` 扩成**多台账**门禁（path-contract + swallow + 其它带 `expires` 的白名单）                                               | 把某条 `expires` 改成昨天 ⇒ `pnpm quality:waiver-expiry` **exit 1**                     |
| D2         | 新建 `scripts/quality/lib/baseline-update.mjs`：给 4 个 baseline 型门禁的 `--update-baseline` 统一加审查门 —— 输出 diff 分类表（`drift` / `new` / `removed`），**默认拒绝新增项**，需 `--accept-new=<n>` 显式接受；配 spec | 变异自证：注入一条新吞错 ⇒ 带 `--update-baseline` 仍 exit 1，加 `--accept-new=1` 才放行 |
| D3         | 统一台账 schema：所有 waiver / baseline 白名单必须同时有 `owner` + `expires`，由同一个门禁扫描（缺字段即红）                                                                                                               | 删掉某条 `expires` ⇒ 门禁红                                                             |

### 批次 E —— 长尾与工程卫生（P2/P3，低风险）

| 步  | 动作                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | `run-granular-coverage-gates.mjs` 补"发现即跑"的 spec；`generate-coverage-report.mjs`（纯报告生成）按惯例**登记豁免**而非硬凑 spec   |
| E2  | 审计文档的 IDE 回写防护：`artifacts/**/*.md` 纳入提交前 `prettier --write`（B2 顺带覆盖）；若 IDE 仍回写，考虑把该目录移出预览白名单 |
| E3  | 推送 101 个提交（**先本地跑一遍 `pnpm lint && pnpm quality:contracts` 确认绿**，否则推上去直接红）                                   |
| E4  | 只有当真的出现 CJS 消费者时，才给 SDK `exports` 补 `require` 条件（当前 `./contract` 等仅 `import` / `types`）                       |

---

## 6. 执行顺序与依赖

```
批次 A（修红） ──► 批次 B（防复发） ──► 推送（E3）
        │                                   ▲
        └──► 批次 C（判据扩张） ──► 批次 D（纪律统一） ──┘
                                    批次 E（长尾，可并行）
```

| 批次 | 前置           | 风险                                         | 交付物                                            |
| ---- | -------------- | -------------------------------------------- | ------------------------------------------------- |
| A    | 无             | 极低（格式化 + 删 2 条死台账）               | lint / contracts 双绿                             |
| B    | A              | 低（动 `prepare`，需验 CI 的 install 步骤）  | 钩子生效 + `.d.mts` 被管 + 自检门禁               |
| C    | A（干净基线）  | 中（抽取器改动，**规则：改坏输入必须变红**） | 未校验 139 ↓、新门禁 `route-set-parity`、嵌套形状 |
| D    | C 的台账稳定后 | 中                                           | 多台账到期门禁、baseline 更新审查门               |
| E    | 任意           | 低                                           | 推送 + 长尾清账                                   |

**完成后统一验收**：`pnpm lint`、`pnpm quality:contracts`、`pnpm quality:gate-reachability`、
相关守卫 spec（`--no-file-parallelism`）全绿；`git status` 干净；台账数字只降不升。

---

## 7. 明确不建议做的事

| 不做                                                  | 为什么                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| 用 `--update-baseline` 刷掉 P0-2 的 2 条 R4           | R4 是"条目已失效"，正确动作是**删除**；重记等于把幽灵留在台账里             |
| 把 `artifacts/` 加进 `.prettierignore` 来让 lint 变绿 | 那是把真问题藏起来；审计文档能被 prettier 重排是**特性**                    |
| 直接推送 101 个提交                                   | 其中至少 4 个带着格式问题，推上去 CI 立刻红                                 |
| 给 17 个 granular 门禁逐个补 spec                     | 它们已是共享库的配置型调用方，共享库有 spec；重复补只是把同一个判据测 17 遍 |
| 把 3 个"未覆盖包装器"直接从报告里去掉                 | 「无法校验的调用点必须显式计数，不许静默消失」是本仓已确立的处置原则        |

---

## 附录 A：本轮核验命令

```bash
# ── P0-1 prettier ──────────────────────────────────────────────
pnpm lint > /tmp/lint.log 2>&1; echo "exit=$?"        # → 1
tail -12 /tmp/lint.log                                 # 看 [warn] 清单
node ./node_modules/prettier/bin/prettier.cjs --check scripts/quality/check-coverage-critical-files.d.mts \
  scripts/quality/check-exports-docs.mjs spec/unit/coverage-critical-files-gate.spec.ts \
  spec/unit/exports-docs-gate.spec.ts spec/unit/large-file-changes-gate.spec.ts \
  spec/unit/msc-changes-gate.spec.ts                   # → 6 files, exit 1
# 证明"HEAD 本身不合格"而非工作区污染：
git show HEAD:artifacts/quality-gate-fingerprint-audit-2026-10-06.md > ./__probe.md
node ./node_modules/prettier/bin/prettier.cjs --check ./__probe.md   # → exit 1
rm -f ./__probe.md

# ── P0-2 覆盖率台账 ────────────────────────────────────────────
pnpm quality:coverage:critical-files                   # → FAILED: 2 violation(s)  [R4] x2
sed -n '1,20p' src/room-creation/index.ts              # 只剩 import type
ls src/sessions/index.ts                               # → No such file（已删）

# ── P0-3 提交钩子 ──────────────────────────────────────────────
ls .husky/_                                            # → No such file or directory
git config core.hooksPath                              # → 空
ls .git/hooks/pre-commit                               # → 不存在
node -e "console.log(require('./package.json').scripts.prepare)"   # → pnpm build

# ── P1-1 盲区 ─────────────────────────────────────────────────
pnpm quality:path-contract                             # 未校验调用点 139 / 未覆盖包装器 3 / 域外 7
python3 -c "import json;print(json.load(open('scripts/quality/path-contract-coverage.json'))['byFile'])"
node scripts/quality/check-admin-response-contract.mjs # route-not-resolved=15 …
grep -rn 'accept-new' scripts/quality/*.mjs || echo "P2 未修：0 命中"

# ── 跨仓（Tjg）───────────────────────────────────────────────
cd ../Tjg && node --input-type=module -e "console.log(import.meta.resolve('matrix-js-sdk/contract'))"
tar -tzf vendor/matrix-js-sdk.tgz | grep 'lib/contract'

# ── 判定类改动的标准手法（批次 C/D 必须用）───────────────────
node scripts/audit/gate-golden.mjs capture <name> --script <npm-script>
node scripts/audit/gate-golden.mjs verify  <name>
node scripts/audit/gate-golden.mjs attrib  <npm-script>
```

## 附录 B：核验边界

- 本轮的"红/绿"全部是**实跑退出码**，未引用历史结论；历史文档仅用于对照"哪些是遗留项"。
- 未跑 `pnpm test --coverage` 全量（约 77 分钟），因此 `quality:coverage:repo` /
  `quality:coverage:critical` 未在本轮复测；本轮跑的是 4 个直接相关守卫 spec（151 例）。
- `route-not-resolved=15` / 未校验 139 的**逐条构成**未在本轮逐条展开（只取总数与 `byFile` 分布），
  批次 C 执行时再逐条打开源码定性。
- 101 个未推送提交的**内容**未逐提交审查，只核了与 P0 相关的 4 个。

---

**生成时间**: 2026-10-08
**基线**: `develop @ e84016df8`
**最后更新**: 2026-10-08（首版：全量复检 + 问题清单 + 批次 A~E 优化方案）
