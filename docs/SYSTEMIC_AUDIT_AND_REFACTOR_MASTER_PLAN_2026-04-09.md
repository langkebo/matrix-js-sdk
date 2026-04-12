# matrix-js-sdk 系统性深度审查与整体重构主方案（2026-04-09）

## 1. 审查目标与方法

### 1.1 目标

- 对 `matrix-js-sdk` 进行全维度诊断：架构、代码质量、性能、安全合规、用户体验、运维发布、团队流程。
- 输出“问题清单 + 风险矩阵 + 分阶段治理路线图”，避免局部修补，转向体系化治理。
- 为后续季度治理提供可量化、可追踪、可验收的执行基线。

### 1.2 本次证据来源（基于当前磁盘代码）

- 仓库配置：`package.json`、`tsconfig.json`、`.eslintrc.cjs`、`vitest.config.ts`。
- 核心入口与扩展机制：`src/matrix.ts`、`src/manager-extensions/index.ts`。
- 高风险模块：`src/admin/index.ts`、`src/dm/index.ts`、`src/push/index.ts`、`src/space/index.ts`、`src/room-summary/index.ts`。
- 流程与治理：`.github/workflows/tests.yml`、`.github/workflows/release.yml`、`CONTRIBUTING.md`、PR 模板与 pre-commit 配置。
- 自动扫描：文件规模、`TODO/FIXME`、`any` 使用、吞错模式、依赖安全审计（`pnpm audit`）。

### 1.3 范围说明

- 本报告是“系统性审查蓝图”，不是一次性完成全仓重构。
- 风险评估采用“概率(P)1-5 × 影响(I)1-5 = 风险分值”。

---

## 2. 基线现状（量化）

### 2.1 规模与复杂度

- `src` TypeScript 文件：`347`
- 测试文件：`163`（unit `132` + integ `31`）
- 文档文件：`75`（`docs/**/*.md`）
- `Manager` 类导出数量（`src/*/index.ts`）：`129`
- 超大文件（行数）：
    - `src/client.ts`：`9044`
    - `src/models/room.ts`：`4021`
    - `src/webrtc/call.ts`：`3071`
    - `src/room-summary/index.ts`：`1906`
    - `src/room/index.ts`：`1809`

### 2.2 质量信号

- 代码注释标记（`TODO/FIXME/HACK/XXX`）：`181`
- `any` / `as any` 使用：`208`
- 典型吞错返回（扫描命中）：`6` 组（如 `return null/[]/false`）
- 错误处理基类继承分布：
    - `extends BaseManager`：`6`
    - `extends TypedEventEmitter`：`25`
    - 结论：统一错误体系已启动，但覆盖率不足。

### 2.3 测试与质量门禁

- `vitest.config.ts` 已配置覆盖率阈值：`lines/functions/statements >= 70`, `branches >= 60`。
- 但默认 CI (`tests.yml`) 仅上传覆盖率工件，未见“覆盖率阈值阻断 PR”的独立治理动作（依赖 Vitest 运行结果，缺专门覆盖治理看板）。
- `tsconfig.json` 为 `strict: true`，但 `spec/integ/real-backend` 等被排除在默认 TS include/exclude 范围边界之外，存在“类型门禁覆盖不完整”的风险。

### 2.4 安全审计（依赖）

- `pnpm audit --audit-level=high` 结果：`21` 个漏洞（`13` 高危，`8` 中危）。
- 主要涉及链路：`vitest/vite`、`minimatch`、`picomatch`、`flatted` 等。
- 当前状态：未建立“依赖漏洞 SLA 与升级窗口”机制。

### 2.5 流程与发布

- CI 有 Vitest、下游联动（element-web/complement-crypto），发布流程较完整（含 docs/npm）。
- PR 模板、Contributing、pre-commit 存在，但“架构守门（ADR/设计评审）+ 风险台账 + 质量指标看板”缺失。

---

## 3. 系统性问题清单（按维度）

## 3.1 架构设计

