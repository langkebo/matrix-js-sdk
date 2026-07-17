# client.ts 功能重叠分析与模块化拆分蓝图（A1/Q4 联动）

## 1. 目标与约束

- 目标：消除 `src/client.ts` 中重复实现，建立可复用模块，持续降低单文件复杂度与回归风险。
- 约束：
    - 行为兼容优先，不改变对外 API 语义。
    - 拆分后由 `client.ts` 负责业务编排，helper 模块负责“纯构造/纯判定/纯流程片段”。
    - 每一轮拆分必须附带质量门禁与测试证据。

## 2. 重叠功能盘点（现状）

### 2.1 请求构造类重叠

- 路径构造重复：大量 `encodeUri(...)` 在 `client.ts` 中分散实现。
- 查询参数/请求体构造重复：
    - 多处 `limit/dir/from/filter` 组合。
    - `lazy_load_members` filter 合并逻辑重复出现。
    - `membership` 相关 `user_id/reason` body 组装重复。

### 2.2 流程编排类重叠

- “预处理 -> 请求 -> 结果归一化”三段式逻辑在多个领域重复：
    - auth/token 请求
    - event context 请求
    - room upgrade predecessor/successor 遍历
    - membership 相关操作

### 2.3 可复用业务逻辑与工具函数

- 可复用业务逻辑：
    - `room upgrade` 链路遍历与循环防护
    - `receipt/thread` 判定
    - `auth metadata` 回退流程
- 可复用工具函数：
    - path builder
    - params/body builder
    - 兼容分支选择器（稳定/unstable prefix）

## 3. 模块划分策略（单一职责）

### 3.1 已落地模块

- `client-auth.ts`：认证 token 参数构造、`getAuthMetadata` 回退流程
- `client-receipts.ts`：receipt/thread 判定、解密后通知计数修正
- `client-membership.ts`：invite/leave/ban/kick/unban/forget 的参数与路径构造
- `client-room-upgrade.ts`：predecessor/successor 遍历与循环防护
- `client-timeline-requests.ts`：`/messages`、`/threads`、`/context` 的 path/params 构造
- `client-timeline-core.ts`：timeline 响应归一化与分页结果映射
- `client-timeline-pagination.ts`：`paginateEventTimeline` 主流程编排片段
- `client-account-data-requests.ts`：account data/tag/filter path 与请求组装、删除前缀选择
- `client-profile-requests.ts`：profile/extended profile path/body 构造与前缀选择
- `client-room-state-requests.ts`：state event 查询/设置请求构造

### 3.2 待拆分模块（下一阶段）

- `client-account-data-core.ts`（候选）
    - `set/get/delete account_data` 的流程片段抽离（能力判定、fallback、store 同步策略）
- `client-profile-core.ts`（候选）
    - extended profile 的能力检查与异常语义统一（支持判定、错误映射）
- `client-relations-core.ts`（候选）
    - relations/send 相关上下文处理与参数归一化

## 4. 模块边界与依赖规则

- `client.ts`（编排层）只调用模块函数，不内嵌复杂构造细节。
- helper 模块（构造层）规则：
    - 无网络副作用（除显式流程函数外）
    - 输入输出尽量使用基础类型与 SDK 公共类型
    - 禁止反向依赖 `client.ts`（仅允许 `type` 引用，且优先避免）
- 依赖方向：
    - `client.ts` -> `client-*.ts helper`
    - helper -> `utils/filter/types/models`（只读依赖）

## 5. 命名规范与目录结构

- 命名规范：
    - Path 构造：`build*Path`
    - Query/Body 构造：`build*Params` / `build*Body`
    - 归一化：`normalize*`
    - 选择器/判定：`select*` / `is*`
- 目录结构（当前）：
    - `src/client-*.ts`：client 辅助模块
    - `spec/unit/client-*.spec.ts`：对应模块单测

## 6. 标准化重构流程

1. 依赖梳理：定位重复点与调用图，确认可抽离边界。
2. 接口定义：先定义 helper 输入/输出类型。
3. 模块落地：新增 helper 并迁移纯逻辑。
4. 编排适配：`client.ts` 改为委托调用。
5. 测试补齐：新增 helper 单测 + 关键链路集成回归。
6. 门禁验证：`quality:contracts` + 目标测试集通过。
7. 文档同步：更新执行台账与拆分记录。

## 7. 迁移顺序规划（建议）

