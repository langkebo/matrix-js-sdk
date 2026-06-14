# Synapse Rust SDK 审查与优化方案（2026-06-01）

## 审查基线

- 后端基线：`/Users/ljf/Desktop/hu_ts/synapse-rust` 当前路由 ledger、`/_matrix/client/versions`、`/_matrix/client/v3/capabilities` 与生成契约。
- SDK 基线：`/Users/ljf/Desktop/hu_ts/matrix-js-sdk` 当前 `src/*/__generated__` 契约层、manager 封装层、real-backend 测试入口。
- 协议纪律：稳定 Matrix 能力只按后端真实实现声明；Hula/MSC 扩展必须通过 `unstable_features`、`capabilities` 与 route manifest 三者之一提供可审计证据。

## 活跃路线图口径

- 本文件是 2026-06-01 起继续推进 Synapse Rust SDK 对齐工作的唯一活跃入口。
- 历史审查报告保留为证据库，不再作为待办来源；新发现、新闭环和剩余路线统一回写到本文件。
- 具体 API 覆盖率、DTO 与路由清单仍以 `docs/api-contract/` 生成契约和 `src/*/__generated__/route-table.ts` 为准。
- 每次后端 ledger 更新后，先执行 `contract:sync` 与 `contract:codegen`，再用 `contract:check` 固定 SDK 基线。

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

## 历史报告索引

以下文档只作为背景和审计证据，不再直接承载后续路线：

- `docs/audit/full-module-audit-report.md`：全模块历史审查与第二轮明细，适合追溯问题来源。
- `docs/api-contract/LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md`：ledger 驱动 SDK 生成流程的原始交付计划。
- `docs/api-contract/REVIEW_PLAN.md`：早期模块审查排期和优先级。
- `docs/api-contract/VERIFICATION_REPORT.md`：契约文档生成与校验报告。
- `docs/api-contract/history/`：media、e2ee、admin 等专项复盘。

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
- `VoiceManager.isSupported()`、`OpenClawManager.isSupported()` 与 `AIConnectionManager.isSupported()` 已接入集中 feature discovery，并补齐 Hula 扩展统一语义单元测试。
- `AIConnectionManager` 在调用方未显式指定 API 版本时，会根据集中 feature discovery 对 synapse-rust/Hula 后端优先选择 `v3` 路径，老客户端或未声明能力时继续回退 `v1`。
- `BurnAfterReadManager` 的房间设置、pending、mark/cancel、用户配置与统计接口在未显式指定版本时，会根据 `io.hula.burn_after_read` 能力优先选择 `v3`，老客户端或探测失败继续回退 `v1`。
- `VerificationManager` 保持默认 `v1` 兼容行为，同时补齐显式 `r0`/`v3` 版本参数，绑定生成契约中的三套 verification 兼容前缀。
- `CaptchaManager` 默认保持 `v3` 注册验证码入口，同时补齐显式 `r0` 参数；CAS 继续只把 `/_synapse/admin/v1` 作为生成契约覆盖面，历史 `/_synapse/cas` escape hatch 不作为默认路径。
- key-rotation、moderation、captcha/CAS 与 e2ee 低层 helper 已按生成契约复核：key-rotation 仅有 `v1` 证据，moderation 的 scanner info 仅有 `v1` 证据，e2ee 默认 `v3` 且仅在兼容方法显式使用 `r0/v1`。
- media 与 OIDC/SAML 历史入口已复核：media 保持显式 authenticated-media 选择；OIDC 继续以 `v3` 为 canonical 封装面；SAML 公共入口只存在 `r0`，不做无证据默认切换。
- 增加 runtime manager 到生成 `route-table` 的轻量 contract test，覆盖 auth、friend、burn-after-read、sliding-sync、secure-backup、room、push、device、verification、voice、openclaw、ai-connection、media、OIDC、SAML、presence、typing、notifications、tags、relations、account-data、account-data/filter、dm、space、search、thread、room-summary、room-summary member/stats 子 manager、admin server/user/room 子 manager、key-rotation、moderation、captcha、CAS。
- 增加 real-backend smoke gate，快速输出 `/versions`、`/capabilities` 与核心 Hula 扩展矩阵；默认 real-backend 批次先跑 smoke。
- real-backend smoke gate 已追加核心 Hula route manifest evidence 摘要，同时输出 default/all profile 中的路由证据数量，便于定位“能力声明存在但运行路径未覆盖”的偏差。
- `contract:check` 已串联 `contract-sync --check` 与 `sdk-contract-codegen --check`，后端 ledger 更新后可同时拦截 generated manifest 与 SDK route-table 漂移。
- 当前 generated contract hash mismatch 已通过 `contract:sync`、`contract:codegen` 与文档 hash 更新收敛，`contract:check` 可重新作为 ledger 基线守卫。
- 已将多个历史优化/审查报告收敛为本文件的背景索引，后续路线只在本文件维护。

## 后续路线

1. 后续新增 manager 或 helper 时，必须同步补一条 runtime route-table contract test；已覆盖模块如新增 public 方法，应在同一 spec 中追加代表路径而不是另起散落测试。
2. 后端新增或变更 Hula 扩展能力时，先更新 route manifest/ledger 证据，再把 centralized feature discovery 与 real-backend smoke 矩阵同步扩展。
3. 继续把 `v1/v3/r0` 选择保持为“生成契约 + 能力发现 + 显式调用方覆盖”的三段式策略；没有后端证据的历史入口只保留兼容 escape hatch，不提升为默认路径。
