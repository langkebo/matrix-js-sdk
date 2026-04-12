# matrix-js-sdk 优化执行报告（2026Q2 / FilterManager 冲突收敛）

## 1. 执行范围

- 对齐文档基线：
    - `SYSTEMIC_AUDIT_AND_REFACTOR_MASTER_PLAN_2026-04-09.md`
    - `SYSTEMIC_REFACTOR_TECHNICAL_BLUEPRINT_2026Q2.md`
    - `SYSTEMIC_REFACTOR_DELIVERABLES_2026Q2.md`
    - `SYSTEMIC_REFACTOR_EXECUTION_TASKBOARD_2026Q2.md`
- 本次聚焦任务：
    - `T-A3`：`FilterManager` 命名冲突收敛
    - `T-U2`：迁移说明与 deprecated 路径补齐
    - `T-Q2`：移除 legacy `getFilter()` 的非 404 吞错行为

## 2. 代码变更摘要（可验证）

- `src/filter-manager/index.ts`
    - 重构为 deprecated 兼容包装层
    - create/get 逻辑委托给权威实现 `src/filter/index.ts`
    - 非 `404` 错误改为抛出统一 SDK 错误，不再默认吞错
- `src/matrix.ts`
    - 主入口新增 `FilterManager`（权威实现）与 `LegacyFilterManager`（迁移别名）
    - 为 legacy filter 兼容导出补充显式 `@deprecated` 注释，明确替代入口
- `spec/unit/filter-manager-compat.spec.ts`
    - 新增兼容回归测试，覆盖别名导出、缓存行为、404/null、非 404 抛错
- `docs/MIGRATION_GUIDE.md`
    - 新增旧 -> 新导入映射、主入口 alias 对照表与替换代码示例

## 3. 指标对比（本批可观测）

| 指标                          | 变更前 |         变更后 |  变化 | 说明                                 |
| ----------------------------- | -----: | -------------: | ----: | ------------------------------------ |
| `FilterManager` 权威实现数量  |      2 | 1 + 1 个兼容层 |  收敛 | 权威实现统一到 `filter/index.ts`     |
| `filter-manager` 默认吞错路径 |      1 |              0 | -100% | `getFilter()` 仅对 `404` 返回 `null` |
| 迁移文档                      |      0 |              1 |    +1 | 补齐 `docs/MIGRATION_GUIDE.md`       |
| 兼容回归测试文件              |      0 |              1 |    +1 | 覆盖导出与错误语义                   |

## 4. 验证证据

- `pnpm vitest run spec/unit/filter-manager-compat.spec.ts`
- `pnpm lint:types`

## 5. 风险与阻塞清单

- R1（P1）：主入口导出仍未完成完整 Core/Advanced/Legacy 分层
    - 根因：当前批次聚焦命名冲突收敛，尚未重排整体导出面
    - 方案：下一批推进 `T-A1`，在主入口建立分层清单和自动校验
- R2（P1）：`filter-manager` 兼容层仍需保留一段迁移窗口
    - 根因：需避免历史路径直接移除造成外部 break
    - 方案：保留 deprecated 别名至少一个迁移周期，再评估删除
- R3（P1）：错误语义文档覆盖存在阶段性缺口
    - 根因：该迭代时点仅完成 FilterManager 迁移说明
    - 状态：✅ 已关闭（后续已在 `docs/api-contract/{push,dm,room-summary,space}.md` 补齐错误语义映射与 errcode 章节，`T-U2` 验收达成）

## 6. 回滚策略

- 最小回滚单元：
    - `src/filter-manager/index.ts`
    - `src/matrix.ts`
    - `spec/unit/filter-manager-compat.spec.ts`
    - `docs/MIGRATION_GUIDE.md`
- 回滚方式：
    - 若兼容层行为需要恢复，可单次回滚上述文件而不影响 `filter/index.ts` 权威实现

## 7. 下一迭代建议（按优先级）

1. 推进 `T-A1`，把主入口导出整理为 `core/advanced/legacy` 分层。
2. 继续清理 `src/**/*` 中剩余 `catch -> return null/[]/false` 路径。
3. `T-U2` 已完成，后续仅做增量接口的错误码章节巡检与周度回填。
4. 结合 `spec/perf/critical-path.perf.spec.ts` 输出基线对比报表，补齐性能证据链。
