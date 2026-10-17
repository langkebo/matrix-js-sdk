# develop × release/contract-entrypoint 分支收敛：可行性分析与合并方案（2026-10-10）

> 对象仓库：`/Users/ljf/Desktop/hu_ts/matrix-js-sdk`（fork，包名 `@langkebo/matrix-js-sdk`）。
> 两条线：
>
> · `develop` — 迭代线，主工作树 `/Users/ljf/Desktop/hu_ts/matrix-js-sdk`，追踪 `langkebo/develop`；
> · `release/contract-entrypoint` — Tjg 消费的「干净契约线」，worktree `/Users/ljf/Desktop/hu_ts/.wt-sdk-clean`，**当前不在任何 remote**。
>
> 任务：评估「合并为单一维护分支」的可行性、给出合并方案、保障 Tjg 消费与 develop 迭代不受影响、输出执行步骤 / 验证清单 / 回滚预案。

---

## 0. 结论速览（TL;DR）

1. **两线不是「同一分支的落后副本」，而是刻意分离、且已在双向互抄的两条线**。`release` 相对 `develop` 的净效应是**大范围做减法**（删废弃/重复/死 codegen 面、私有端点迁 vendor 前缀）；`develop` 相对 `release` 的净效应是**继续迭代**（新功能 + 质量门禁 + 文档）。
2. **直接 `git merge` 不可行**：`src/` 下有 **156 个文件两侧都改过**，会产生大量文本冲突；更危险的是**语义冲突** —— `release` 删掉的 API，`develop` 可能仍在改进或使用。全量 merge 会把 `release` 的减法与 `develop` 的加法硬拼，结果既不是干净契约面、也不是完整 dev 面。
3. **推荐的终态不是「一次 merge」，而是「分阶段收敛」**：让 `develop` 保持唯一 trunk，把 `release` 线从「长期分叉分支」降级为**「按需生成的受控发布快照 + 版本标签」**。这样 develop 迭代零干扰、Tjg 改为 pin 发布标签、双线维护成本归零。详见 §4 方案 A。
4. **合并/收敛对 Tjg 的唯一硬影响是「重新打包 + 重钉 pin」**：`sdk_commit` / `tarball_sha256` / `sdk_lib_fingerprint`（可能还有 `sdk_version`）必须同步更新，`ledger_schema` 与跨仓镜像绑定必须保持成立。Tjg 消费的 **19 个 SDK 子路径在两条线上都存在**（exports 映射唯一的差异是 `./notifications`↔`./notification`，Tjg 未消费），因此**只要重钉流程走对，Tjg 侧无需改代码**。
5. **方向已裁决为方案 A，阶段 0（冻结与落定）已执行、阶段 1（分批裁剪）已闭环**：release worktree 的 83 条改动已落定为 `802781b4f`，并建立 `backup/pre-consolidation-*` 备份分支与基线记录；阶段 1 在 `develop` 上分批执行 release 收窄政策，batch1–5 已提交、batch6 为空批（净效应已收敛）。阶段 2 待触发。详见 §7 与 §11。

---

## 1. 事实基线

### 1.1 分支拓扑

| 项                                 | 值                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `develop` HEAD                     | `366542fb0`（领先 `langkebo/develop` 1 提交）                                                  |
| `release/contract-entrypoint` HEAD | `802781b4f`（`/Users/ljf/Desktop/hu_ts/.wt-sdk-clean`，阶段 0 落定后）                         |
| **merge-base**                     | `640cc444433a21d0e627c02628e04bfad12fb22b`                                                     |
| remotes                            | `gitee`、`langkebo`、`origin`(matrix-org 上游)；**release 线不在任何 remote**                  |
| 备份分支                           | `backup/pre-consolidation-develop`@`366542fb0`、`backup/pre-consolidation-release`@`9740e1ef2` |

### 1.2 提交历史

- `develop` 领先 merge-base **222 个提交**。
- `release/contract-entrypoint` 领先 merge-base **30 个提交**（阶段 0 落定 `802781b4f` 后）。

`release` 30 提交（节选，均为「减法/对齐」语义）：

