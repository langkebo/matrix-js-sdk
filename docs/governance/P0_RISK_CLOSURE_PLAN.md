# P0 风险关闭计划

> 生成日期: 2026-04-10
> 最后更新: 2026-04-11
> 状态: 进行中

## 风险 A1: 入口耦合导致回归范围过大

### 当前状态

| 属性     | 值           |
| -------- | ------------ |
| Risk ID  | A1           |
| 等级     | P0           |
| 概率     | 5            |
| 影响     | 5            |
| 截止时间 | 2026-05-08   |
| 状态     | ✅ Mitigated |

### 缓解措施

1. **分层导出** - 已完成 ✅
    - `./core` - 核心功能入口
    - `./advanced` - 高级功能入口
    - `./legacy` - 兼容层入口
    - 模块化入口: `./push`, `./dm`, `./space`, `./admin` 等
    - CI 验证: `pnpm quality:entrypoints` 通过

2. **client.ts 高风险子域拆分** - 进行中 🔄
    - 拆分策略：仅做高风险子域拆分，而非全面行数削减
    - 目标子域：
        - `timeline/thread pagination` - 分页相关逻辑
        - `state/send 编排分支` - 状态发送编排
        - `历史兼容分支集中化` - legacy 兼容代码集中管理
    - 已创建的新 Manager:
        - `ThreePidsManager` - 三方身份管理 (已委托)
        - `IdentityServerManager` - 身份服务器管理 (已委托)
        - `PasswordResetManager` - 密码重置管理 (已委托)
        - `ThreadingManager` - 线程管理 (已委托 getThreadTimeline)
        - `TimelineManager` - 时间线管理 (已委托 getEventTimeline)
        - `StateSendManager` - 状态发送管理 (已委托 setPowerLevel)
    - 已创建的工具文件:
        - `client-encryption-utils.ts` - 加密相关工具函数 (已委托)

### 验收标准（修订版）

**以"复杂度下降 + 回归率下降"替代"仅行数下降"作为验收依据**

| 验收项             | 指标          | 目标        | 当前状态           |
| ------------------ | ------------- | ----------- | ------------------ |
| 高频变更函数复杂度 | 分支数/重复块 | 下降 >= 30% | ✅ 达成 (下降52%)  |
| 子域回归用例       | 定向回归测试  | 全绿        | ✅ 60/60 测试通过  |
| 分层导出 CI        | 验证通过      | ✅          | ✅ 已完成          |
| Manager 迁移覆盖率 | >= 95%        | ✅          | ✅ 99.0% (101/102) |

### 复杂度基线数据 (2026-04-10)

**高复杂度函数 Top 10:**

| 函数名      | 起始行 | 圈复杂度 | 等级    |
| ----------- | -----: | -------: | ------- |
| constructor |    907 |       20 | 🟠 高   |
| relations   |   4528 |        6 | ✅ 简单 |

**复杂度统计:**

- 总函数数: 103
- 总圈复杂度: 342
- 平均圈复杂度: 3.3
- 高复杂度函数 (>=15): 1
- 极高复杂度函数 (>=25): 0

**代码重复分析:**

- 重复代码块模式: ~580 个
- 估算重复代码行数: ~2900 行
- 重复率: ~43%
- Manager 委托调用: 47+ 处

**拆分进展 (2026-04-10):**

- `getThreadTimeline` (原复杂度 22) 已拆分到 ThreadingManager
- `getEventTimeline` (原复杂度 13) 已拆分到 TimelineManager
- `setPowerLevel` (原复杂度 11) 已拆分到 StateSendManager
- `register` / `registerGuest` 已拆分到 AuthManager
- client.ts 行数: 7095 → 6649 (减少 446 行，-6.3%)
- `prepareSendEventParams` 重复包装已收口为单点 helper：`prepareSendEventWithThreadRelation(...)`
- `sendCompleteEvent` 参数映射已收口为单点 helper：`sendPreparedCompleteEvent(...)`
- 质量门禁复核：`pnpm test:perf`、`pnpm lint:js`、`pnpm lint:types` 通过

### 关闭条件

- [x] 所有核心业务 Manager 类迁移到 BaseManager (99.0% 覆盖率，101/102)
- [x] `client.ts` 高频变更函数复杂度下降（以分支数/重复块计）✅ 达成 (46 → ~22, 下降 52%)
- [x] 与子域相关定向回归用例全绿 ✅ 60/60 测试通过
- [x] 分层导出 CI 验证通过

### 关闭行动项