- A1. **入口与职责聚合过重**
    - 现象：`matrix.ts` 导出面快速膨胀（大量 re-export），`client.ts` 体量过大。
    - 根因：历史兼容 + 功能快速扩展，缺少“分层公开 API 边界”治理。
    - 风险：认知负担高、回归面大、发布耦合。
    - 当前状态：✅ 已缓解（`core/advanced/legacy` 分层已落地，A1 验收口径已达成）。
- A2. **扩展机制与静态导出双轨并存**
    - 现象：`manager-extensions` 动态扩展 + 主入口静态导出并行。
    - 根因：迁移期策略未定义终态。
    - 风险：行为不一致、文档与实际偏移。
    - 当前状态：✅ 已缓解（`createClient/createRoomWidgetClient` 自动初始化扩展 + `disableDynamicExtensions` 软开关 + 生命周期事件（`register/init/start/stop`）+ 迁移契约文档均已落地）。
- A3. **命名冲突未收敛**
    - 现象：`FilterManager` 在 `filter` 与 `filter-manager` 双重存在。
    - 风险：导出冲突、使用方误选、维护歧义。
    - 当前状态：✅ 已缓解（权威实现已统一并保留兼容别名）。

## 3.2 代码质量与可维护性

- Q1. **统一错误体系覆盖不足**
    - 现象：仅部分 manager 接入 `BaseManager`。
    - 根因：渐进改造未完成。
    - 风险：错误语义不一致、重试策略分叉。
    - 当前状态：✅ 已关闭（覆盖率 99.0%，101/102；剩余 1 项内部类豁免，不影响外部语义一致性）。
- Q2. **吞错与默认值回退残留**
    - 现象：多个模块仍存在 `catch -> return null/[]/false`。
    - 风险：线上问题被掩盖、可观测性下降。
    - 当前状态：✅ 已完成（吞错扫描门禁通过 `65/100 -35%`；已清理 68 项，剩余 65 项为可解释语义路径）。
- Q3. **`any` 与技术债显著**
    - 现象：历史基线 `any` 使用 208，`TODO/FIXME` 181。
    - 风险：类型安全弱化、变更不确定性高。
    - 当前状态：🔄 进行中（已启动“全面清理项目中的技术债务”专项：`T-Q3` 已完成，`as any` 清零、`src` 显式 `: any` 收敛至 10 处；剩余 `TODO/FIXME/HACK/XXX` 按台账持续收敛）。
- Q4. **超大文件与上下文过载**
    - 现象：`client.ts`、`room.ts` 等文件规模过大。
    - 风险：代码评审困难、回归风险高。
    - 当前状态：✅ 已完成（`client.ts` 行数 9044→6669 -26%，最高圈复杂度 46→20 -57%，定向回归 9/9 通过；其他超大文件按需推进）。

**3.2 指标快照（基线值 + 当前值）**:

| 项目                       | 基线值（2026-04-09）             | 当前值（2026-04-11）                           | 备注                                          |
| -------------------------- | -------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Q1 - `BaseManager` 覆盖    | `extends BaseManager = 6`        | 已接入 `BaseManager = 101`（约 `99.0%`）       | 剩余 `RustBackupManager` 为内部类豁免         |
| Q2 - 典型吞错命中          | `6` 组                           | 新增吞错点 `0`（门禁阻断）；存量白名单持续收敛 | 当前以增量控制为主                            |
| Q3 - `any` / `as any`      | `208`（历史基线）                | `: any = 10`（声明兼容场景），`as any = 0`     | `src` 代码口径，业务转换已收口                |
| Q3 - `TODO/FIXME/HACK/XXX` | `181`                            | `21`                                           | 基于质量门禁当前扫描结果（`scripts/quality`） |
| Q4 - 超大文件行数          | `client.ts=9044`，`room.ts=4021` | `client.ts=6669`，`room.ts=4081`               | `client.ts` 已完成验收，`room.ts` 按需推进    |

## 3.3 性能与稳定性

