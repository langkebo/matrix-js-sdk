# matrix-js-sdk 详细重构技术蓝图（2026Q2）

## 1. 架构缺陷治理

### A1. 主入口导出膨胀与职责耦合

- 目标代码范围：
    - `src/matrix.ts`
    - `src/client.ts`
    - `src/index.ts`
- 重构策略：
    - 引入分层导出：`core`（默认）、`advanced`（显式）、`legacy`（兼容）
    - 以功能域拆分 `client.ts`：`client-auth.ts`、`client-room.ts`、`client-media.ts`、`client-session.ts`
    - 建立导出清单自动校验（导出符号与 API 文档一致）
- 兼容性保障：
    - 保留现有导出路径并标记 `@deprecated`
    - 在 `docs/MIGRATION_GUIDE.md` 增加导入迁移映射表
    - 至少 2 个小版本保留兼容别名

### A2. 动态扩展与静态导出双轨

- 目标代码范围：
    - `src/manager-extensions/index.ts`
    - `src/matrix.ts`
- 重构策略：
    - 默认静态导出 + 可选动态扩展初始化
    - 统一扩展生命周期：`register -> init -> start -> stop`
    - 扩展初始化结果可观测（成功/失败事件）
- 兼容性保障：
    - `createClient` 保留自动扩展初始化
    - 新增 `createClient({ disableDynamicExtensions: true })` 软开关

### A3. `FilterManager` 命名冲突

- 目标代码范围：
    - `src/filter/index.ts`
    - `src/filter-manager/index.ts`
    - `src/matrix.ts`
- 重构策略：
    - 保留单一权威实现，另一路径转发到统一实现
    - 对历史路径补充 deprecate 注释与替代路径提示
- 兼容性保障：
    - 保留老路径导出，至少一个大版本后删除

## 2. 代码质量与可维护性

### Q1. 错误体系收敛（`BaseManager`）

- 目标代码范围：
    - `src/*/index.ts`（所有 manager）
    - `src/managers/base-manager.ts`
- 重构策略：
    - 统一 `normalizeError` 路径
    - 统一 `AuthError / NotFoundError / RetryableError / ApiError` 分类
    - 禁止在 manager 层直接 `throw unknown`
- 兼容性保障：
    - 对外错误类型不变，仅增强分类精度
- 阶段结论（2026-04-11）：
    - ✅ 已完成：`BaseManager` 覆盖率 `101/102 (99.0%)`
    - ✅ 已关闭：Q1 风险在治理台账中标记为 `Closed`
    - ✅ 豁免口径：`RustBackupManager` 为内部类，不影响外部错误语义一致性

### Q2. 吞错与默认回退治理

- 目标代码范围：
    - `src/push/index.ts`
    - `src/room-summary/index.ts`
    - `src/dm/index.ts`
    - 其他 `catch -> return null/[]/false` 路径
- 重构策略：
    - 默认抛出分类错误
    - 仅在白名单场景允许回退（需注释原因和监控）
    - 新增 ESLint 规则：禁止无注释吞错
- 兼容性保障：
    - 对历史回退路径增加 `enableLegacyFallback` 运行时开关
- 阶段结论（2026-04-11）：
    - ✅ 已完成：吞错扫描门禁通过（`65/100 -35%`）
    - ✅ 已完成：累计清理 68 项吞错回退，剩余 65 项为可解释语义路径

### Q3. `any` 与技术债清理

- 目标代码范围：
    - `src/**/*.ts`（优先高风险模块）
- 重构策略：
    - `any` 替换为领域类型、`unknown` + type guard、泛型约束
    - TODO/FIXME 建立到期时间和 owner
- 兼容性保障：
    - 类型收紧前先补回归测试，避免行为变化
- 阶段结论（2026-04-11）：
    - ✅ 已完成：`T-Q3` 已达成（`as any = 0`，`src` 显式 `: any = 10`）
    - 🔄 持续治理：`TODO/FIXME` 技术债按 owner 与到期时间继续收敛

## 3. 性能与稳定性

### P1. 缓存治理统一

- 目标代码范围：
    - `src/utils/lru-cache.ts`
    - `src/push/index.ts`
    - `src/space/index.ts`
    - `src/room-summary/index.ts`
- 重构策略：
    - 抽象统一缓存配置接口（容量/TTL/逐出策略）
    - 暴露命中率、驱逐率、stale ratio 指标
    - 增加 cache key 命名规范
- 兼容性保障：
    - 默认值保持原行为，逐步开启新策略

### P2. 性能预算与回归门禁

- 目标代码范围：
    - `spec/perf/**/*.spec.ts`
    - `.github/workflows/systemic_refactor_quality_gate.yml`
- 重构策略：
    - 定义关键路径预算（P95、初始化时长、内存峰值）
    - 在 CI 增加性能测试步骤
    - 新增超大文件变更守门：`>1500` 行 TypeScript 文件改动必须经过架构评审（可用 `ARCH_REVIEW_APPROVED=true` 显式放行）
- 兼容性保障：
    - 阈值先按基线设定，逐月收紧 5~10%
- 阶段结论（2026-04-11）：
    - 🔄 进行中：性能基线、内存测量工具与对比报告已落地
    - 🔄 待完成：PR 级性能回归结论的全链路可见性与阻断策略收口

## 4. 安全与合规

### S1. 依赖漏洞治理

- 目标代码范围：
    - `package.json`
    - `pnpm-lock.yaml`
    - `.github/workflows/systemic_refactor_quality_gate.yml`
- 重构策略：
    - 建立 `pnpm audit --audit-level=high` 强制门禁
    - 依赖升级批次化（先 dev toolchain，再 runtime）
- 兼容性保障：
    - 每批升级附变更影响说明与回滚方案

### S2. 日志脱敏规范

- 目标代码范围：
    - `src/**/*.ts` 日志调用点
- 重构策略：
    - 禁止输出 token/password/authorization 明文或存在性判定
    - 统一日志字段白名单与脱敏函数
- 兼容性保障：
    - 仅调整日志内容，不修改 API 行为

### S3. 静态安全扫描

- 目标代码范围：
    - `.github/workflows/codeql.yml`
    - `sonar-project.properties`
- 重构策略：
    - 引入 CodeQL 周期扫描 + PR 扫描
    - SonarQube 与测试覆盖率报告联动
- 兼容性保障：
    - 先以告警模式运行 1 周，确认后切阻断

## 5. 测试与发布策略

- 单元测试：每个 manager 重构变更必须补齐正常/异常/边界三类用例。
- 集成测试：`spec/integ/real-backend` 针对 URL 组装、错误码映射、兼容路径回归。
- 覆盖率策略：关键模块（`admin/dm/push/space/room-summary`）行覆盖率 >= 90%。
- 迁移指南：记录导出路径迁移、弃用 API、参数变化、开关项。
- 版本策略：无 breaking change 走 minor；有 breaking change 必须提供迁移方案并走 major。
