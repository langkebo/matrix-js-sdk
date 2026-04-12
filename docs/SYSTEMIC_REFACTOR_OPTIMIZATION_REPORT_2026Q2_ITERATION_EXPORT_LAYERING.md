# matrix-js-sdk 优化执行报告（2026Q2 / Entrypoint 分层与导出清单）

## 1. 执行范围

- 对齐文档基线：
    - `SYSTEMIC_AUDIT_AND_REFACTOR_MASTER_PLAN_2026-04-09.md`
    - `SYSTEMIC_REFACTOR_TECHNICAL_BLUEPRINT_2026Q2.md`
    - `SYSTEMIC_REFACTOR_DELIVERABLES_2026Q2.md`
    - `SYSTEMIC_REFACTOR_EXECUTION_TASKBOARD_2026Q2.md`
- 本次聚焦任务：
    - `T-A1`：`matrix.ts` 导出分层（Core/Advanced/Legacy）
    - `T-O1`：质量门禁补强（导出清单可校验）

## 2. 代码与文档变更摘要（可验证）

- 新增 entrypoints：
    - `src/core.ts`（对应 `matrix-js-sdk/core`）
    - `src/advanced.ts`（对应 `matrix-js-sdk/advanced`）
    - `src/legacy.ts`（对应 `matrix-js-sdk/legacy`）
- 新增 exports 对齐与兼容子路径：
    - `package.json#exports` 新增 `./core`、`./advanced`、`./legacy`
    - `package.json#exports` 新增 `./src/filter`、`./src/filter-manager`（对齐迁移文档中的历史导入路径）
- 新增导出清单契约文档与校验：
    - `docs/api-contract/exports.md`：导出清单权威表
    - `scripts/quality/check-exports-docs.mjs`：校验 `package.json#exports` 与契约文档一致
    - `.github/workflows/systemic_refactor_quality_gate.yml`：新增导出清单门禁步骤
- 迁移手册补强：
    - `docs/MIGRATION_GUIDE.md` 新增 entrypoint 分层说明（core/advanced/legacy）

## 3. 验证证据

- `pnpm lint:types`
- `pnpm quality:contracts`（聚合执行 `quality:exports + quality:entrypoints`）
- `pnpm vitest run spec/unit/matrix-client.spec.ts -t "_unstable_sendSticky|should add thread relation if threadId is passed and the relation is missing"`（受影响主链路定向回归）

## 4. 风险与阻塞清单

- R1（P1）：`advanced` 当前仍与默认入口共享导出面，尚未完成真正“收敛导出集”
    - 根因：`matrix.ts` 仍是扁平大导出面，且存在历史命名/功能域重复导出
    - 方案：下一批对 `advanced` 扩充白名单覆盖范围，并补充“按场景选择 core/advanced”的导入指引
- R2（P1）：新增 `./src/*` compat 子路径会扩大可用导入面
    - 根因：需要与历史文档/用户用法对齐，避免 ESM `exports` 阻断导致的隐性 breaking
    - 方案：将 `./src/*` 标记为兼容子路径，仅在迁移周期内保留，并在 `legacy` entrypoint 统一收口

## 5. 回滚策略

- 最小回滚单元：
    - `package.json` 的 `exports` 与 `scripts` 增量
    - `src/core.ts`、`src/advanced.ts`、`src/legacy.ts`
    - `docs/api-contract/exports.md`
    - `scripts/quality/check-exports-docs.mjs`
    - `.github/workflows/systemic_refactor_quality_gate.yml`

## 6. 下一迭代建议（按优先级）

1. 为 `core` 引入“显式白名单导出”，并用 CI 校验不允许意外扩张。
2. 把 `legacy` entrypoint 扩展为集中承载 deprecated shims，迁移期结束后逐步收缩 `./src/*` compat 子路径。
3. 将导出清单与 `docs/api-contract/*` 的变更记录在 `docs/api-contract/CHANGELOG.md`，形成可审计轨迹。

## 7. 联动任务进展（T-Q3 any 债务收口）

- 已完成可收敛 `any` 的类型替换：
    - `src/store/indexeddb.ts`
    - `src/store/index.ts`
    - `src/models/typed-event-emitter.ts`
    - `src/@types/global.d.ts`
    - `src/@types/matrix-sdk-crypto-wasm.d.ts`
- 收口口径（`src`）：
    - `as any` 代码转换 = `0`
    - 显式 `: any` = `10`（`logger.ts` 5 处日志接口兼容 + `models/event.ts` 2 处动态索引 + `store` 2 处事件处理签名 + `typed-event-emitter.ts` 1 处泛型兼容签名）
- 验证证据：
    - `pnpm lint:types`
    - `pnpm lint:js`
    - `pnpm quality:contracts`