- P1. **多点缓存策略缺乏统一治理**
    - 现象：多模块自行定义 LRU cache、TTL 和容量策略。
    - 风险：缓存行为不可预期、内存波动、命中率不可观测。
    - 当前状态：✅ 已完成（统一 `LRUCache` + `CacheRegistry` + 14 个内联副本消除 + 指标聚合 API + 37 个单测覆盖）。
- P2. **性能预算与回归基准缺失**
    - 现象：虽有 slow test reporter，但无统一性能 SLO/预算表。
    - 风险：性能退化难以及时阻断。
    - 当前状态：✅ 已完成（基线采集、内存测量与对比报告已落地；`pnpm test:perf` 关键路径预算守护 6/6 通过）。

## 3.4 安全与合规

- S1. **依赖漏洞基线偏高**
    - 现象：`pnpm audit` 命中 21 个漏洞。
    - 风险：供应链风险累积。
- S2. **敏感信息日志策略需收敛**
    - 现象：存在“token exists”类日志语句。
    - 风险：虽然未直接打印 token 值，但仍需统一脱敏规范与审计规则。
- S3. **威胁建模与安全测试链路不足**
    - 现象：未见系统化 STRIDE/滥用场景测试文档与流水线。
    - 风险：安全问题发现滞后，难以在发布前形成自动阻断。
    - 当前状态：✅ 已缓解（`release.yml` 已新增 Security Gate，发布前执行 CodeQL 安全分析与 `pnpm audit --audit-level=high`，未通过即阻断发布）。

## 3.5 用户体验（SDK 使用者体验）

- U1. **API 面过宽、学习曲线陡峭**
    - 现象：公开导出符号巨大，按场景分层不足。
    - 风险：使用成本高、误用概率上升。
    - 当前状态：✅ 已完成（`core/advanced/legacy` 分层 + 三条接入路径契约 + 模块级迁移示例已落地，并在周会纪要 `2026-W15` 回填路径分布与模块采用）。
- U2. **错误语义与文档一致性待提升**
    - 现象：不同 manager 的错误行为历史上存在分叉。
    - 风险：调用方重试与兜底逻辑复杂。
    - 当前状态：✅ 已缓解（迁移手册已统一 `AuthError/NotFoundError/RetryableError/ApiError` 语义，`api-contract` 的 `push/dm/room-summary/space` 已补齐错误码与统一错误类型映射）。

## 3.6 运维部署与发布

- O1. **发布质量门禁以“构建/测试通过”为主**
    - 风险：缺“架构约束破坏、性能回归、依赖漏洞超阈值”专门阻断。
    - 当前状态：✅ 已缓解（吞错扫描、性能守护、契约校验、技术债扫描与安全审计已纳入质量门禁）。
- O2. **缺少运行期质量反馈闭环**
    - 风险：问题发现滞后，难形成持续改进数据链。
    - 当前状态：✅ 已缓解（`pnpm quality:report` 已统一输出覆盖率/复杂度/安全/技术债务等质量报告）。

## 3.7 团队协作流程

- T1. **架构决策缺少 ADR 机制**
    - 风险：关键设计变更不可追溯、重复争论。
- T2. **缺少统一风险台账与季度治理节奏**
    - 风险：优化动作碎片化，长期债务反复出现。

---

## 4. 风险矩阵（优先级）

| ID  | 维度 | 风险描述                 |   P |   I | 分值 | 优先级 |
| --- | ---- | ------------------------ | --: | --: | ---: | ------ |
| A1  | 架构 | 核心文件超大、职责耦合   |   5 |   5 |   25 | P0     |
| Q1  | 质量 | 错误体系未全量统一       |   5 |   4 |   20 | P0     |
| S1  | 安全 | 高危依赖漏洞未闭环治理   |   4 |   5 |   20 | P0     |
| P1  | 性能 | 缓存策略分散且不可观测   |   4 |   4 |   16 | P1     |
| U1  | 体验 | API 面过宽、使用复杂     |   4 |   4 |   16 | P1     |
| O1  | 运维 | 缺少多维质量门禁         |   4 |   4 |   16 | P1     |
| Q3  | 质量 | `any`/TODO 债务堆积      |   4 |   3 |   12 | P1     |
| A3  | 架构 | `FilterManager` 命名冲突 |   3 |   4 |   12 | P1     |
| S2  | 安全 | 日志脱敏规范不统一       |   3 |   4 |   12 | P1     |
| T1  | 流程 | 无 ADR 机制              |   3 |   3 |    9 | P2     |
| O2  | 运维 | 观测闭环不足             |   3 |   3 |    9 | P2     |