```text
802781b4f chore(quality): 落定 F2/F4 门禁迁移与文档修订（合并收敛阶段 0）
9740e1ef2 fix(api)!: 从 develop 复刻 W-06 / W-05 收口（release 线）
a321796e2 fix(admin)!: 删除后端零注册的 3 组「预置未实现」成员
efa0512c1 feat(codegen)!: 死条目自动剪枝（清 cas 6 条陈旧相对路径）
574cde049 fix(api)!: 按后端 wire 契约修 11 处 SDK 缺陷（CAS/media/room-keys/…）
6040beb41 feat(admin,account)!: 移植 develop 的两组真缺口并修 quarantine 404
d51c56dda chore(contract)!: 跟随后端删 3 条重复别名（1030 → 1027）
901a80738 feat(contract): 聚合契约出口 matrix-js-sdk/contract（回移到 640cc444 基线）
308d8f815 refactor(space,dm)!: 删除 54 处 @deprecated 纯委托包装面（C5）
57445c615 refactor(widget)!: 删旧 WidgetsManager 整层 + 5 个空壳桩（C1）
4419f53d5 refactor(room-summary)!: 删除 invite 策略的重复实现（C2）
d64c886c0 refactor(verification)!: 删除 VerificationManager 重复实现（C3）
…（C6 系列：删假能力 / 删重复入口 / 删死后端面）
```

`develop` 222 提交（节选）显示：develop **同样在做契约对齐与质量门禁**，且**已把 release 的修复复刻过来**（`068fdaa3f`），release 也**已从 develop 复刻**（`9740e1ef2`）。

### 1.3 代码差异（shipped surface = `src/` + `package.json`）

- 全仓 `git diff develop release/contract-entrypoint`：**599 files changed, +13,796 / −77,294**（release 相对 develop 净删 7.7 万行）。
- 仅 `src/`：**162 files changed, +3,223 / −11,171**。
- 文件级归属：
    - **仅 develop 有（D）**：190 个文件；
    - **仅 release 有（A）**：16 个文件（多为 release 侧「类型拆分/新模块」产物，如 `src/space/sub-managers/*-types.ts`、`src/key-backup/types.ts`、`src/invite-blocklist/__generated__/*`、`src/ai/index.ts`、`src/sessions/index.ts`）。
- **两侧都修改过的 `src/` 文件：156 个** ← 这是冲突面。
- `package.json#exports` 唯一差异：`"./notifications"`（develop）↔ `"./notification"`（release）。**Tjg 未消费该路径**。其余 exports、scripts、依赖面基本一致（release 精简了 lint 链脚本与部分 devDeps 版本）。

`src/` 差异最大的目录（按变更文件数）：`src/admin`（20）、`src/space`（13）、`src/room-summary`（11）、`src/room`、`src/federation`、`src/manager-extensions`。

### 1.4 非 shipped surface 差异（不影响 Tjg 重打包判据）

`develop` 222 提交的改动分布（文件命中数）：

```text
docs/api-contract        882
scripts/quality          322
spec/unit                250
src/admin                 89
src/room-summary          49
spec/integ                48
artifacts/…plan….md       42
src/space                 36
src/room                  24
```

可见 develop 的增量**大头在文档与质量门禁**，真正进入 tarball 的 `src/` 增量有限 —— 这也符合 Tjg 侧「新鲜度判据只看 `src` + `package.json`」的设定。

### 1.5 `release` worktree 未提交改动（阶段 0 已落定）

`.wt-sdk-clean` 原有 **83 条未提交改动**（批次 F2/F4 已落地未提交），包括新增门禁脚本 `check-api-contract-doc-paths.mjs`、`check-cross-line-gate-parity.mjs`、`check-docs-counts.mjs`、`check-audit-doc-integrity.mjs`（含 `.d.mts` 声明），新增 `docs/guide/*`、`docs/MSC_SDK_MAPPING.md`，以及 `docs/api-contract/*.md` 修订、`package.json` 调整等。

> **阶段 0 处置（已完成）**：已提交为 `802781b4f`（`83 files changed, +10,842 / −283`），release HEAD 由 `9740e1ef2` 前移至 `802781b4f`。该提交仅前移分支 HEAD，**不改变 Tjg 已消费的 vendored tarball 产物**，因此对 Tjg pin 三角**无影响**。
>
> 影响：**任何后续分支合并/收敛动作前，必须先确认工作树干净**，否则合并/rebase 会与脏工作树冲突；这些改动本身也是 F5 门禁的前提。

---

## 2. 功能变更范围分析

### 2.1 `release` 线 = 减法线（干净契约线）