1. 请求构造层（低风险）：timeline/profile/account-data
2. 纯判定层（中风险）：timeline pagination 判定、thread 分支
3. 流程片段层（中高风险）：send/relations 上下文处理
4. 仅在覆盖充分后推进对外行为相关路径（高风险）

## 8. 本轮一次性实施清单（已执行）

- 代码迁移：
    - `paginateEventTimeline` 主流程委托到 `client-timeline-pagination.ts`
    - 6 个 token 请求入口统一委托 `client-auth.ts:requestTokenFromEndpoint`
    - `deleteAccountData` 前缀选择逻辑下沉到 `client-account-data-requests.ts:selectDeleteAccountDataRequestOptions`
    - extended profile prefix 选择逻辑下沉到 `client-profile-requests.ts:selectExtendedProfileRequestPrefix`
    - `client.ts` 对应逻辑改为 helper 委托调用
- 依赖更新：
    - `client-request-delegates.ts` 补充新 helper 导出并统一入口
    - `core.ts` 类型导出改为 `export type *`，修复类型导出规则错误
    - 调整 `scheduled-events` 与 `matrix-client-extensions.d.ts` 的不稳定 API 声明写法，兼容命名规范校验
- 接口适配：
    - 保持 `MatrixClient` 对外方法签名不变
    - helper 仅承接内部构造/归一化逻辑
- 质量修复：
    - 修复 `sliding-sync-sdk.ts` / `sliding-sync.ts` 的 `no-console` 错误
    - 修复 `voice/index.ts` 部分未使用参数/类型告警

## 9. 验证策略与测试矩阵

- 单元测试：
    - 已有：`client-send-*`、`client-thread-relations`、`client-internals`
    - 已新增：`spec/unit/client-timeline-requests.spec.ts`
    - 已新增：`spec/unit/client-account-data-requests.spec.ts`（删除前缀选择覆盖）
    - 已新增：`spec/unit/client-profile-requests.spec.ts`（profile prefix 选择覆盖）
- 集成测试：
    - `spec/integ/matrix-client-event-timeline.spec.ts`（context/getEventTimeline）
    - `matrix-client-methods` 针对 membership 路径
- 质量门禁：
    - `pnpm quality:contracts`（exports + entrypoints）
    - `pnpm lint:types`
    - 改动文件范围 `pnpm eslint ...`

## 10. 验收标准（A1/Q4 对齐）

- A1（边界治理）：导出契约与分层门禁稳定通过。
- Q4（文件拆分）：`client.ts` 持续下降，重复构造逻辑迁移到 `client-*.ts`。
- 兼容性：关键链路测试通过，对外 API 不变。

## 11. 本轮代码审查与质量修复（2026-04-10）

### 11.1 质量修复结果

- 已清理 `src` 侧阻断性 ESLint 问题（命名规范 + 未使用变量/参数）并完成格式化对齐。
- 修复重点：
    - 事件 map 的 snake_case 命名规则冲突，改为 `Record<...>` 类型声明承载字面量事件名。
    - 多处未使用 import/参数导致的 `no-unused-vars` 噪音，统一清理或改 `_` 前缀。
    - `utils.sortEventsByLatestContentTimestamp` 从占位实现改为基于 `m.ts` 的稳定排序逻辑。
- 验证结果：
    - `pnpm lint:js` ✅
    - `pnpm lint:types` ✅
    - `pnpm lint` ⚠️ `quality:swallow-fallbacks` 仍有仓库级存量规则项（含 baseline/new 列表），不属于 `client.ts` 模块拆分核心链路，需在专项质量轮次集中清理。

### 11.2 已拆分模块整理（按职责域）

- 鉴权与会话：
    - `client-auth.ts`
- 时间线与分页：
    - `client-timeline-requests.ts`
    - `client-timeline-core.ts`
    - `client-timeline-pagination.ts`
- 账号数据与资料：
    - `client-account-data-requests.ts`
    - `client-profile-requests.ts`
- 成员关系与回执：
    - `client-membership.ts`
    - `client-receipts.ts`
- 房间升级与状态：
    - `client-room-upgrade.ts`
    - `client-room-state-requests.ts`