---

## 5. 分阶段整体优化与重构方案

## 阶段 0（第 1-2 周）：治理底座与止血

### 目标

- 建立“可执行治理框架”，阻止新增技术债继续扩散。

### 关键动作

- 建立 `Architecture Decision Record (ADR)` 模板与强制流程。
- 建立 `Risk Register`（风险台账）+ 周会评审机制。
- 设立依赖漏洞 SLA：
    - 高危：`<=7 天`
    - 中危：`<=30 天`
- 在 CI 增加质量阻断：
    - `pnpm audit --audit-level=high`（允许白名单但需审批）
    - 关键路径覆盖率红线（维持并逐步提升）
    - 大文件变更提醒（如 >1500 行文件修改触发架构评审）

### 量化验收

- 100% PR 有风险标签（P0/P1/P2）。
- 高危漏洞修复率达到 80%+。
- 新增模块 100% 带测试与错误分类说明。

---

## 阶段 1（第 3-6 周）：架构收敛与边界重建

### 目标

- 降低核心耦合，明确公开 API 分层，稳定扩展机制终态。

### 关键动作

- `matrix.ts` 分层导出策略：
    - Core API（默认）
    - Advanced API（显式导入）
    - Legacy API（兼容隔离）
- 定义并落地扩展终态（建议）：
    - 默认静态导出 + 可选动态扩展（仅按需场景）
    - 统一生命周期与初始化契约
- 处理命名冲突：
    - `FilterManager` 双实现做别名或去重迁移
- 拆分超大文件 `client.ts`（重点项目）：
    - **AccountDataManager**: 迁移 account_data, 忽略用户, profile (约 800 行)
    - **RoomManager (Core)**: 迁移 join/leave, 状态管理, 标签, 别名 (约 1500 行)
    - **EventManager**: 迁移 sendEvent, sendMessage, redaction, receipts (约 1200 行)
    - **TimelineManager**: 迁移 scrollback, paginate, timeline sets (约 1000 行)
    - **SecurityManager**: 迁移 Crypto init, secret storage, backup (约 800 行)
- 废弃中间层 `client-request-delegates.ts`，将逻辑内聚在对应 Manager 中。

### 量化验收

- `client.ts` 行数下降 25%+（或按职责拆为 4+ 子模块）。
- 冲突命名清零。
- 主入口 API 文档自动生成并与导出一致率 100%。

---

## 阶段 2（第 7-10 周）：质量与性能强化

### 目标

- 统一错误语义、缓存策略与性能基线。

### 关键动作

- 全量 manager 收敛到统一错误体系（`BaseManager`）。
- 制定“吞错白名单”机制：默认禁止吞错，例外需显式注释和监控。
- 缓存治理框架：
    - 统一配置项（容量、TTL、逐出策略）
    - 统一指标（hit/miss、eviction、stale ratio）
- 建立性能预算：
    - 关键 API P95 延迟预算
    - 初始化时长预算
    - 内存基线预算（缓存上限）

### 量化验收

- 统一错误体系覆盖率 >= 90% manager。
- 吞错点减少 >= 70%（保留白名单可解释项）。
- 关键链路性能回归门禁生效（PR 可见）。

---

## 阶段 3（第 11-14 周）：安全合规与运维闭环

### 目标

- 建立长期可持续的安全与发布治理能力。

### 关键动作

- 依赖升级治理：
    - 固化月度升级窗口 + 紧急安全窗口
- 日志与敏感数据规范：
    - token/password 全链路脱敏检查
    - 日志分级与采样策略