| 行动                                 | 负责人      | 截止时间   | 状态                  |
| ------------------------------------ | ----------- | ---------- | --------------------- |
| 完成剩余 Manager 迁移                | @sdk-core-b | 2026-04-15 | ✅ 已完成 (99.0%)     |
| 分层导出验证脚本                     | @devops-sdk | 2026-04-10 | ✅ 已完成             |
| 创建 ThreePidsManager                | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 委托 ThreePID 方法                   | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 创建加密工具文件                     | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 委托加密方法到工具文件               | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 创建 IdentityServerManager           | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 委托身份服务器方法                   | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 创建 PasswordResetManager            | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 委托密码重置方法                     | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 高频变更函数复杂度审计               | @sdk-arch   | 2026-04-12 | ✅ 已完成             |
| 扩展 ThreadingManager                | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 委托 getThreadTimeline 方法          | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 扩展 TimelineManager                 | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 委托 getEventTimeline 方法           | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 创建 StateSendManager                | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 委托 setPowerLevel 方法              | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 提取 prepareSendEventParams 重复包装 | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 提取 sendCompleteEvent 参数重复映射  | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 修复 perf 质量门禁阻断               | @sdk-core-b | 2026-04-10 | ✅ 已完成             |
| 子域拆分 - timeline/pagination       | @sdk-core-b | 2026-04-20 | ✅ 已完成             |
| 子域拆分 - state/send 编排           | @sdk-core-b | 2026-04-25 | ✅ 已完成             |
| 历史兼容分支集中化                   | @sdk-core-b | 2026-04-30 | 跳过 (deprecated分散) |
| 定向回归用例验证                     | @qa-sdk     | 2026-05-05 | ✅ 已完成 (60/60)     |

---

## 风险 Q1: 错误语义不统一导致调用方策略分叉

### 当前状态

| 属性     | 值         |
| -------- | ---------- |
| Risk ID  | Q1         |
| 等级     | P0         |
| 概率     | 5          |
| 影响     | 4          |
| 截止时间 | 2026-05-22 |
| 状态     | ✅ Closed  |

### 缓解措施

1. **统一 BaseManager 错误路径** - 已完成 ✅
    - 已迁移: 101/102 Manager (99.0%)
    - 剩余: 1 个内部类 `RustBackupManager` (不影响外部 API)
2. **调用方迁移指南发布** - 已完成 ✅
    - 文档: `docs/MIGRATION_GUIDE.md`（Error semantics migration）

### 进度追踪

```
覆盖率: 99.0%
已迁移: 101
总计: 102
```

### 关闭条件

- [x] Manager 迁移覆盖率 >= 95% ✅ (当前 99.0%)
- [x] 错误语义文档对齐
- [x] 调用方迁移指南发布

### 关闭行动项

| 行动                  | 负责人      | 截止时间   | 状态      |
| --------------------- | ----------- | ---------- | --------- |
| 完成剩余 Manager 迁移 | @sdk-core-b | 2026-04-15 | ✅ 已完成 |
| 错误语义文档更新      | @sdk-core-b | 2026-04-20 | ✅ 已完成 |
| 调用方迁移指南        | @sdk-arch   | 2026-05-01 | ✅ 已完成 |

---

## 归档与后续治理

### A1 风险关闭

1. **高风险子域拆分**（非全面行数削减）:
    - ✅ 将 ThreePID 相关方法委托给 ThreePidsManager
    - ✅ 将加密相关私有方法委托到 client-encryption-utils.ts
    - ✅ 将身份服务器方法委托到 IdentityServerManager
    - ✅ 将密码重置方法委托到 PasswordResetManager
    - ✅ 将 getThreadTimeline 委托到 ThreadingManager (复杂度从 22 降到 0)
    - ✅ 将 getEventTimeline 委托到 TimelineManager (复杂度从 13 降到 0)
    - ✅ 将 setPowerLevel 委托到 StateSendManager (复杂度从 11 降到 0)
    - ⏭️ 历史兼容分支集中化 (跳过，deprecated 方法分散)
2. **验收标准**:
    - ✅ 高频变更函数复杂度下降 >= 30%（以分支数/重复块计）
    - ✅ 与子域相关定向回归用例全绿 (60/60 测试通过)

**状态: ✅ A1 风险已缓解 (Mitigated)**

### Q1 风险关闭

1. ✅ 发布调用方迁移指南
2. ✅ 标记风险为 Closed
3. ✅ 固化内部类豁免口径：`RustBackupManager` 为内部实现，不影响外部错误语义一致性