- **收缩公共面**：删 `@deprecated` 纯委托包装（C5 共 54 处）、删整层 `WidgetsManager`（C1）、删重复 `VerificationManager`/invite 策略实现（C2/C3）、删死后端面（C3′/C4）、删假能力（C6）。
- **私有端点迁 vendor 前缀**（ISSUE-13，78 条）：`/_matrix/client/{r0,v1,v3}` → `/_matrix/vendor/v1`。
- **契约镜像跟随**：跟随后端删除重复别名（1030 → 1027）、清死条目、codegen 自动剪枝。
- **聚合出口**：`matrix-js-sdk/contract`（Tjg 的 19 个子路径之一）。
- **wire 契约修复**：11 处（CAS/media/room-keys/device-keys/e2ee/oidc）。

### 2.2 `develop` 线 = 迭代线（功能 + 质量门禁）

- **质量门禁建设**（主体）：`api-contract-doc-paths`、`wire-format`、`cross-line-parity`（F5）、`url-constructors`（K）、`audit-doc-integrity`、`docs-counts`、`gate-reachability` 等。
- **契约对齐与缺口补齐**：DOC-12 收口（145 → 0 行）、admin/account 真缺口补齐（`d231f3b4c`）、W-01～W-07 系列收口。
- **审计文档**：`artifacts/remaining-issues-and-optimization-plan-2026-10-08.md`（42 次命中）等长期维护文档。

### 2.3 关键发现：两线已在双向互抄

```text
develop  068fdaa3f  fix(api)!: 把 release 线的 11 处 wire 修复复刻到 develop
release  9740e1ef2  fix(api)!: 从 develop 复刻 W-06 / W-05 收口（release 线）
```

结论：**两线的「功能正确性」已高度对齐**，剩余差异主要是**「公共面广度」**（release 收窄、develop 保留/扩张）。这意味着「合并」的技术难点不在功能语义，而在**采纳哪一套公共面政策**。

---

## 3. 可行性评估与风险

### 3.1 核心张力：两线分离 vs 合并

`release` 的存在价值是**减法**（一个比 develop 更小的、Tjg 依赖的公共面）；`develop` 的存在价值是**加法**（活跃迭代 + 完整历史）。「合并为单一分支」意味着取消这种不对称，那么单一分支必然要**选边**：

- 若选 **release 面**：develop 必须删掉它保留的大量面 → 违背「develop 迭代不受干扰」。
- 若选 **develop 面**：release 的减法被撤销 → Tjg 拿到的是「未裁剪面」，且 F5 差集门禁失去意义。

### 3.2 直接 `git merge` 会发生什么

- `src/` 下 **156 个两侧都改过的文件** → 大量文本冲突。
- `release` 独有的新增文件（16 个）与 `develop` 独有的新增文件（190 个）会**同时进入结果树** → 死 codegen 条目、被删模块可能**复活**。
- 删除语义（release 删、develop 未动）能自动传递，但**两侧都动过**的文件里，release 的删除会被 develop 的修改覆盖 → **减法失效**。
- 破坏 F5 `cross-line-parity` 门禁的前提（无差集可守），且 Tjg `verify-sdk-pin` 的 `git diff <sdk_commit>..HEAD -- src package.json` 新鲜度判据会因 HEAD 变化而失效/爆量。

### 3.3 风险清单（分级）

| 等级  | 风险                                        | 触发条件                                                  | 缓解                                                |
| ----- | ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| 🔴 高 | Tjg 拉不到能用产物                          | 合并后未重钉 pin / 未重打包                               | 严格执行 §6 重钉流程 + 本地跑 `verify:sdk-pin`      |
| 🔴 高 | 语义冲突导致运行期 404/类型错误             | 合并时误留 release 已删的私有端点 / 误删 develop 在用 API | 合并后跑全量门禁 + `test:real-backend`              |
| 🟠 中 | develop 迭代线被污染                        | 把 release 减法直接并入 develop                           | 采用 §4-A 分阶段收敛，而非一次 merge                |
| 🟠 中 | 死 codegen / 被删模块复活                   | merge 把 D/A 两侧文件都带进结果                           | 合并后跑 `contract:codegen:check` + 差异审阅        |
| 🟡 低 | F5 差集门禁失效                             | 两线合一后无差集                                          | 改用「tag vs develop」检查或退役该门禁              |
| 🟡 低 | `./notifications`↔`./notification` 出口二义 | 合并保留错的一侧                                          | 明确以 Tjg/文档约定的名字为准（Tjg 未消费，风险低） |