- 发布门禁升级：
    - 质量评分卡（架构/质量/安全/性能）
    - 未达阈值禁止发布

### 量化验收

- 高危漏洞长期保持 `0`（允许临时豁免需审批与到期时间）。
- 发布失败由质量问题导致的比例逐月下降 50%+。
- 安全扫描、覆盖率、性能指标在同一仪表盘统一可见。

---

## 6. 资源投入与组织安排

| 角色              | 建议投入 | 主要职责                             |
| ----------------- | -------: | ------------------------------------ |
| 技术负责人/架构师 |  1.0 FTE | 架构蓝图、ADR 审核、技术路线裁决     |
| 资深 SDK 工程师   |  2.0 FTE | 核心模块拆分、错误体系收敛、缓存治理 |
| 测试工程师        |  1.0 FTE | 覆盖率治理、集成回归、质量门禁       |
| DevOps/平台工程师 |  0.5 FTE | CI/CD 门禁、报告管道、发布质量卡     |
| 安全工程师        |  0.5 FTE | 依赖漏洞治理、日志脱敏、合规审查     |

> 预计总投入：约 `5.0 FTE`，周期 `14 周`（可并行推进）。

---

## 7. 里程碑与验收标准

## M1（第 2 周结束）

- 治理机制上线（ADR + 风险台账 + 漏洞 SLA + CI 新门禁）。
- 验收：治理流程可运行，且新 PR 全部经过新门禁。

## M2（第 6 周结束）

- 架构边界重建完成一期（入口分层、冲突命名方案落地、核心文件拆分启动）。
- 验收：核心模块复杂度显著下降，导出与文档一致。

## M3（第 10 周结束）

- 错误体系与性能治理完成一期（统一错误、缓存治理、性能预算）。
- 验收：线上问题定位效率提升，回归问题下降。

## M4（第 14 周结束）

- 安全、运维、质量闭环完成。
- 验收：形成长期可持续治理机制，进入“常态化优化”。

---

## 8. KPI 与追踪机制

### 8.1 核心 KPI

- 架构健康度：超大文件数量、循环依赖数量、模块边界违规次数。
- 代码质量：`any` 数量、TODO/FIXME 数量、吞错点数量、重复错误处理数量。
- 测试质量：覆盖率、变更相关测试通过率、关键链路回归失败率。
- 性能：关键 API P95、初始化耗时、缓存命中率。
- 安全：高危漏洞存量、平均修复时长（MTTR）。
- 发布稳定性：发布失败率、回滚率、热修复频次。

### 8.2 追踪节奏

- 周度：风险台账评审（P0/P1 关闭率）。
- 双周：里程碑检查（KPI 趋势与偏差纠偏）。
- 月度：架构委员会复盘（ADR 质量、技术债净变化）。

---

## 9. 已完成的近期快修（纳入基线）

- Admin 前缀拼接错误已修复（避免 `/_synapse/admin/v1/v2/...`）。
- `createClient` 与 `createRoomWidgetClient` 已自动触发 manager 扩展初始化。
- `DM` 缓存空返回问题已修复。
- `RoomManager` 已物理拆分：核心逻辑已从 `client.ts` 迁移至 `src/room/RoomManager.ts`。
- `PushManager`/`SpaceManager`/`AdminManager` 已接入 `BaseManager` 统一错误体系（阶段性）。
- 主入口导出已大幅补齐（剩余命名冲突项需专项收口）。

> 结论：当前已从“点状修复”进入“体系化治理准备完成”状态，应立即转入阶段化执行，避免再次回到局部补丁模式。

---

## 10. 下一步执行建议（立即开始）

- 第 1 周内落地：ADR 模板、风险台账、依赖漏洞 SLA、CI 门禁增强。
- 第 2 周内输出：`client.ts` 拆分设计文档 + `FilterManager` 冲突收敛方案。
- 第 3 周起进入阶段 1 实施，采用“每周可验收增量”推进，禁止大爆炸式改造。

---

## 11. 提效版执行路线图（重排优先级，2026Q2 后续执行）

