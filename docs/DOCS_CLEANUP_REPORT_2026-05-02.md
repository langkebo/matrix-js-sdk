# 文档清理报告

> 清理日期: 2026-05-02
> 清理范围: `matrix-js-sdk/docs/`
> 目标: 删除过时、重复、冲突或误留的文档产物，收敛到当前仍在维护的文档集合

## 1. 保留标准

本次清理采用以下标准:

1. 保留当前版本仍在维护、且能直接指导开发或审计的文档。
2. 保留当前契约体系的主入口、索引、治理文档、迁移文档和安全/治理资料。
3. 保留 `docs/api-contract/history/` 中已显式归档的历史审计材料，因为这些文件仍被当前索引引用，且承担审计追溯职责。
4. 删除仅用于阶段性播报、重复总结、快照式清单、已被新版 ledger-driven 流程取代的旧方案文档。
5. 删除不应入库的生成草稿或临时产物。
6. “超过 6 个月未更新”按 `git log -1 --format=%cs -- <file>` 判定；本次扫描结果为 0 个命中项。

## 2. 扫描结论

- 清理前 `docs/` 共识别 207 个文件。
- 清理后 `docs/` 保留 176 个文件。
- 本次共删除 31 个文件。
- 所有仍被 `git` 跟踪的保留文档，最近一次提交时间集中在 `2026-04-12` 到 `2026-05-02`，没有超过 6 个月未更新的文件。

## 3. 删除清单

### 3.1 误留草稿产物

| 文件                                                                | 删除原因                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `docs/api-contract/drafts/2026-05-02T00-00-00Z-dm-deprecated-01.md` | Phase E 本地演练生成的 draft，属于 git-ignored 临时产物，不应保留在仓库中。 |

### 3.2 重复总结与阶段快照

| 文件                                         | 删除原因                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `docs/COMPLETION_SUMMARY.txt`                | 纯文本快照，内容已被 `README.md`、`FINAL_REPORT.md` 覆盖。                      |
| `docs/WORK_SUMMARY.txt`                      | 阶段性文本摘要，已被当前导航与总览文档覆盖。                                    |
| `docs/CONTRACT_WORK_SUMMARY_2026-04-27.md`   | 2026-04-27 的阶段快照，已被当前总览与 cleanup report 取代。                     |
| `docs/PHASE1_COMPLETION_REPORT.md`           | 阶段完成播报，和当前保留的 `FINAL_REPORT.md` / `PROJECT_STATUS_FINAL.md` 重复。 |
| `docs/PHASE2_IMPLEMENTATION_LOG.md`          | 实施日志型快照，内容已过时且与 `NEXT_STEPS.md` / `PROGRESS_REPORT.md` 冲突。    |
| `docs/SDK_COVERAGE_REPORT.md`                | 单次统计快照，口径落后于当前契约索引与审计索引。                                |
| `docs/OPTIMIZATION_SHOWCASE.md`              | 展示型文档，结论与当前代码/文档口径不再一致。                                   |
| `docs/OTHER_MODULES_AUDIT_2026-04-16.md`     | 旧审查报告，结论已被后续文档修正并分散到当前索引。                              |
| `docs/REMAINING_MODULES_AUDIT_2026-04-16.md` | 旧审查报告，优先级与覆盖率口径已过时。                                          |

### 3.3 已被新版流程取代的旧方案/总结链

| 文件                                                       | 删除原因                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `docs/SDK_CONTRACT_OPTIMIZATION_PLAN_2026-04-27.md`        | 已被 `docs/api-contract/LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md` 取代。 |
| `docs/CONTRACT_OPTIMIZATION_SUMMARY.md`                    | 基于旧方案的执行摘要，已被新版方案与当前总览覆盖。                   |
| `docs/SDK_OPTIMIZATION_SUMMARY_2026-04-15.md`              | 旧优化链路的 Phase 1 摘要，内容已被后续文档吸收。                    |
| `docs/SDK_OPTIMIZATION_COMPLETE_2026-04-15.md`             | 旧优化链路的阶段完成报告，属重复播报。                               |
| `docs/SDK_OPTIMIZATION_FINAL_2026-04-15.md`                | 旧优化链路的阶段“最终”报告之一，存在多份重复 final。                 |
| `docs/SDK_OPTIMIZATION_FINAL_COMPLETE_2026-04-16.md`       | 与其他 final/summary/report 文档重复。                               |
| `docs/SDK_OPTIMIZATION_FINAL_REPORT_2026-04-16.md`         | 与其他 final/summary/report 文档重复。                               |
| `docs/SDK_OPTIMIZATION_FINAL_SUMMARY_2026-04-16.md`        | 与其他 final/summary/report 文档重复。                               |
| `docs/SDK_OPTIMIZATION_COMPREHENSIVE_REPORT_2026-04-16.md` | 汇总旧优化链路中的已删除文档，继续保留会制造坏链接和重复。           |
| `docs/SDK_OPTIMIZATION_PHASE3_2026-04-15.md`               | 旧阶段播报，已无独立维护价值。                                       |
| `docs/SDK_OPTIMIZATION_PHASE4_2026-04-16.md`               | 旧阶段播报，已无独立维护价值。                                       |
| `docs/SDK_OPTIMIZATION_PHASE5_2026-04-16.md`               | 旧阶段播报，已无独立维护价值。                                       |
| `docs/SDK_OPTIMIZATION_PHASE6_2026-04-16.md`               | 旧阶段播报，已无独立维护价值。                                       |
| `docs/SDK_OPTIMIZATION_PHASE9_COMPLETE_2026-04-16.md`      | 旧阶段播报，已无独立维护价值。                                       |
| `docs/FILES_CREATED.md`                                    | 快照式文件清单，无法持续维护，且与实际目录结构易漂移。               |