### 3.4 可行性结论

**「把两线一次 `git merge` 成一条」= 技术上可做、工程上不建议。**
可行且推荐的是 **分阶段收敛**：先在 `develop` 上执行 `release` 的「公共面裁剪政策」，逐步让两者面收敛；收敛到位后 `release` 自然退化为 `develop` 的一个标签。**终态是单线，过程不是合并。**

---

## 4. 方案选型

### 方案 A（推荐）：`develop` 单干 + `release` 降级为「受控发布快照」

- `develop` 保持唯一 trunk，所有迭代继续在 develop 发生。
- `release/contract-entrypoint` 不再作为长期分叉线；改为**按需从 develop 生成的发布快照**，通过一个**可复现的收敛补丁序列**把 develop 树裁剪为 Tjg 消费的干净面，产出一个快照提交并打标签（如 `v40.2.0-langkebo.N`）。
- Tjg 消费机制**不变**（仍是 vendored tarball + pin 三角闭合），只是 `sdk_commit` 指向**发布标签**而非分支 HEAD。
- F5 `cross-line-parity` 门禁的前提被替换为「快照 vs develop」的一致性检查。

优点：develop 迭代零干扰；无双线漂移；Tjg 消费路径不变。
成本：需要**把 release 线的裁剪净效应沉淀为可重复脚本/补丁序列**（主要工作量）。

### 方案 B：分阶段全量合并为单线

- Phase 0（立即，零风险）：冻结 `release` 新分叉提交；落定 83 条未提交改动；登记 F5 waiver 真因。
- Phase 1（中期）：在 `develop` 上分批执行 release 的裁剪政策（每批一个可验证的删除集），每批后 `release` 快照 = develop 的 tag。
- Phase 2（终态）：`develop` 为唯一 trunk；`release/contract-entrypoint` 退化为版本标签；F5 门禁退役或改为 `tag vs develop`。
- 仅当用户**要求尽快单线**时采用；风险集中在 Phase 1 的删除会触碰 develop 在用 API。

### 方案 C：维持双线 + 门禁对齐（现状）

- 即当前 F2/F4 正在做的事：不合并，只让两线门禁集合对齐、补 F5 差集守卫。
- 优点：风险最低、改动最小。缺点：不满足「单一维护分支」目标，双线漂移成本长期存在。

> **建议**：以 **A** 为目标形态、其 Phase 1 复用 **B** 的分批裁剪方法；**不采用** 一次性 `git merge`。

---

## 5. 合并/收敛方案详解

以下给出「若坚持一次合并」（5.1–5.3 亦适用于分阶段收敛的每一批）。

### 5.1 冲突解决策略

1. **先落定脏树**：`.wt-sdk-clean` 83 条未提交改动先 `commit`（或 `stash` 并记录），保证可回退。
2. **选定公共面政策**：明确「结果是 release 面还是 develop 面」。推荐**以 release 的裁剪政策为准，但逐一保留 develop 的功能增量**。
3. **`src/` 冲突（156 个）分类处理**：
    - 纯「删废弃面」类（C1/C2/C3/C5/C6）：**采纳 release（删除）**，随后在 develop 上确认无调用方（`knip`/`grep`）。
    - 「功能增量」类（新方法/新模块）：**采纳 develop（保留）**。
    - 交叉类（release 删了 A、develop 改进了 A）：**逐条人工裁决**——若 A 确是废弃面，则删并迁移调用方；否则保留 develop 版。
4. **`package.json`**：`./notifications` 与 `./notification` 二选一，以文档/README 约定为准并同步 `exports.md`。
5. **`__generated__/` 冲突**：**绝不用手解**。冲突后统一 `pnpm contract:sync && pnpm contract:codegen` 重生成。
6. **禁止「两侧独有新文件同时保留」**：合并结果里对 release 已删的死 codegen（如 `src/voice/__generated__`、`src/moderation/__generated__`）必须确认其确实该删，反之亦然。

### 5.2 功能兼容性验证要点