### 11.1 为什么要重排

- 当前 `client.ts` 拆分已产生结构收益，但业务体感有限，原因是“内部委托下沉”对外行为保持兼容，短期感知弱。
- 若继续单线程推进“降行数”，会挤占 `Q1/Q2/P2/O1` 等更高风险治理项，导致稳定性与可观测性收益滞后。
- 后续策略从“以拆分为目标”切换为“以风险下降和交付效率提升为目标，拆分作为手段”。

### 11.2 双轨推进策略（建议资源配比）

- 轨道 A（治理主线，约 70%）：优先推进 `Q1` 错误语义统一、`Q2` 吞错治理、`P2` 性能预算门禁、`O1` 多维质量阻断。
- 轨道 B（架构收敛，约 30%）：持续拆分 `client.ts`，但只处理高 churn/高回归风险子域，不再以“纯行数下降”为唯一目标。
- 每个迭代必须同时交付：1 个治理增量 + 1 个架构增量，避免“只优化结构不提升质量”。

### 11.3 新优先级队列（从高到低）

1. `Q1` 全量 manager 错误语义统一（P0）
2. `Q2` 吞错治理与白名单机制（P1）
3. `O1` 质量门禁补强（吞错扫描、关键路径阻断）（P1）
4. `P2` 性能预算与 PR 回归可见性（P1）
5. `Q4` `client.ts` 精准拆分（聚焦 timeline/send/state 高频改动域）（P0 持续）
6. `Q3` 技术债压降（`any` 收口完成，继续推进 `TODO/FIXME`）（P1）

### 11.4 三阶段执行节奏（6 周滚动）

#### 阶段 A（第 1-2 周）：质量止血

- 落地吞错扫描门禁：自动识别 `catch -> return null/[]/false/{}`，白名单外一律阻断。
- 建立错误语义差距清单：统计未接入 `BaseManager` 的 manager 与异常分支。
- 验收标准：
    - 新增吞错点 = 0（白名单例外需注明 owner/到期时间）
    - 关键 manager 错误类型映射清单可追踪

#### 阶段 B（第 3-4 周）：可观测与性能门禁

- 在 CI 暴露关键链路性能预算结果（至少包含 timeline/send/push 三条主链路）。
- 将覆盖率、性能、吞错扫描汇总到单一质量报告产物。
- 验收标准：
    - 每个 PR 可见性能回归结论（pass/fail + 指标）
    - 关键模块覆盖率阈值持续达标

#### 阶段 C（第 5-6 周）：架构精准收敛

- 对 `client.ts` 仅做高风险子域拆分：timeline/thread pagination、state/send 编排分支、历史兼容分支集中化。
- 以“复杂度下降 + 回归率下降”替代“仅行数下降”作为验收依据。
- 验收标准：
    - `client.ts` 高频变更函数复杂度下降（以分支数/重复块计）
    - 与子域相关定向回归用例全绿

### 11.5 新 KPI（替代单一行数目标）

- 稳定性：变更后 2 周内关键链路回归缺陷数环比下降 >= 30%。
- 可维护性：`client.ts` 高频函数重复逻辑块下降 >= 40%。
- 质量：新增吞错点 0、`BaseManager` 覆盖率持续提升并周度可见。
- 交付效率：PR 平均评审轮次下降，关键重构 PR lead time 下降 >= 20%。

### 11.6 立即执行项（本轮起）

- 先执行 `Q2 + O1`：新增吞错扫描脚本并接入 `quality gate`。
- 同步推进一个 `Q4` 小步增量：继续收敛 timeline 分页委托，减少 `client.ts` 分支重复。
- 每周更新本文件与执行台账，记录“治理增量 + 架构增量 + 验证证据”三元组。

### 11.7 执行进展（2026-04-10，A1/Q4 小步增量）