- 发送链路（已形成独立簇，待进一步流程收束）：
    - `client-send-args.ts`
    - `client-send-event.ts`
    - `client-send-http.ts`
    - `client-send-lifecycle.ts`
    - `client-send-message.ts`
    - `client-send-paths.ts`
    - `client-send-redaction.ts`
    - `client-send-request.ts`
    - `client-send-state.ts`
    - `client-send-execution.ts`
    - `client-send-complete.ts`
    - 后续收束重点：
        - 继续下沉 `client.ts` 中残留的 send/relations 编排判断，目标是只保留入口级 orchestration。
        - 为 `client-account-data-core.ts`、`client-profile-core.ts`、`client-relations-core.ts` 建立最小接口骨架与单测基线。
        - `quality:swallow-fallbacks` 新增项已按模块 owner 分桶并完成一轮规则合规清理（见 11.4）。

### 11.3 下一轮建议（聚焦 A1/Q4）

- 继续下沉 `client.ts` 中残留的 send/relations 编排判断，目标是只保留入口级 orchestration。
- 为 `client-account-data-core.ts`、`client-profile-core.ts`、`client-relations-core.ts` 建立最小接口骨架与单测基线。
- 将 `quality:swallow-fallbacks` 的新增项按模块 owner 分桶，独立推进规则合规，避免与功能拆分耦合。

### 11.4 质量专项进展（quality:swallow-fallbacks）

- 本轮完成 `NEW` 项分桶与批量修复，按模块 owner 处理如下：
    - `dm`：1 项
    - `external-service`：2 项
    - `friend`：1 项
    - `guest`：4 项
    - `rendezvous`：1 项
    - `room-alias`：4 项
    - `room`：1 项
    - `saml`：2 项
    - `space`：1 项
    - `sticky-event`：1 项
    - `tags`：1 项
    - `thirdparty`：6 项
    - `typing`：1 项
    - `webrtc`：1 项
- 修复策略：仅补齐 `@swallow-error { owner, expires }` 白名单注释，不改动业务分支与返回值语义。
- 校验结果：
    - `pnpm quality:swallow-fallbacks` ✅（`NEW` 清零，`quality gate passed`）
    - `pnpm lint` ⚠️ 当前被 `src/threading/index.ts` 的既有 TypeScript 类型错误阻断（与本轮 swallow-fallbacks 注释补齐无关）。

### 11.5 剩余任务推进（最小化改动，避免过度优化）

- 范围控制：
    - 本轮仅处理蓝图中 11.3 列出的三项剩余任务，优先抽离纯逻辑 helper，不改动对外 API 与请求语义。
- send/relations 编排下沉：
    - 新增 `client-relations-core.ts`，将 `relations(...)` 中“加密关系事件解密 + 请求事件类型过滤 + Replace 同 sender 过滤”下沉为 `processRelationEvents(...)`。
    - `client.ts` 仍保留入口编排（拉取原事件/关系事件、映射结果返回），仅把可复用流程片段委托到 core helper。
- account-data/profile core 骨架：
    - 新增 `client-account-data-core.ts`：封装 store 优先读取判定、`M_NOT_FOUND` 判定、删除 fallback 判定。
    - 新增 `client-profile-core.ts`：封装 extended profile 支持性断言。
    - `client.ts` 对应路径改为调用上述 core helper，保持行为兼容。
- 单测基线：
    - 新增 `spec/unit/client-relations-core.spec.ts`
    - 新增 `spec/unit/client-account-data-core.spec.ts`
    - 新增 `spec/unit/client-profile-core.spec.ts`
- 本轮校验：
    - `npx vitest run spec/unit/client-account-data-core.spec.ts spec/unit/client-profile-core.spec.ts spec/unit/client-relations-core.spec.ts` ✅
    - `pnpm lint:types` ✅
    - `pnpm lint:js` ⚠️ 仍被仓库既有命名规范问题阻断（`src/state-send/index.ts`、`src/threading/index.ts`、`src/timeline/index.ts`），与本轮 core 下沉改动无关。

### 11.6 A1/Q4 基线度量更新（complexity/duplication）

- 基线与脚本：
    - `docs/governance/perf-baseline/complexity-baseline.json`
    - `docs/governance/perf-baseline/duplication-baseline.json`
    - `scripts/analyze-complexity.mjs`
    - `scripts/analyze-duplication.mjs`
- 执行命令：
    - `node scripts/analyze-complexity.mjs src/client.ts`
    - `node scripts/analyze-duplication.mjs src/client.ts`
- complexity 基线结果（`src/client.ts`）：
    - `totalFunctions`: 107
    - `totalComplexity`: 358
    - `avgComplexity`: 3.3
    - 高复杂度函数：`constructor` (20)，`relations` (6，已从入口抽离部分后处理到 `client-relations-core.ts`)