- 全量门禁：`pnpm lint`（19 步）**且** `pnpm quality:contracts`（含 `cross-line-parity`）。
- 契约一致性：`pnpm contract:check`、`pnpm contract:codegen:check` 必须绿。
- 编译与类型：`pnpm lint:types`、`pnpm test:types`。
- 单测/集成：`pnpm test`。
- 真后端：`pnpm test:real-backend`（尤其 device / verification / admin）。
- **Tjg 消费面**：19 个子路径逐一可 `import`（用 `src/services/matrix/sdk.ts` 的 re-export 做冒烟）。
- **端点前缀**：确认私有端点全在 `/_matrix/vendor/v1`（`check-vendor-prefix-migration.mjs`）。
- **能力探针 fail-closed**：`doesClientAdvertiseSynapseRustFeature` 对无路由特性仍传 `false`。

### 5.3 合并后分支维护规则

- `develop` = 唯一 trunk，所有开发提交只进 develop。
- 发布由 develop 打标签（`vX.Y.Z-langkebo.N`）驱动；不再新增长期分叉分支。
- 「干净契约面」的裁剪若必须保留为长期约束，则以**门禁 + 政策文档**表达（而非独立分支）。
- F5 差集门禁：改判为「发布标签 vs develop 的 `src` 差集」检查，或显式退役并记录裁定。
- 所有长期文档遵守 prettier 纪律（`artifacts/**/*.md` 受管）。

---

## 6. Tjg 消费兼容保障（pin 重钉全流程）

Tjg 当前 pin（`/Users/ljf/Desktop/hu_ts/Tjg/meta/sdk-pin.json`）：

```json
{
    "sdk_version": "40.2.0-langkebo.5",
    "sdk_commit": "9740e1ef292767ab01df908a9dcfb17065626a32",
    "sdk_mode": "tarball",
    "ledger_schema": "4",
    "synapse_rust_commit": "998d2ad2b08da8e852ffa97ed17d9c771a90c4ff",
    "tarball_sha256": "sha256-76b1c14c…",
    "sdk_lib_fingerprint": "sha256-ec8820ca…"
}
```

重钉三等式（必须同时成立）：

1. `pin.tarball_sha256` ↔ `vendor/matrix-js-sdk.tgz`；
2. `pin.sdk_lib_fingerprint` ↔ 安装后 `node_modules/@langkebo/matrix-js-sdk/lib` 指纹；
3. pack 时算的 lib 指纹 == tarball 内 lib 指纹。

重钉步骤（在**新线产物**上执行）：

```bash
# 1) 用新线 worktree 构建并打包（TJG_SDK_DIR 指向目标 worktree）
TJG_SDK_DIR=<目标 worktree> node /Users/ljf/Desktop/hu_ts/Tjg/scripts/pack-sdk-tarball.mjs --apply
# 2) 重写 pin 全字段（sdk_commit 取目标 worktree HEAD）
node /Users/ljf/Desktop/hu_ts/Tjg/scripts/refresh-sdk-pin.mjs
# 3) 本地校验（含 63-107 schema、109-123 ledger_schema 三方绑定、209-246 N-05 安装指纹、247-288 新鲜度）
cd /Users/ljf/Desktop/hu_ts/Tjg && pnpm verify:sdk-pin
```

硬门禁位置（必须绿）：`.github/workflows/sdk-check.yml:59-60` 与 `release-validation.yml:109-115`。

约束：

- `ledger_schema` 保持 `"4"`（后端 `LEDGER_SCHEMA_VERSION` 未变）；
- 跨仓镜像绑定：Tjg 的 `docs/api-contract/generated/index.json` 的 `synapse_rust_commit` 必须与 SDK 镜像一致；
- 新鲜度判据只看 `src` + `package.json`，故此二者若有跨线差异，**必须**触发重打包。

---

## 7. 详细执行步骤（命令级）

以下以「分阶段收敛（方案 A/B）」为主线，**每阶段可独立回滚**。

### 阶段 0：冻结与落定（零风险）— ✅ 已执行

```bash
# 0.1 落定 release worktree 的 83 条未提交改动
git -C /Users/ljf/Desktop/hu_ts/.wt-sdk-clean add -A
git -C /Users/ljf/Desktop/hu_ts/.wt-sdk-clean commit -m "chore(quality): 落定 F2/F4 门禁迁移与文档修订（合并收敛阶段 0）"
# → 802781b4f  (83 files changed, +10,842 / −283)

# 0.2 记录基线（便于回滚）
git rev-parse develop release/contract-entrypoint > /tmp/branch-baseline.txt
# → 366542fb0a09866efb6e985c81b1d7a127bdce94  (develop)
# → 802781b4fa0a6b32c1519dd8ecba0b3c40ce51d5  (release/contract-entrypoint)
git branch backup/pre-consolidation-develop  develop
git branch backup/pre-consolidation-release  release/contract-entrypoint
# → backup/pre-consolidation-develop @ 366542fb0
# → backup/pre-consolidation-release @ 9740e1ef2
```