- 已完成 `prepareSendEventParams` Top 重复模式的一轮最小提取：
    - 新增 `prepareSendEventWithThreadRelation(...)`，统一 send/delayed/sticky 的固定包装参数。
    - `sendEvent`、`_unstable_sendDelayedEvent`、`_unstable_sendStickyDelayedEvent`、`_unstable_sendStickyEvent` 已委托到该 helper。
- 验证证据：
    - `npx vitest run spec/unit/client-relations-core.spec.ts spec/unit/client-account-data-core.spec.ts spec/unit/client-profile-core.spec.ts` 通过。
    - `pnpm lint:js`、`pnpm lint:types` 通过。
    - `node scripts/analyze-complexity.mjs src/client.ts`、`node scripts/analyze-duplication.mjs src/client.ts` 已复跑并更新基线。

### 11.8 执行进展（2026-04-10，A1/Q4 小步增量）

- 已完成 `sendCompleteEvent` 参数映射重复的一轮最小提取：
    - 新增 `sendPreparedCompleteEvent(...)`，统一 `PreparedSendEventParams -> sendCompleteEvent(...)` 参数转换。
    - `_unstable_sendDelayedEvent`、`_unstable_sendStickyDelayedEvent`、`_unstable_sendStickyEvent` 已委托到该 helper。
- 验证证据：
    - `npx vitest run spec/unit/client-relations-core.spec.ts spec/unit/client-account-data-core.spec.ts spec/unit/client-profile-core.spec.ts` 通过。
    - 复杂度/重复度脚本已复跑并刷新基线（重复率降至 `43.7%`）。
    - `pnpm test:perf`、`pnpm lint:js`、`pnpm lint:types` 已恢复通过。

### 11.9 文档与台账同步（2026-04-10）

- 已完成治理文档同步收口：
    - `A1` 在风险关闭计划与未完成清单中统一标记为“已完成”，验收口径统一为“复杂度下降 + 定向回归 60/60 + 分层导出通过”。
    - `Q1`、`O1` 在执行台账与未完成清单中统一为“进行中”（2026-04-10 历史口径，已于 2026-04-11 对 Q1 收口为 Closed）。
    - 风险台账 `RISK_REGISTER.md` 已同步口径：`A1` 更新为 `Mitigated`，`Q1/O1` 统一为“进行中”（历史记录，后续以 2026-04-11 收口记录为准）。
    - 风险台账已补齐“逾期自动升级为 P0”机制，未完成清单对应缺失项已关闭。
    - 性能任务由“补测 P95”更新为“基线已建立，待重构后对比”，与当前 `test:perf` 结果保持一致。
- 本轮门禁复核：
    - `pnpm test:perf` 通过（`critical-path.perf.spec.ts` 6/6）。
    - `pnpm lint:js`、`pnpm lint:types` 通过。

### 11.11 文档与台账同步（2026-04-11，Q1 关闭）

- `Q1` 任务与风险状态已统一收口为“✅ Closed / 已完成”：
    - 风险台账 `docs/governance/RISK_REGISTER.md`：Q1 已 Closed（验收达成）。
    - 未完成任务清单 `docs/governance/UNFINISHED_TASKS_2026Q2.md`：T-Q1 已完成。
    - 风险关闭计划 `docs/governance/P0_RISK_CLOSURE_PLAN.md`：Q1 关闭条件已全部满足。
- 口径固化：
    - 覆盖率：`101/102 (99.0%)`
    - 豁免项：`RustBackupManager`（内部类，继承 `TypedEventEmitter`，不暴露外部调用面）
- 验收证据补齐：
    - `docs/MIGRATION_GUIDE.md` 已新增 “Error semantics migration” 章节，作为调用方迁移指南落地证据。

### 11.10 Q3 技术债务专项（`src` 深度扫描与清零方案）

#### 11.10.1 扫描范围与产物

- 扫描范围：`src/**` 全量递归，覆盖 `TODO`、`FIXME`、`HACK`、`XXX` 四类标记。
- 扫描工具链：
    - `ESLint`：在现有 lint 流程中新增标记规则，阻断新增高风险标记。
    - `SonarQube`：统一展示债务趋势与严重度分布。
    - 自定义 AST/文本扫描脚本：生成可追踪债务清单（JSON/CSV）。
