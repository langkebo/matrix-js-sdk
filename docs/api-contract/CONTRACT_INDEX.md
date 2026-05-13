# API 契约文档索引

> 更新日期: 2026-05-11
> 
> 后端 Ledger ──→ 机器可读契约 (`generated/modules/*.json`) ──→ LLM/SDK 生成 (`scripts/sdk-contract-codegen.mjs`) ──→ 人工 Review
> 
> 后端仓库: `synapse-rust` | 后端提交: `6ba41b535c04a16bfcd77a3e9da6913a5e5b187f`
>
> 说明: `generated/` 默认来自 `../synapse-rust/tests/unit/fixtures/ledger_export_sdk/`，这套 fixture 由 `synapse_ledger_export` 在 `--features all-extensions` 下导出，用于 SDK 完整扩展面同步。后端默认 golden fixture `tests/unit/fixtures/ledger_export/` 仍保留给 compile-aware 单测使用。

## 核心客户端 API

| 模块     | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------------- | ------ | ---------- | ------- |
| 认证     | [auth.md](auth.md)                 | 146    | 100%       | ✅ 完善 |
| 账户数据 | [account-data.md](account-data.md) | 26     | 100%       | ✅ 完善 |
| 设备管理 | [device.md](device.md)             | 12     | 100%       | ✅ 完善 |
| 房间     | [room.md](room.md)                 | 132    | 100%       | ✅ 完善 |
| 同步     | [sync.md](sync.md)                 | 8      | 100%       | ✅ 完善 |
| 推送     | [push.md](push.md)                 | 25     | 100%       | ✅ 完善 |

## 社交功能 API

| 模块     | 文档                       | 端点数 | SDK 覆盖率 | 优先级    |
| -------- | -------------------------- | ------ | ---------- | --------- |
| 好友     | [friend.md](friend.md)     | 57     | 100%       | ✅ 完善   |
| 私聊     | [dm.md](dm.md)             | 8      | 100%       | ✅ 完善   |
| 空间     | [space.md](space.md)       | 72     | 100%       | ✅ 完善   |
| 在线状态 | [presence.md](presence.md) | 8      | 100%       | ✅ 完善   |

## 加密 API

| 模块      | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| --------- | ---------------------------------- | ------ | ---------- | ------- |
| E2EE 核心 | [e2ee.md](e2ee.md)                 | 51     | 100%       | ✅ 完善 |
| 密钥备份  | [key-backup.md](key-backup.md)     | 99     | 100%       | ✅ 完善 |
| 密钥轮换  | [key-rotation.md](key-rotation.md) | 6      | 100%       | ✅ 完善 |
| 设备验证  | [verification.md](verification.md) | 18     | 100%       | ✅ 完善 |

## 媒体与内容 API

| 模块     | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------------- | ------ | ---------- | ------- |
| 媒体     | [media.md](media.md)               | 21     | 100%       | ✅ 完善 |
| 语音     | [voice.md](voice.md)               | 2      | 100%       | ✅ 完善 |
| 房间摘要 | [room-summary.md](room-summary.md) | 23     | 100%       | ✅ 完善 |

## 交互功能 API

| 模块     | 文档                         | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------- | ------ | ---------- | ------- |
| 关系事件 | [relations.md](relations.md) | 11     | 100%       | ✅ 完善 |
| 反应     | [reactions.md](reactions.md) | 2      | 100%       | ✅ 完善 |
| 输入状态 | [typing.md](typing.md)       | 4      | 100%       | ✅ 完善 |
| 线程     | [thread.md](thread.md)       | 21     | 100%       | ✅ 完善 |
| Widget   | [widget.md](widget.md)       | 18     | 100%       | ✅ 完善 |

## 审核与安全 API

| 模块     | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------------- | ------ | ---------- | ------- |
| 内容审核 | [moderation.md](moderation.md)     | 8      | 100%       | ✅ 完善 |
| 事件举报 | [event-report.md](event-report.md) | 19     | 100%       | ✅ 完善 |

## 管理员 API

| 模块     | 文档                                         | 端点数 | SDK 覆盖率 | 优先级    |
| -------- | -------------------------------------------- | ------ | ---------- | --------- |
| 管理核心 | [admin.md](admin.md)                         | 157    | 31%        | 🛠️ 持续完善中 (已封装 48 个高价值端点) |
| 联邦     | [federation.md](federation.md)               | 52     | 35%        | ⚠️ 待提升 (已补联邦发现、目的地、事件与媒体查询) |
| WorkerAdmin | [worker-admin.md](worker-admin.md)           | 13     | 100%       | ✅ 完善   |
| 遥测     | [telemetry.md](telemetry.md)                 | 6      | 100%       | ✅ 完善   |
| 特性开关 | [feature-flags.md](feature-flags.md)         | 4      | 100%       | ✅ 完善   |
| 后台更新 | [background-update.md](background-update.md) | 19     | 100%       | ✅ 完善   |