> 阶段 0 结果：release worktree 工作树干净，HEAD 前移至 `802781b4f`；两个备份分支就位。Tjg 消费的 tarball 与 pin 均未改动，消费侧零影响。

### 阶段 1：在 develop 上分批执行 release 的裁剪政策 — ✅ 已完成

> 已裁决公共面政策 = **release 面（收窄）**。阶段 1 已分批执行完毕：release 线全部裁剪净效应均已沉淀于 develop，batch6 勘查为空批（无代码可应用）。

```bash
# 1.1 逐类取 release 的删除净效应（示例：废弃纯委托包装）
git diff develop release/contract-entrypoint -- src/space src/dm > /tmp/release-trim-space-dm.patch
# 1.2 在 develop 上人工评审 → 应用 → 删调用方 → 跑门禁
pnpm lint && pnpm quality:contracts && pnpm test
# 1.3 每批一个提交，提交信息注明「收窄公共面（收敛至 release 政策）」+ 撤回能力
```

**批次台账（release 面收窄政策：逐批一提交、三命令全绿）**

| 批次   | 主题                                                 | 提交        | 状态                        |
| ------ | ---------------------------------------------------- | ----------- | --------------------------- |
| batch1 | C4+C6：死后端残留 + 零调用者包装                     | `5b1ecf1dc` | ✅ 三命令全绿               |
| batch2 | C2：room-summary invite                              | `0915bd94e` | ✅ 三命令全绿               |
| batch3 | C5：54 处 `@deprecated` 纯委托包装                   | `6c15152cf` | ✅ 三命令全绿               |
| batch4 | C1：widget 整层                                      | `0522b8d39` | ✅ 三命令全绿               |
| batch5 | C6：signatures/cas 重复入口与二选一前缀              | `ab708d2d5` | ✅ 三命令全绿               |
| batch6 | 契约镜像 / vendor ISSUE-13 / codegen 剪枝 / 聚合出口 | —（空批）   | ✅ 已收敛，无代码可应用     |
| 收尾   | 阶段 1 终态全量门禁 + 日历相关假红修正               | `b1e066f4f` | ✅ 三命令全绿（7016 tests） |

> batch6 勘查结论：四类裁剪净效应均已在 develop 收敛 —— 契约镜像（develop `contract:check` 49 modules/1008 entries，为更新后端 ledger）、vendor 前缀（`check-vendor-prefix-migration` EXIT=0）、codegen cas 死条目（route-table 仅存全路径）、聚合出口（`src/contract/index.ts` 39 modules + `package.json#./contract`，`check-contract-entrypoint` EXIT=0）。因无代码改动，按「不虚构改动、不建空提交」原则未生成 batch6 提交。
>
> 收尾 `b1e066f4f` 为非裁剪类的测试稳健性修正：`check-contract-freshness.mjs` 对 `diffDays===1` 输出 `yesterday`，而断言正则仅允许 `today`/`N day(s) ago`，在镜像 age 恰落 1 天窗口时产生与代码改动无关的日历假红；补全正则分支。

### 阶段 2：产出发布快照并重钉 Tjg

```bash
# 2.1 从 develop（已收敛）生成发布快照
git checkout -b release/contract-entrypoint-next develop
# …（若仍有残余裁剪项，此处补齐）…
pnpm build
# 2.2 打版本标签
git tag -a v40.2.0-langkebo.6 -m "release snapshot from develop"
# 2.3 重钉 Tjg（见 §6）
```

### （备选）若执行「一次 git merge」

```bash
git checkout develop
git merge --no-ff release/contract-entrypoint   # 预期大量冲突
# —— 按 §5.1 分类解决 ——
pnpm contract:sync && pnpm contract:codegen      # 重生成契约产物
pnpm lint && pnpm quality:contracts && pnpm test
# 通过后按 §6 重钉 Tjg
```

> 该路径仅在其他方案被否决、且必须立刻单线时使用。

---

## 8. 测试验证清单

