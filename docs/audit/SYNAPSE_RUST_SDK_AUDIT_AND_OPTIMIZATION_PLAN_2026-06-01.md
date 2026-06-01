# Synapse Rust SDK 审查与优化方案（2026-06-01）

## 审查基线

- 后端基线：`/Users/ljf/Desktop/hu_ts/synapse-rust` 当前路由 ledger、`/_matrix/client/versions`、`/_matrix/client/v3/capabilities` 与生成契约。
- SDK 基线：`/Users/ljf/Desktop/hu_ts/matrix-js-sdk` 当前 `src/*/__generated__` 契约层、manager 封装层、real-backend 测试入口。
- 协议纪律：稳定 Matrix 能力只按后端真实实现声明；Hula/MSC 扩展必须通过 `unstable_features`、`capabilities` 与 route manifest 三者之一提供可审计证据。

## 主要发现

### 高优先级

- `ServerCapabilitiesManager.getServerCapabilities()` 直接请求 `/_matrix/client/v3/capabilities`，在默认 `ClientPrefix.V3` 下存在双前缀风险；应统一使用 `"/capabilities" + ClientPrefix.V3`。
- SDK 对 synapse-rust/Hula 扩展能力的判断分散在各 manager 中，容易只看 `/versions.unstable_features` 而漏掉 `/capabilities` 中的 authenticated/private 扩展能力。
- 后端已经把 `org.matrix.msc3886.sliding_sync`、`org.matrix.msc3814`、`uk.tcpip.msc4133`、`io.hula.friends`、`io.hula.burn_after_read`、`org.matrix.msc4261.widget` 绑定到 route evidence；SDK 需要对应的集中解析层。

### 中优先级

- 契约生成文件已覆盖大量模块，但 generated route-table 与 runtime manager 的使用路径仍需要持续做 contract assertion，防止“文档有、运行时不用”。
- real-backend 测试依赖本地服务状态，建议对版本/能力探测增加更快的 smoke gate，避免完整链路失败时反馈太慢。
- 部分 Hula 扩展模块仍存在 v1/v3/r0 混用，SDK 应优先从能力发现结果选择后端推荐路径，而不是在业务 manager 中硬编码回退顺序。

### 低优先级

- 当前仓库存在大量未提交生成文件，短期不适合做大规模重排；应先收敛能力解析、路径前缀、契约校验这类小而硬的根因问题。
- 测试与文档中的历史优化报告较多，后续可整理成一个活跃路线图，降低维护者检索成本。

## 已实施优化

- 修正 `ServerCapabilitiesManager.getServerCapabilities()` 的请求路径，使用 `ClientPrefix.V3` 组合 `/capabilities`。
- 新增 synapse-rust/Hula feature 常量、类型与解析函数，统一从 `/versions.unstable_features` 与 `/capabilities` 别名判断能力。
- 在 `MatrixClient` 暴露 `doesServerAdvertiseSynapseRustFeature()` 与 `getSynapseRustFeatureSupport()`，业务 manager 可逐步迁移到集中能力入口。
- 能力探测在 authenticated `/capabilities` 不可用时保留 `/versions` 证据，避免登录前或 token 异常时把公开能力误判为不支持。
- `BurnAfterReadManager.isBurnEnabled()` 接入集中 feature discovery，服务器未声明 `io.hula.burn_after_read` 时不再盲探房间设置接口。
- `FriendManager.isSupported()` 与 `WidgetsManager.isSupported()` 复用同一个 feature discovery 辅助函数，保留旧客户端默认兼容行为。
- 新增单元测试覆盖能力路径、feature 解析和 capability alias 回退。
- `RoomManager.isSlidingSyncSupported()` 与 `MatrixClient.isSlidingSyncSupported()` 接入集中 feature discovery，避免 sliding-sync 只依赖调用方硬编码判断。
- `DehydratedDeviceManager.isSupported()` 已由集中 feature discovery 驱动，并补齐单元测试固定 fallback 与不支持场景。
- 增加 runtime manager 到生成 `route-table` 的轻量 contract test，覆盖 auth、friend、burn-after-read、sliding-sync、secure-backup。
- 增加 real-backend smoke gate，快速输出 `/versions`、`/capabilities` 与核心 Hula 扩展矩阵；默认 real-backend 批次先跑 smoke。
- `contract:check` 已串联 `contract-sync --check` 与 `sdk-contract-codegen --check`，后端 ledger 更新后可同时拦截 generated manifest 与 SDK route-table 漂移。

## 后续路线

1. 将集中 feature discovery 继续推广到 voice、openclaw、ai-connection 等 Hula 扩展 manager，形成统一 `isSupported()` 语义。
2. 将 runtime manager route-table contract test 扩展到 room、push、device、verification 等高频 Matrix 核心模块。
3. 收敛当前 generated contract hash mismatch，执行 `contract:sync` + `contract:codegen` 后复跑 `contract:check`，把当前 ledger 基线重新钉住。
4. 梳理 v1/v3/r0 混用模块，在不破坏兼容性的前提下优先使用能力发现结果选择后端推荐路径。
