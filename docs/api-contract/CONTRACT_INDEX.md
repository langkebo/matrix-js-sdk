# API 契约文档索引

> 更新日期: 2026-10-12（契约镜像与后端 `122aaf109` 对齐）
>
> 后端 Ledger ──→ 机器可读契约 (`generated/modules/*.json`) ──→ LLM/SDK 生成 (`scripts/sdk-contract-codegen.mjs`) ──→ 人工 Review
>
> 后端仓库: `synapse-rust` | 后端提交: `122aaf109a883a078861fce740e9ce1af416f1b0`（`fix(contract): 类型化 chunk 上传 query 并补齐路由面 query_params 口径`）
>
> 说明: `generated/` 默认来自 `../synapse-rust/tests/unit/fixtures/ledger_export_sdk/`，这套 fixture 由 `synapse_ledger_export` 在 `--features all-extensions` 下导出，用于 SDK 完整扩展面同步。后端默认 golden fixture `tests/unit/fixtures/ledger_export/` 仍保留给 compile-aware 单测使用。

## 核心客户端 API

| 模块     | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------------- | ------ | ---------- | ------- |
| 认证     | [auth.md](auth.md)                 | 146    | 100%       | ✅ 完善 |
| 账户数据 | [account-data.md](account-data.md) | 15     | 100%       | ✅ 完善 |
| 设备管理 | [device.md](device.md)             | 6      | 100%       | ✅ 完善 |
| 房间     | [room.md](room.md)                 | 95     | 100%       | ✅ 完善 |
| 同步     | [sync.md](sync.md)                 | 3      | 100%       | ✅ 完善 |
| 推送     | [push.md](push.md)                 | 17     | 100%       | ✅ 完善 |

## 社交功能 API

| 模块     | 文档                       | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | -------------------------- | ------ | ---------- | ------- |
| 好友     | [friend.md](friend.md)     | 28     | 100%       | ✅ 完善 |
| 私聊     | [dm.md](dm.md)             | 5      | 100%       | ✅ 完善 |
| 空间     | [space.md](space.md)       | 26     | 100%       | ✅ 完善 |
| 在线状态 | [presence.md](presence.md) | 9      | 100%       | ✅ 完善 |

## 加密 API

| 模块      | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| --------- | ---------------------------------- | ------ | ---------- | ------- |
| E2EE 核心 | [e2ee.md](e2ee.md)                 | 36     | 100%       | ✅ 完善 |
| 密钥备份  | [key-backup.md](key-backup.md)     | 66     | 100%       | ✅ 完善 |
| 密钥轮换  | [key-rotation.md](key-rotation.md) | 9      | 100%       | ✅ 完善 |

## 媒体与内容 API

| 模块     | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------------- | ------ | ---------- | ------- |
| 媒体     | [media.md](media.md)               | 36     | 100%       | ✅ 完善 |
| 语音     | [voice.md](voice.md)               | 12     | 100%       | ✅ 完善 |
| 房间摘要 | [room-summary.md](room-summary.md) | 21     | 100%       | ✅ 完善 |

## 交互功能 API

| 模块     | 文档                         | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------- | ------ | ---------- | ------- |
| 关系事件 | [relations.md](relations.md) | 9      | 100%       | ✅ 完善 |
| 反应     | [reactions.md](reactions.md) | 1      | 100%       | ✅ 完善 |
| 输入状态 | [typing.md](typing.md)       | 5      | 100%       | ✅ 完善 |
| 线程     | [thread.md](thread.md)       | 21     | 100%       | ✅ 完善 |
| Widget   | [widget.md](widget.md)       | 16     | 100%       | ✅ 完善 |

## 审核与安全 API

| 模块     | 文档                               | 端点数 | SDK 覆盖率 | 优先级  |
| -------- | ---------------------------------- | ------ | ---------- | ------- |
| 内容审核 | [moderation.md](moderation.md)     | 6      | 100%       | ✅ 完善 |
| 事件举报 | [event-report.md](event-report.md) | 18     | 100%       | ✅ 完善 |

## 管理员 API

| 模块        | 文档                                         | 端点数 | SDK 覆盖率 | 优先级                                           |
| ----------- | -------------------------------------------- | ------ | ---------- | ------------------------------------------------ |
| 管理核心    | [admin.md](admin.md)                         | 179    | 31%        | 🛠️ 持续完善中 (已封装 48 个高价值端点)           |
| 联邦        | [federation.md](federation.md)               | 55     | 35%        | ⚠️ 待提升 (已补联邦发现、目的地、事件与媒体查询) |
| WorkerAdmin | [worker-admin.md](worker-admin.md)           | 15     | 100%       | ✅ 完善                                          |
| 遥测        | [telemetry.md](telemetry.md)                 | 6      | 100%       | ✅ 完善                                          |
| 特性开关    | [feature-flags.md](feature-flags.md)         | 4      | 100%       | ✅ 完善                                          |
| 后台更新    | [background-update.md](background-update.md) | 19     | 100%       | ✅ 完善                                          |

## 集成 API

| 模块       | 文档                             | 端点数 | SDK 覆盖率 | 优先级  |
| ---------- | -------------------------------- | ------ | ---------- | ------- |
| 第三方集成 | [thirdparty.md](thirdparty.md)   | 6      | 100%       | ✅ 完善 |
| 应用服务   | [app-service.md](app-service.md) | 39     | 100%       | ✅ 完善 |
| Rendezvous | [rendezvous.md](rendezvous.md)   | 6      | 100%       | ✅ 完善 |