| 检查项           | 命令                                                     | 期望                           |
| ---------------- | -------------------------------------------------------- | ------------------------------ |
| 全量门禁         | `pnpm lint`                                              | exit 0（19 步全绿）            |
| 契约门禁         | `pnpm quality:contracts`                                 | exit 0（含 cross-line-parity） |
| 契约镜像一致     | `pnpm contract:check`                                    | exit 0                         |
| codegen 同步     | `pnpm contract:codegen:check`                            | exit 0                         |
| 类型             | `pnpm lint:types`、`pnpm test:types`                     | exit 0                         |
| 单测/集成        | `pnpm test`                                              | 全绿                           |
| 真后端           | `pnpm test:real-backend`                                 | 全绿                           |
| vendor 前缀      | `node scripts/quality/check-vendor-prefix-migration.mjs` | exit 0                         |
| Tjg 子路径冒烟   | 逐一 import 19 个子路径                                  | 全部解析成功                   |
| **Tjg pin 校验** | `cd ../Tjg && pnpm verify:sdk-pin`                       | exit 0                         |
| Tjg 硬门禁       | `sdk-check.yml` / `release-validation.yml`               | 全绿                           |
| Tjg 构建         | Tjg `vue-tsc` / `check:release`                          | 0 错误                         |

---

## 9. 回滚预案

1. **分支级回滚**（阶段 1 出错）：`git reset --hard backup/pre-consolidation-develop`（或 `git revert <批次提交>`）。
2. **Tjg 级回滚**：`git checkout meta/sdk-pin.json vendor/matrix-js-sdk.tgz` 回到旧 pin（`9740e1ef2`）+ 旧 tarball，然后 `pnpm install`，`pnpm verify:sdk-pin` 应恢复绿。
3. **契约产物回滚**：`git checkout develop -- src/*/__generated__ docs/api-contract/generated` 后重跑 `contract:codegen:check`。
4. **发布标签回滚**：删除误打的标签 `git tag -d vX.Y.Z-langkebo.N`（本地）/ `git push --delete`（远端，需用户确认）。
5. **回滚触发条件**：任一硬门禁（`pnpm lint` / `quality:contracts` / `test:real-backend` / `verify:sdk-pin`）连续两次不可修复地红。

> 回滚的关键前提：**阶段 0 已建备份分支与记录基线**；未做备份不得进入阶段 1。

---

## 10. 附录：证据命令

```bash
git merge-base develop release/contract-entrypoint            # 640cc4444…
git rev-list --count <base>..develop                          # 222
git rev-list --count <base>..release/contract-entrypoint      # 30（阶段 0 落定后）
git diff --shortstat develop release/contract-entrypoint      # 599 files, +13796/-77294
git diff --stat develop release/contract-entrypoint -- src     # 162 files, +3223/-11171
git log --oneline --no-merges <base>..release/contract-entrypoint  # release 30 提交
git worktree list                                             # 确认两个 worktree
```

---

## 11. 裁决记录与待决项

已裁决：

- **方向**：方案 **A（推荐）** —— `develop` 保持唯一 trunk，`release/contract-entrypoint` 降级为「按需生成的受控发布快照 + 版本标签」。
- **公共面政策**：**release 面（收窄）** —— 把 release 线的裁剪净效应沉淀为可复现补丁序列，逐一保留 develop 的功能增量；终态面与当前 Tjg 消费面一致。
- **阶段 0**：已执行（落定 `802781b4f` + 备份分支 + 基线）。
- **阶段 1**：**已执行并闭环** —— 在 `develop` 上分批执行 release 裁剪政策，batch1–5 已提交（`5b1ecf1dc`/`0915bd94e`/`6c15152cf`/`0522b8d39`/`ab708d2d5`），batch6 勘查为空批（release 裁剪净效应已全部收敛），终态三命令全绿（`pnpm lint` + `pnpm quality:contracts` + `pnpm test` 7016 tests）。台账见 §7。
- **执行节奏**：每批一提交、每批跑门禁；改动留工作树、不 push（除非显式授权）。

待用户进一步指示：

- **阶段 2 触发**：从已收敛的 `develop` 产出发布快照（`release/contract-entrypoint-next`）+ 打版本标签 + 重钉 Tjg（按 §7 阶段 2 / §6）。
- **Tjg 重钉时机**：收敛到位后统一重钉（阶段 2），或每批次增量重钉。
