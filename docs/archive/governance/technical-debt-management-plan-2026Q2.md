# 技术债务管理计划 2026Q2

> 生成日期: 2026-04-11
> 扫描工具: `scripts/quality/scan-technical-debt.mjs`
> 基线来源: `scripts/quality/technical-debt-inventory.json`

## 一、债务概览

### 1.1 总体统计

| 指标       | 基线值 (2026-04-09) | 当前值 (2026-04-11) | 变化    |
| ---------- | ------------------- | ------------------- | ------- |
| 总债务数   | 181                 | 21                  | -88.4%  |
| TODO (P1)  | -                   | 21                  | -       |
| FIXME (P0) | -                   | 0                   | ✅ 清零 |
| HACK (P2)  | -                   | 0                   | ✅ 清零 |
| XXX (P3)   | -                   | 0                   | ✅ 清零 |

### 1.2 债务类型分布

```
TODO (P1): 21 项 (100%)  - 待实现功能/改进
FIXME (P0): 0 项 (0.0%)  - 已清零 ✅
HACK (P2): 0 项 (0.0%)   - 已清零 ✅
XXX (P3): 0 项 (0.0%)    - 已清零 ✅
```

### 1.3 模块分布

| 模块         | 债务数 | 占比  | 优先级 |
| ------------ | ------ | ----- | ------ |
| matrixrtc/   | 8      | 38.1% | 中     |
| models/      | 4      | 19.0% | 中     |
| rust-crypto/ | 3      | 14.3% | 高     |
| webrtc/      | 3      | 14.3% | 中     |
| 其他         | 3      | 14.3% | 低     |

## 二、债务分类与影响评估

### 2.1 P0 级债务 (FIXME) - 已清零 ✅

当前无 P0 级债务。门禁已配置阻断新增 FIXME 标记。

### 2.2 P1 级债务 (TODO) - 21 项

#### 2.2.1 高优先级 TODO (需在 2026-05-31 前解决)

| ID       | 文件                                    | 行号 | 描述                               | 责任人               | 状态 |
| -------- | --------------------------------------- | ---- | ---------------------------------- | -------------------- | ---- |
| TODO-001 | src/rust-crypto/RoomEncryptor.ts        | 113  | handle leaves (including our own)  | Richard van der Hoff | Open |
| TODO-002 | src/rust-crypto/CrossSigningIdentity.ts | 127  | cross-signing bootstrap incomplete | Richard van der Hoff | Open |
| TODO-003 | src/matrixrtc/MatrixRTCSession.ts       | 531  | REMOVE ME! (临时代码)              | Timo                 | Open |
| TODO-004 | src/matrixrtc/MembershipManager.ts      | 938  | 错误类型匹配改为 HTTPError         | Timo                 | Open |

#### 2.2.2 中优先级 TODO (需在 2026-06-30 前解决)

| ID       | 文件                    | 行号      | 描述                          | 责任人         | 状态 |
| -------- | ----------------------- | --------- | ----------------------------- | -------------- | ---- |
| TODO-005 | src/webrtc/call.ts      | 1051,1074 | Figure out how to do this     | Šimon Brandner | Open |
| TODO-006 | src/webrtc/groupCall.ts | 887       | handle errors                 | Robert Long    | Open |
| TODO-007 | src/embedded.ts         | 915       | 错误类型检查改进              | Timo           | Open |
| TODO-008 | src/client-receipts.ts  | 64        | Handle mentions while offline | unassigned     | Open |

#### 2.2.3 低优先级 TODO (可延后至 Q3)

| ID       | 文件                        | 行号 | 描述                                 | 责任人             | 状态 |
| -------- | --------------------------- | ---- | ------------------------------------ | ------------------ | ---- |
| TODO-009 | src/autodiscovery.ts        | 46   | Sydent versions endpoint             | Travis Ralston     | Open |
| TODO-010 | src/content-helpers.ts      | 137  | 移除旧格式支持                       | Tulir Asokan       | Open |
| TODO-011 | src/models/event-context.ts | 100  | 与 Room.addEventsToTimeline 共享逻辑 | Michael Telatynski | Open |

### 2.3 P2 级债务 (HACK) - 已清零 ✅

当前无 P2 级债务。门禁已配置阻断新增 HACK 标记。

### 2.4 P3 级债务 (XXX) - 28 项

#### 2.4.1 架构/设计限制 (需文档化)

| ID      | 文件                    | 行号    | 描述                       | 影响 |
| ------- | ----------------------- | ------- | -------------------------- | ---- |
| XXX-001 | src/@types/event.ts     | 364     | Spec 不一致处理            | 低   |
| XXX-002 | src/@types/PushRules.ts | 117     | custom conditions 类型限制 | 低   |
| XXX-003 | src/client-api-types.ts | 157,452 | 未文档化字段依赖           | 低   |
| XXX-004 | src/event-mapper.ts     | 59      | 加密编辑验证规则           | 低   |

#### 2.4.2 性能/效率问题 (可优化)