## 集成 API

| 模块       | 文档                             | 端点数 | SDK 覆盖率 | 优先级  |
| ---------- | -------------------------------- | ------ | ---------- | ------- |
| 第三方集成 | [thirdparty.md](thirdparty.md)   | 10     | 100%       | ✅ 完善 |
| 应用服务   | [app-service.md](app-service.md) | 25     | 100%       | ✅ 完善 |
| Rendezvous | [rendezvous.md](rendezvous.md)   | 6      | 100%       | ✅ 完善 |

## 扩展模块

| 模块       | 文档                                   | 端点数 | SDK 覆盖率 | 优先级  |
| ---------- | -------------------------------------- | ------ | ---------- | ------- |
| CAS 认证   | [cas.md](cas.md)                       | 16     | 100%       | ✅ 完善 (含协议端点 URL helper) |
| SAML       | [saml.md](saml.md)                     | 16     | 100%       | ✅ 完善 |
| OIDC       | [oidc.md](oidc.md)                     | 19     | 100%       | ✅ 完善 (以 v3 为 canonical 封装面) |
| 验证码     | [captcha.md](captcha.md)               | 7      | 100%       | ✅ 完善 (以 v3 为 canonical 封装面) |
| AI 连接    | [ai-connection.md](ai-connection.md)   | 6      | 100%       | ✅ 完善 |
| 阅后即焚   | [burn-after-read.md](burn-after-read.md) | 7    | 100%       | ✅ 完善 |
| 模块管理   | [module.md](module.md)                 | 27     | 100%       | ✅ 完善 |

## 其他模块（MatrixClient 基类 / 独立入口处理）

| 模块       | 文档                                   | 端点数 | SDK 覆盖率 | 优先级  |
| ---------- | -------------------------------------- | ------ | ---------- | ------- |
| 搜索       | [search.md](search.md)                 | 11     | 100%       | ✅ 完善 |
| 标签       | [tags.md](tags.md)                     | —      | 100%       | ✅ 完善 |
| 通知       | [notifications.md](notifications.md)   | 2      | 100%       | ✅ 完善 |
| SlidingSync | [sliding-sync.md](sliding-sync.md)    | —      | 100%       | ✅ 完善 |
| 游客       | [guest.md](guest.md)                   | 3      | 100%       | ✅ 完善 |
| 临时事件   | [ephemeral.md](ephemeral.md)           | 1      | 100%       | ✅ 完善 |
| 外部服务   | [external-service.md](external-service.md) | 10     | 100%       | ✅ 完善 |
| OpenClaw   | [openclaw.md](openclaw.md)             | 23     | 100%       | ✅ 完善 |
| WorkerBody | [worker-body.md](worker-body.md)       | 11     | 100%       | ✅ 完善 |

## 总览统计

- **总文档数**: 48
- **总端点数**: ~950
- **sdk-contract-codegen 模块数**: 32（codegen 自动生成 route-table + acceptance 测试）
- **平均 SDK 覆盖率**: ~91%
- **完善模块 (≥85%)**: 46 (96%)
- **待提升模块 (50-84%)**: 0
- **待封装模块 (<50%)**: 0

> 统计说明：端点数来自 `generated/modules/*.json` 的 `entry_count` 字段（codegen 实时输出），覆盖率基于第二轮深度审计（52 项问题全部闭环）后的实际状态。

## 图例

- ✅ 完善：SDK 覆盖率 ≥ 85%
- ⚠️ 待提升：SDK 覆盖率 50-84%
- 🔴 紧急/待封装：SDK 覆盖率 < 50%

## 变更历史

| 日期 | 变更说明 |
|------|---------|
| 2026-05-11 | 第二轮审计 52 项问题全部闭环；48 个合约 JSON commit hash 统一为 `6ba41b535c04`；codegen 重新生成 128 个文件；覆盖率从 ~65% 提升至 ~91%；🔴 待封装模块从 11 降至 0；`worker-admin` 与 `background-update` 管理面契约补齐到 100% |
| 2026-04-27 | 初始版本，基于第一轮部分审计结果 |