- duplication 基线结果（`src/client.ts`）：
    - `totalLines`: 6660
    - `duplicates.totalBlocks`: 593
    - `duplicates.totalLocations`: 1592
    - `duplicates.duplicationRate`: 44.5%
- 结论（避免过度优化）：
    - 本轮仅更新 A1/Q4 度量基线与分析输入，不做额外大规模重写。
    - 下一轮优先针对重复度 Top 模式（send 包装与 delayed-event 支持判定）做小步提取并复测基线变化。

### 11.7 A1/Q4 续推进（delayed/sticky 能力判定去重）

- 最小化改动：
    - 在 `client.ts` 内新增 `assertDelayedEventsSupported(...)` 与 `assertStickyEventsSupported(...)` 私有 helper。
    - 将 `_unstable_sendDelayedEvent`、`_unstable_sendStickyDelayedEvent`、`_unstable_sendDelayedStateEvent`、`_unstable_sendStickyEvent`、`_unstable_getDelayedEvents`、`_unstable_updateDelayedEvent`、`updateScheduledDelayedEvent` 的重复能力判定统一委托到 helper。
    - 保持异常类型与 `clientEndpoint` 参数语义不变，不改动对外 API。
- 本轮验证：
    - `pnpm lint:types` ✅
    - `pnpm lint:js` ✅
    - `npx vitest run spec/unit/client-relations-core.spec.ts spec/unit/client-account-data-core.spec.ts spec/unit/client-profile-core.spec.ts` ✅
- 复测基线（`src/client.ts`）：
    - complexity：`totalFunctions 107`、`totalComplexity 358`、`avgComplexity 3.3`（总体稳定）
    - duplication：`totalBlocks 584`（由 593 ↓）、`totalLocations 1563`（由 1592 ↓）、`duplicationRate 44.0%`（由 44.5% ↓）

### 11.8 A1/Q4 续推进（prepareSendEventParams 重复包装最小提取）

- 最小化改动：
    - 在 `client.ts` 新增私有 helper：`prepareSendEventWithThreadRelation(...)`，统一 `prepareSendEventParams(...)` 的固定包装参数（`EVENT_ID_PREFIX`、`THREAD_RELATION_TYPE.name`、`getThread` 回调）。
    - 将 `sendEvent`、`_unstable_sendDelayedEvent`、`_unstable_sendStickyDelayedEvent`、`_unstable_sendStickyEvent` 四处重复包装改为委托 helper。
    - 保持对外方法签名、发送流程与异常语义不变。
- 本轮验证：
    - `npx vitest run spec/unit/client-relations-core.spec.ts spec/unit/client-account-data-core.spec.ts spec/unit/client-profile-core.spec.ts` ✅
    - `pnpm lint:js` ✅
    - `pnpm lint:types` ✅
- 复测基线（`src/client.ts`）：
    - complexity：`totalFunctions 104`、`totalComplexity 352`、`avgComplexity 3.4`
    - duplication：`totalBlocks 586`、`totalLocations 1560`、`duplicationRate 44.1%`
- 结果解读（避免过度优化）：
    - 本轮目标是“Top 重复模式的局部可维护性去重”，已实现 `prepareSendEventParams` 包装单点收口。
    - 全局重复率短期有轻微波动，后续继续按 Top 模式做小步提取并以回归测试与门禁结果兜底。

### 11.9 A1/Q4 续推进（sendCompleteEvent 参数包装最小提取）

- 最小化改动：
    - 在 `client.ts` 新增私有 helper：`sendPreparedCompleteEvent(...)`，统一 `PreparedSendEventParams -> sendCompleteEvent(...)` 的参数映射。
    - 将 `_unstable_sendDelayedEvent`、`_unstable_sendStickyDelayedEvent`、`_unstable_sendStickyEvent` 三处重复映射改为委托 helper。
    - 保持入口方法签名、延时/粘性事件语义与异常行为不变。
- 本轮验证：
    - `npx vitest run spec/unit/client-relations-core.spec.ts spec/unit/client-account-data-core.spec.ts spec/unit/client-profile-core.spec.ts` ✅
    - `pnpm test:perf` ✅（`spec/perf/critical-path.perf.spec.ts` 6/6 通过）
    - `pnpm lint:js` ✅
    - `pnpm lint:types` ✅
- 复测基线（`src/client.ts`）：
    - complexity：`totalFunctions 105`、`totalComplexity 354`、`avgComplexity 3.4`
    - duplication：`totalBlocks 582`、`totalLocations 1548`、`duplicationRate 43.7%`