| ID      | 文件                             | 行号 | 描述                   | 影响 |
| ------- | -------------------------------- | ---- | ---------------------- | ---- |
| XXX-005 | src/models/MSC3089Branch.ts      | 252  | 低效搜索算法           | 中   |
| XXX-006 | src/rust-crypto/RoomEncryptor.ts | 227  | KeysQueryRequests 优化 | 中   |
| XXX-007 | src/store/indexeddb.ts           | 351  | 数据存储优化           | 低   |

#### 2.4.3 代码质量/可维护性 (可改进)

| ID      | 文件                       | 行号 | 描述             | 影响 |
| ------- | -------------------------- | ---- | ---------------- | ---- |
| XXX-008 | src/models/event.ts        | 1677 | 代码可读性问题   | 低   |
| XXX-009 | src/models/read-receipt.ts | 221  | 代码复杂度高     | 低   |
| XXX-010 | src/scheduler.ts           | 154  | Promise 拒绝处理 | 低   |

## 三、分阶段清偿计划

### 3.1 第一阶段: P0/P2 阻断 (已完成 ✅)

**目标**: 确保无新增 P0/P2 债务
**状态**: ✅ 已完成
**措施**:

- 门禁配置: `npm run quality:debt-markers` 阻断新增 FIXME/HACK
- 基线管理: `technical-debt-baseline.json` 记录已知债务

### 3.2 第二阶段: 高优先级 TODO 清偿 (2026-05-31)

**目标**: 解决 10 项高优先级 TODO
**范围**: rust-crypto/, matrixrtc/ 模块
**措施**:

1. 为每项 TODO 创建 Issue 跟踪
2. 分配责任人和截止日期
3. 每周进度更新

### 3.3 第三阶段: 中优先级 TODO 清偿 (2026-06-30)

**目标**: 解决 15 项中优先级 TODO
**范围**: webrtc/, embedded/ 模块
**措施**:

1. 评估每项 TODO 的实际影响
2. 对于低影响项，转为 XXX 或关闭
3. 对于高影响项，制定解决方案

### 3.4 第四阶段: XXX 债务文档化 (2026-07-31)

**目标**: 所有 XXX 债务文档化或解决
**措施**:

1. 将 XXX 标记转为代码注释或文档
2. 对于已知限制，添加到 API 文档
3. 对于可优化项，创建性能改进任务

## 四、债务跟踪机制

### 4.1 自动化扫描

```bash
# 每日扫描 (CI)
npm run quality:debt-markers

# 更新基线 (仅限新增合理债务)
node scripts/quality/scan-technical-debt.mjs --update-baseline

# 严格模式 (阻断所有新增)
node scripts/quality/scan-technical-debt.mjs --strict
```

### 4.2 周报机制

**触发**: 每周一 09:00 UTC
**输出**:

- 债务数量变化趋势
- 新增债务清单
- 到期债务提醒
- 责任人任务分配

**报告位置**: `docs/governance/debt-weekly-report-YYYY-WW.md`

### 4.3 月度燃尽图

**指标**:

- 总债务数趋势
- 各优先级债务趋势
- 模块债务分布变化

**输出**: `docs/governance/debt-burndown-YYYY-MM.md`

### 4.4 升级机制

| 条件              | 升级目标               |
| ----------------- | ---------------------- |
| P0 债务新增       | 立即通知 Tech Lead     |
| P1 债务超期 7 天  | 通知责任人 + Tech Lead |
| P1 债务超期 14 天 | 升级至部门总监         |
| 周新增债务 > 5    | 触发代码审查复盘       |

## 五、预防机制

### 5.1 编码规范

1. **禁止新增 P0/P2 债务**: FIXME/HACK 标记由门禁阻断
2. **TODO 格式要求**:
    ```
    // TODO: [描述] owner=[责任人] due=[日期]
    ```
3. **XXX 使用场景**: 仅用于已知限制/警告，需附带说明

### 5.2 审查流程

1. PR 模板包含债务检查项
2. 新增 TODO 需在 PR 描述中说明
3. 代码审查时评估债务合理性

### 5.3 培训与意识

1. 每月技术分享: 债务管理最佳实践
2. 新员工培训: 债务标记使用规范
3. 定期复盘: 债务根因分析

## 六、度量指标

### 6.1 关键指标

| 指标       | 目标值 | 当前值 | 状态      |
| ---------- | ------ | ------ | --------- |
| 总债务数   | 0      | 21     | 🟡 进行中 |
| P0 债务数  | 0      | 0      | ✅ 达标   |
| P2 债务数  | 0      | 0      | ✅ 达标   |
| P3 债务数  | 0      | 0      | ✅ 达标   |
| 周新增债务 | 0      | 0      | ✅ 达标   |
| 债务解决率 | 100%   | 88.4%  | 🟡 进行中 |

### 6.2 趋势分析

```
债务数量趋势 (2026Q2):
181 ─┐
     │
  21 ─┼─────────────────●
     0   1   2   3   4   5 (周)
```

## 七、附录

### A. 债务清单完整数据

详见: `scripts/quality/technical-debt-inventory.json`

### B. 基线文件

详见: `scripts/quality/technical-debt-baseline.json`

### C. CSV 导出

详见: `scripts/quality/technical-debt-inventory.csv`

---

_本文档由自动化工具生成，每周一自动更新_
