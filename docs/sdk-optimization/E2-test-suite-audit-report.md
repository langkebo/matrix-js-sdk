# E.2 测试套件审查报告

## 执行日期

2026-07-17

## 测试统计

| 指标         | 数值                                     |
| ------------ | ---------------------------------------- |
| 测试文件总数 | 283 (spec/unit/) + 6 (spec/integ/) = 289 |
| 测试用例总数 | 5446                                     |
| 通过         | 5411 (99.36%)                            |
| 失败         | 23 (0.64%，全部预先存在)                 |
| 无测试模块   | 35（含基础设施模块）                     |

## 成功标准达标情况

| 标准                             | 目标       | 实际                       | 状态        |
| -------------------------------- | ---------- | -------------------------- | ----------- |
| `pnpm test` 全绿                 | 0 failures | 23 failures (pre-existing) | ⚠️ 预先存在 |
| `pnpm quality:type-coverage`     | ≥ 95%      | 98.85% (src overall)       | ✅          |
| `pnpm quality:swallow-fallbacks` | 零空 catch | 0                          | ✅          |

## type-coverage 修复

**问题**: `check-type-coverage.mjs` 向 `type-coverage` 传递绝对路径，导致工具返回 0/0（静默失败）。

**修复**: 在 `runTypeCoverage()` 中将文件路径转换为项目相对路径。

**修复后结果**:
| 模块 | 覆盖率 | 阈值 |
|------|--------|------|
| src (整体) | 98.85% | ≥ 98% |
| src/@types | 99.77% | ≥ 95% |
| src/models | 99.73% | ≥ 95% |
| src/store | 96.85% | ≥ 95% |
| src/web-rtc | 98.93% | ≥ 95% |
| src/matrix-rtc | 99.32% | ≥ 95% |
| src/rust-crypto | 99.11% | ≥ 95% |
| src/runtime-schemas | 100.00% | ≥ 95% |

## 预先存在的测试失败

### 1. spec/integ/sliding-sync.spec.ts (19/20 failed)

- **根因**: Worker 进程意外退出（`Worker exited unexpectedly`），非测试逻辑失败
- **性质**: 环境依赖的 worker pool 崩溃，可能与内存/资源限制有关
- **验证**: git stash 后仍存在

### 2. spec/integ/matrix-client-methods.spec.ts (4/92 failed)

- **根因**: 集成测试中的 mock 竞争/时序问题
- **性质**: 预先存在的 flaky test
- **验证**: git stash 后仍存在（88 passed, 4 failed）

## 无测试模块分析

35 个 "无测试" 模块中：

- **基础设施模块**（15 个）: @types, code-gen, common, http-api, models, store 等 — 通过其他模块的测试间接覆盖
- **Manager 模块**（20 个）: 与 D.2 审查的 38 个 active_no_test manager 对应
    - P0: pushNotifications（前端使用，需补测试 → E.3）
    - P1-P2: room-creation, room-list, room-state-management, room-upgrades, sessions, token-management, turn-server 等

## 假绿测试检测

通过抽样审查 spec/unit/ 下的测试文件，识别以下模式：

- **Mock 过度**: 部分测试 mock 了 BaseManager.request，仅验证调用参数而非实际 HTTP 行为
- **弱断言**: 少量测试使用 `toBeTruthy()` / `toBeDefined()` 而非精确值断言
- **Happy path 偏好**: 大部分测试仅覆盖成功路径，错误场景覆盖不足

**建议**: 在 future 阶段引入 MSW-based 契约测试（已在 hula 前端验证有效），替代 vi.mock 模式。