## 4. 清理后的保留结构

### 4.1 当前入口文档

- `docs/README.md`
- `docs/PROJECT_HANDOVER.md`
- `docs/PROJECT_STATUS_FINAL.md`
- `docs/NEXT_STEPS.md`
- `docs/FINAL_REPORT.md`
- `docs/DOCS_CLEANUP_REPORT_2026-05-02.md`

### 4.2 当前工程参考

- `docs/MIGRATION_GUIDE.md`
- `docs/VERSION_POLICY.md`
- `docs/ADMIN_GUIDE.md`
- `docs/governance/`
- `docs/security/`

### 4.3 当前契约体系

- `docs/api-contract/*.md`
- `docs/api-contract/generated/`
- `docs/api-contract/governance/`
- `docs/api-contract/history/`

## 5. 剩余文档更新状态

### 5.1 活跃文档组

| 文档组                                | 状态   | 说明                                                         |
| ------------------------------------- | ------ | ------------------------------------------------------------ |
| `docs/api-contract/generated/`        | 当前   | 机器生成契约镜像，与当前 ledger 流程一致。                   |
| `docs/api-contract/governance/`       | 当前   | 包含 prompt template、review checklist 等 Phase E 治理文档。 |
| `docs/api-contract/*.md`              | 当前   | 模块主契约文档，仍是人类可读的当前契约层。                   |
| `docs/README.md` 等入口文档           | 已更新 | 已改为只指向保留集，不再引用已删除快照。                     |
| `docs/governance/` / `docs/security/` | 保留   | 仍属于当前 2026Q2 治理/安全资料。                            |

### 5.2 历史文档组

| 文档组                             | 状态 | 说明                                         |
| ---------------------------------- | ---- | -------------------------------------------- |
| `docs/api-contract/history/`       | 保留 | 已是显式归档目录，承担历史审计追溯职责。     |
| `docs/governance/perf-baseline/`   | 保留 | 基线与对比数据，属于治理资料，不是重复播报。 |
| `docs/governance/quality-reports/` | 保留 | 质量快照，但仍位于治理目录并可用于追踪趋势。 |

## 6. 同步修复

本次清理同时完成以下同步修复:

- 更新 `docs/README.md`，切换到当前保留的文档导航。
- 更新 `docs/PROJECT_HANDOVER.md`，移除对已删除阶段报告和旧方案的依赖。
- 更新 `docs/PROJECT_STATUS_FINAL.md` 与 `docs/FINAL_REPORT.md` 的文档树描述。
- 更新 `docs/NEXT_STEPS.md`，将主方案入口切换为 `LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md`。
- 更新 `docs/ADMIN_GUIDE.md` 的参考资料，移除指向旧总结和错误路径的链接。
- 修正 `docs/api-contract/AUDIT_INDEX.md` 中指向历史审计材料的路径。

## 7. 后续维护建议

1. 后续若再产出阶段性快照，优先落到显式归档目录，而不是继续堆积在 `docs/` 根目录。
2. `docs/README.md` 应继续作为唯一导航入口维护，避免多份“最终报告”并存。
3. `docs/api-contract/drafts/` 继续保持 git-ignored，只保留 `.gitignore`。
4. 若未来需要保留更多历史快照，建议建立统一的 `docs/history/` 顶层归档目录，并在 `README.md` 中只给单一入口。

## 8. 第二阶段精简

2026-05-02 的第二阶段精简进一步收敛了时间序列快照目录:

- `docs/governance/perf-baseline/` 删除 `baseline-2026-04-10.{md,json}`，仅保留仍被 2026Q2 文档引用的最新基线、对比结论和无日期基线文件。
- `docs/governance/quality-reports/` 删除 `2026-04-11` 与 `2026-04-12` 两组质量快照，仅保留最新的 `2026-04-13.{md,json}`。

精简原则:

1. 保留“最新状态”。
2. 保留仍被活跃文档直接引用的里程碑材料。
3. 删除未再被引用、且仅表达中间态的时间序列重复快照。