## 扩展模块

| 模块     | 文档                                     | 端点数 | SDK 覆盖率 | 优先级                              |
| -------- | ---------------------------------------- | ------ | ---------- | ----------------------------------- |
| CAS 认证 | [cas.md](cas.md)                         | 12     | 100%       | ✅ 完善 (含协议端点 URL helper)     |
| SAML     | [saml.md](saml.md)                       | 16     | 100%       | ✅ 完善                             |
| OIDC     | [oidc.md](oidc.md)                       | 10     | 100%       | ✅ 完善 (以 v3 为 canonical 封装面) |
| 验证码   | [captcha.md](captcha.md)                 | 5      | 100%       | ✅ 完善 (默认 v3，显式 r0 兼容)     |
| 阅后即焚 | [burn-after-read.md](burn-after-read.md) | 7      | 100%       | ✅ 完善                             |
| 模块管理 | [module.md](module.md)                   | 23     | 100%       | ✅ 完善                             |

## 其他模块（MatrixClient 基类 / 独立入口处理）

| 模块        | 文档                                       | 端点数 | SDK 覆盖率 | 优先级  |
| ----------- | ------------------------------------------ | ------ | ---------- | ------- |
| 搜索        | [search.md](search.md)                     | 8      | 100%       | ✅ 完善 |
| 标签        | [tags.md](tags.md)                         | 4      | 100%       | ✅ 完善 |
| 通知        | [notifications.md](notifications.md)       | 8      | 100%       | ✅ 完善 |
| SlidingSync | [sliding-sync.md](sliding-sync.md)         | 4      | 100%       | ✅ 完善 |
| 游客        | [guest.md](guest.md)                       | 3      | 100%       | ✅ 完善 |
| 临时事件    | [ephemeral.md](ephemeral.md)               | 1      | 100%       | ✅ 完善 |
| 外部服务    | [external-service.md](external-service.md) | 12     | 100%       | ✅ 完善 |
| WorkerBody  | [worker-body.md](worker-body.md)           | 11     | 100%       | ✅ 完善 |

## 总览统计

- **模块文档页数**: 49（其中 `auth.md` 为 umbrella 页；45 页带 `module:` frontmatter，直接对应一个生成物模块）
- **生成物模块数**: 49（`generated/modules/*.json`）
- **后端路由端点数**（`ledger_export_sdk` 三 profile）: `default` **1008** / `worker` **1019** / `all` **1027**
- **索引表端点数合计**: 1059（页级 `entry_count` 之和；`auth.md` 为 umbrella 页，`worker-body.md` 与 `worker-admin.md` 共享 `worker` 模块，故与 1027 不等）
- **平均 SDK 覆盖率**: 97.1%
- **完善模块 (≥85%)**: 44 / 46
- **待提升模块 (50-84%)**: 0
- **待封装模块 (<50%)**: 2 —— `admin.md` 31%、`federation.md` 35%

> 统计说明：端点数来自 `generated/modules/*.json` 的 `entry_count` 字段（`contract-sync` 实时输出）。
> 本轮（2026-10-12）已把表中 **35 处**与生成物不符的端点数逐条订正为实测值。
> 「待封装」两项为**已登记在册**的已知差距（admin 只封装高价值端点、federation 只覆盖发现/目的地/事件/媒体查询），
> 不是文档漂移；其限额由 `quality:waiver-expiry` 管辖。

> **本轮同步范围（2026-10-12，基线后端 `122aaf109`）**：
> ① `generated/` 镜像刷新（仅 `media` 的分块上传 `query_params` 有语义变化）；
> ② 47 个页面的 **103 处**后端源码路径引用从已废弃的 `src/web/…` 校正为 `synapse-web/…`（含 7 处目录模块与 1 处 crate 迁移）；
> ③ 7 个页面的 **70 处** `/_matrix/client/*` 路径校正为 `/_matrix/vendor/v1/*`（vendor 命名空间迁移未回写文档）；
> ④ `thread` / `widget` / `presence` / `push` / `sync` / `room` / `room-summary` / `voice` / `media` 的
> 「挂载版本」与「路由清单」按 ledger 重建；
> ⑤ `media.md` 路由清单由 20 条补全为 **36 条**（原缺分块上传家族、r0 全组、`download_signed`、authenticated media）。
> 详细差异与影响面见 `../../OPS_ARTIFACTS/` 下的同步报告。

## 图例

- ✅ 完善：SDK 覆盖率 ≥ 85%
- ⚠️ 待提升：SDK 覆盖率 50-84%
- 🔴 紧急/待封装：SDK 覆盖率 < 50%

## 变更历史

| 日期       | 变更说明                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-11 | 第二轮审计 52 项问题全部闭环；48 个合约 JSON commit hash 统一为 `6ba41b535c04`；codegen 重新生成 128 个文件；覆盖率从 ~65% 提升至 ~91%；🔴 待封装模块从 11 降至 0；`worker-admin` 与 `background-update` 管理面契约补齐到 100% |
| 2026-04-27 | 初始版本，基于第一轮部分审计结果                                                                                                                                                                                               |