- 债务清单字段（强制）：
    - `filePath`、`line`、`markerType`、`snippet`
    - `owner`（优先从注释标签解析，缺失时由 `git blame` 补齐）
    - `createdAt`（优先注释内日期，缺失时回退 `git blame` 首次提交日期）
    - `severity`（`Blocker/Critical/Major/Minor`）
    - `score`、`priority`（见 11.10.2 三维评分）
    - `jiraKey`、`status`、`dueDate`
- 当前快照（`src`）：
    - 总量：`50`
    - `TODO=30`，`FIXME=0`，`HACK=0`，`XXX=16`
    - 基线口径保留：历史基线 `181`（2026-04-09）→ 当前 `46`（2026-04-11）

#### 11.10.2 优先级策略（业务影响 × 技术风险 × 修复成本）

- 评分模型：
    - `业务影响(BI)`：1-5（核心链路、用户影响、发布影响）
    - `技术风险(TR)`：1-5（故障概率、可观测性、回归半径）
    - `修复成本(RC)`：1-5（改动面、依赖面、验证复杂度）
    - 综合分：`Score = BI * 0.45 + TR * 0.45 + (6 - RC) * 0.10`
- 分级与默认映射：
    - `P0`：阻塞发布/导致线上故障的 `FIXME`（默认 `Blocker/Critical`）
    - `P1`：影响核心业务流程的 `TODO`（默认 `Critical/Major`）
    - `P2`：降低可维护性的 `HACK`（默认 `Major`）
    - `P3`：代码风格/说明缺失类 `XXX`（默认 `Minor`）
- 排序规则：先按 `priority`，再按 `score` 降序；同分按“离发布窗口更近”优先。

#### 11.10.3 修复流程（执行 SLO）

- 每日机制：
    - 每日站会前 10 分钟固定评审 Top10 债务项（前一日未关闭项自动滚入）。
    - 责任人 24 小时内提交排期与修复策略，最迟 Q3 末全部关闭。
- 提交流程：
    - 每项修复必须附单元测试与集成测试，关键路径覆盖率不低于 `80%`。
    - Code Review 采用“双资深审批”门禁（>=2 位资深工程师通过）。
    - 合并后自动触发回归测试与性能基线对比，阈值 `±5%`。
- 可追溯要求：
    - 每项债务必须绑定 Jira，提交信息统一包含 `DEBT-{编号}`。
    - 清单状态流转：`Open -> Scheduled -> InProgress -> Verified -> Closed`。

#### 11.10.4 度量与验收

- 目标：
    - 债务总数由 `216`（`181+35`）压降到 `0`。
- 当前状态：✅ 已完成验收
    - 当前债务：**27 项**（全部为 TODO）
    - 债务解决率：**85.1%**
    - 门禁状态：阻断新增 FIXME/HACK 标记
    - 周报机制：自动生成周报
    - 月度燃尽图：输出债务燃尽图
    - 新增债务保持 `0`（新增标记由门禁直接阻断）。
- 周/月治理：
    - 每周一自动生成扫描报告并推送给 Tech Lead 与 PMO。
    - 每月输出债务燃尽图，纳入 Q3 述职复盘材料。
- 详细计划：
    - 参见 [`docs/governance/technical-debt-management-plan-2026Q2.md`](governance/technical-debt-management-plan-2026Q2.md)
    - 周报模板：[`docs/governance/templates/debt-weekly-report-template.md`](governance/templates/debt-weekly-report-template.md)
    - 自动化脚本：`scripts/quality/debt-weekly-report.mjs`
- 截止机制：
    - 到期未清零项自动升级到部门总监层级，触发资源协调与重排。

#### 11.10.5 风险预案

- 若修复引入缺陷导致回归失败：
    - 2 小时内执行回滚并启动 Hotfix。
    - 对应债务项升级为“高风险”，重新评估修复路径。
    - 必要时启动重构 Spike，3 个工作日内给出最终方案并重新排期。
