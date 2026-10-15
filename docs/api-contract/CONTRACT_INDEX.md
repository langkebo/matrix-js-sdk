# API 契约文档索引

> 更新日期: 2026-10-15（契约镜像与后端 `8869abea1` 对齐；WAIVED 收编线收口 + `dehydrated_device` 收编）
>
> 后端 Ledger ──→ 机器可读契约 (`generated/modules/*.json`) ──→ LLM/SDK 生成 (`scripts/sdk-contract-codegen.mjs`) ──→ 人工 Review
>
> 后端仓库: `synapse-rust` | 后端提交: `8869abea19e4881203ecf1d1b93c172ad6475ae2`（镜像 stamp，即 `generated/index.json` 的 `synapse_rust_commit`；`contract-sync` 用后端工作区 live HEAD 覆写）
>
> 说明: `generated/` 默认来自 `../synapse-rust/tests/unit/fixtures/ledger_export_sdk/`，这套 fixture 由 `synapse_ledger_export` 在 `--features all-extensions` 下导出，用于 SDK 完整扩展面同步。后端默认 golden fixture `tests/unit/fixtures/ledger_export/` 仍保留给 compile-aware 单测使用。

## 核心客户端 API

| 模块     | 文档                                         | 端点数 | SDK 覆盖率 | 优先级                                                                    |
| -------- | -------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------- |
| 认证     | [auth.md](auth.md)                           | 99     | 100%       | ✅ 完善 (umbrella 页，对应后端 `assembly` 桶；msc3814 族已拆出为独立模块) |
| 账户数据 | [account-data.md](account-data.md)           | 15     | 100%       | ✅ 完善                                                                   |
| 设备管理 | [device.md](device.md)                       | 6      | 100%       | ✅ 完善                                                                   |
| 脱水设备 | [dehydrated-device.md](dehydrated-device.md) | 6      | 100%       | ✅ 完善 (6 条中 5 条已封装；第 6 条 GET 兼容别名有意不封装)               |
| 房间     | [room.md](room.md)                           | 95     | 100%       | ✅ 完善                                                                   |
| 同步     | [sync.md](sync.md)                           | 3      | 100%       | ✅ 完善                                                                   |
| 推送     | [push.md](push.md)                           | 17     | 100%       | ✅ 完善                                                                   |

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

| 模块        | 文档                                         | 端点数 | SDK 覆盖率 | 优先级                                                                           |
| ----------- | -------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------- |
| 管理核心    | [admin.md](admin.md)                         | 179    | 98%        | ✅ 完善 (176/179 端点已封装；全部路径受 `PathAssert` 编译期约束，无约束路由归零) |
| 联邦        | [federation.md](federation.md)               | 55     | —          | 🖥️ 服务端面 (S2S / key-server)，SDK 不承担；客户端可见面 19 条已封装             |
| WorkerAdmin | [worker-admin.md](worker-admin.md)           | 15     | 100%       | ✅ 完善                                                                          |
| 遥测        | [telemetry.md](telemetry.md)                 | 6      | 100%       | ✅ 完善                                                                          |
| 特性开关    | [feature-flags.md](feature-flags.md)         | 4      | 100%       | ✅ 完善                                                                          |
| 后台更新    | [background-update.md](background-update.md) | 19     | 100%       | ✅ 完善                                                                          |

## 集成 API

| 模块       | 文档                             | 端点数 | SDK 覆盖率 | 优先级                                 |
| ---------- | -------------------------------- | ------ | ---------- | -------------------------------------- |
| 第三方集成 | [thirdparty.md](thirdparty.md)   | 6      | 100%       | ✅ 完善                                |
| 应用服务   | [app-service.md](app-service.md) | 39     | 100%       | ✅ 完善                                |
| Rendezvous | [rendezvous.md](rendezvous.md)   | 10     | 100%       | ✅ 完善 (含 `msc4108_rendezvous` 4 条) |

## 扩展模块

| 模块     | 文档                                       | 端点数 | SDK 覆盖率 | 优先级                                   |
| -------- | ------------------------------------------ | ------ | ---------- | ---------------------------------------- |
| CAS 认证 | [cas.md](cas.md)                           | 12     | 100%       | ✅ 完善 (含协议端点 URL helper)          |
| SAML     | [saml.md](saml.md)                         | 16     | 100%       | ✅ 完善                                  |
| OIDC     | [oidc.md](oidc.md)                         | 10     | 100%       | ✅ 完善 (以 v3 为 canonical 封装面)      |
| 验证码   | [captcha.md](captcha.md)                   | 5      | 100%       | ✅ 完善 (默认 v3，显式 r0 兼容)          |
| 阅后即焚 | [burn-after-read.md](burn-after-read.md)   | 7      | 100%       | ✅ 完善                                  |
| 模块管理 | [module.md](module.md)                     | 23     | 100%       | ✅ 完善                                  |
| 延迟事件 | [delayed-events.md](delayed-events.md)     | 7      | 100%       | ✅ 完善 (3 条 action-in-PATH 有意不封装) |
| 邀请名单 | [invite-blocklist.md](invite-blocklist.md) | 4      | 100%       | ✅ 完善                                  |

## 其他模块（MatrixClient 基类 / 独立入口处理）

| 模块        | 文档                                       | 端点数 | SDK 覆盖率 | 优先级  |
| ----------- | ------------------------------------------ | ------ | ---------- | ------- |
| 搜索        | [search.md](search.md)                     | 8      | 100%       | ✅ 完善 |
| 标签        | [tags.md](tags.md)                         | 4      | 100%       | ✅ 完善 |
| 通知        | [notifications.md](notifications.md)       | 8      | 100%       | ✅ 完善 |
| SlidingSync | [sliding-sync.md](sliding-sync.md)         | 4      | 100%       | ✅ 完善 |
| 游客        | [guest.md](guest.md)                       | 3      | 100%       | ✅ 完善 |
| 临时事件    | [ephemeral.md](ephemeral.md)               | 1      | 100%       | ✅ 完善 |
| 外部服务    | [external-service.md](external-service.md) | 11     | 100%       | ✅ 完善 |
| WorkerBody  | [worker-body.md](worker-body.md)           | 11     | 100%       | ✅ 完善 |

## 总览统计

- **模块文档页数**: 49（48 页带 `module:` frontmatter；`auth.md` 为 umbrella 页，无 `module:` 但对应后端 `assembly` 桶）
- **生成物模块数**: 50（`generated/modules/*.json`）
- **后端路由端点数**（`ledger_export_sdk` 三 profile）: `default` **1013** / `worker` **1024** / `all` **1032**
- **索引表端点数合计**: **1032**（与后端 `all` profile **完全一致** —— 49 页覆盖 50 个后端模块：`auth.md` 对应 `assembly` 桶，`rendezvous.md` 对应 `rendezvous` + `msc4108_rendezvous` 两个模块）
- **SDK 覆盖率（按路由加权）**: **96.2%**（已封装 **993** / 后端 **1032**；2026-10-15 实测）
- **完善模块 (≥85%)**: 48 / 49
- **待提升模块 (50-84%)**: 0
- **本口径不适用**: 1 —— `federation.md`（19/55 = 35%）。其 55 条**全为** server-to-server / key-server 路由，客户端 SDK 天然不承担，已由 `quality:manager-codegen` 单列为 `SERVER_ONLY` 类别（与"有期限的欠账"性质不同）

> 统计说明：端点数来自 `generated/modules/*.json` 的 `entry_count` 字段（`contract-sync` 实时输出）。
>
> ⚠️ **本页的「页数 / 合计 / 覆盖率」三项长期无人守护** —— `quality:docs-counts` 只守
> `contract-artifacts.md` 与 `CLAUDE.md`/`AGENTS.md` 的 8 个锚点，不覆盖本页。故 2026-10-15 逐条重新实测，
> 订正两处端点数，并纠正一条错误解释：
>
> | 行              | 原值 |               实测 | 依据                                                                                                                                                                                                                                                                                     |
> | --------------- | ---: | -----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `auth.md`       |  146 | **104 → 105 → 99** | 后端 `assembly` 桶原为 104（`src/auth/__generated__/route-table.ts` 实测同值）；146 无可复现来源。同日稍后后端补齐 `POST …/dehydrated_device/{device_id}/events` ⇒ **105**；再稍后把 MSC3814 族改为独立 sub-router（`registered_by: dehydrated_device`）⇒ 该族 6 条拆出，桶 **105 → 99** |
> | `rendezvous.md` |    6 |             **10** | 该 SDK 表同时承载 `rendezvous`(6) 与 `msc4108_rendezvous`(4)                                                                                                                                                                                                                             |
>
> 订正后合计**恰为 1032**。此前"与 1032 不等"的解释（称 `worker-body.md` 与 `worker-admin.md` 共享
> `worker` 模块）**不成立**：两者分别对应 `worker_body`(11) 与 `worker`(15) 两个不同模块，不构成重复计。
> 真实的折叠只有两处 —— `assembly → auth`、`msc4108_rendezvous → rendezvous`；净差 38（= 1070 − 1032）
> 正是 `auth` 多算 42 与 `rendezvous` 少算 4 相抵的结果。

> **上轮同步范围（2026-10-12，基线后端 `122aaf109`）**：
> ① `generated/` 镜像刷新（仅 `media` 的分块上传 `query_params` 有语义变化）；
> ② 47 个页面的 **103 处**后端源码路径引用从已废弃的 `src/web/…` 校正为 `synapse-web/…`（含 7 处目录模块与 1 处 crate 迁移）；
> ③ 7 个页面的 **70 处** `/_matrix/client/*` 路径校正为 `/_matrix/vendor/v1/*`（vendor 命名空间迁移未回写文档）；
> ④ `thread` / `widget` / `presence` / `push` / `sync` / `room` / `room-summary` / `voice` / `media` 的
> 「挂载版本」与「路由清单」按 ledger 重建；
> ⑤ `media.md` 路由清单由 20 条补全为 **36 条**（原缺分块上传家族、r0 全组、`download_signed`、authenticated media）。
> 详细差异与影响面见 `../../OPS_ARTIFACTS/` 下的同步报告。

> **本轮变更（2026-10-15，契约镜像 stamp `6302798c3`）—— 「WAIVED 收编线」收口**：
>
> 把此前**零 route-table 约束**的模块逐个收编进 codegen，使 `quality:manager-codegen` 的
> **WAIVED 10 → 0**、**无 route-table 约束的路由 315 → 0**、模块维度覆盖率 **79.2% → 100%**：
>
> | 批次 | 模块（条数）                                     | 性质 / 原豁免理由的实测订正                                                                                                                               |
> | ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 001  | `delayed_events`(7)                              | 两条通道均未登记（alias 缺失 + 章节未映射）⇒ 补登记即收编                                                                                                 |
> | 002  | `dm`(5) / `key-rotation`(9) / `feature-flags`(4) | manager 自持前缀 + 字面量相对路径，与契约前缀逐字一致                                                                                                     |
> | 003  | `invite_blocklist`(4)                            | 原理由「后端无该章节」不成立 —— 枚举源实为**本仓** `CONTRACT_INDEX.md` 的文档链接                                                                         |
> | 004  | `app_service`(39)                                | 原判"纯服务端面"有误（实为 17 admin + 12 AS + 10 客户端面）；且 `LEDGER_MODULE_ALIASES` 键名写错（`appservice` vs `app-service`）⇒ 表生成但是**空的**     |
> | 005  | `cas`(12)                                        | 原理由「运行时前缀拼接、需独立改造」与代码不符 —— 全是方法内局部常量 + 字面量                                                                             |
> | 006  | `reactions`(1)                                   | 真正消费点在 `src/room-events/index.ts`（`reactions/` 只是薄包装委托）                                                                                    |
> | 007  | `admin`(179)                                     | 跨 **7 个 ledger 模块** ⇒ 断言用 7 表 union + 6 种前缀剥离；221 处调用点批量接入 `apu()`                                                                  |
> | 008  | `dehydrated_device`(6)                           | 该族原由 `assembly::create_router` 直挂 ⇒ ledger 无独立模块 ⇒ SDK 侧**无从收编**（建页只会生成**空表**）。后端改独立 sub-router 后独立成桶 ⇒ 首次进入枚举 |
> | —    | `federation`(55)                                 | 逐条实测全为 S2S / key-server ⇒ 移出 WAIVED，归入新增 `SERVER_ONLY` 类别                                                                                  |
>
> 合计 **10 个模块 / 266 条**由"零约束"转为受管辖。产物口径同步变化：
> route-table **39 → 47 张**、条目 **729 → 977**、`src/*/__generated__` 目录 **47 → 48**。
>
> **追加 008（同日稍后）**：`dehydrated_device`(6) 收编 —— 该族原由 `assembly::create_router` 直挂
> ⇒ ledger 无独立模块 ⇒ SDK 侧**无从收编**（新页会生成**空表**，比没有更糟）。后端把该族改为
> **独立 sub-router**（`registered_by: dehydrated_device`）后独立成桶 ⇒ 首次进入 codegen 枚举。
> 产物口径再变：route-table **47 → 48 张**、镜像文件 **49 → 50**、`__generated__` 目录 **48 → 49**；
> 条目数因 `auth` 减 6 与新增 6 **相抵**，仍为 **977**。`assembly` 桶 **105 → 99**。
> `quality:manager-codegen` ⇒ **Covered 48 / Waived 0 / Missing 0**。
>
> 收编过程本身炸出并修复 **6 条真实 404 缺陷**（`federation/destinations/{server}/reset` 试探、
> `rooms/{room_id}/messages/{event_id}` DELETE、`invite/{blocklist,allowlist}` 的 per-user 增删 ×4），
> 详见 `contract-artifacts.md` §六 与 `../artifacts/sdk-backend-handoff-2026-10-15.md`。

## 图例

- ✅ 完善：SDK 覆盖率 ≥ 85%
- ⚠️ 待提升：SDK 覆盖率 50-84%
- 🔴 紧急/待封装：SDK 覆盖率 < 50%
- 🖥️ 服务端面：路由由 homeserver 之间 / key server 调用，客户端 SDK 天然不承担（`SERVER_ONLY` 口径，不记为欠账）

## 变更历史

| 日期       | 变更说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-15 | **`dehydrated_device` 收编**（后端把 MSC3814 族改为独立 sub-router ⇒ ledger 独立成桶）：新增 `dehydrated-device.md` 页 + 索引行 + 独立 route-table（6 条）；`assembly` 桶 105 → **99**；产物 route-table **47 → 48 张**、镜像文件 **49 → 50**、`__generated__` 目录 **48 → 49**（条目数相抵仍 977）。`quality:manager-codegen` ⇒ **Covered 48 / Waived 0 / Missing 0**。同步把 `codegen` 的**死条目剪枝判据**由全局 `globalLedgerKeys` 收紧为 `ownedByThisDir`（否则「跨桶迁移」会在两表留下重复路由） |
| 2026-10-15 | **WAIVED 收编线收口**：9 个模块 / 260 条从「零 route-table 约束」转为受管辖（`delayed_events` 7、`dm` 5、`key-rotation` 9、`feature-flags` 4、`invite_blocklist` 4、`app_service` 39、`cas` 12、`reactions` 1、`admin` 179）；`federation`(55) 归入新增 `SERVER_ONLY` 类别。**WAIVED 10 → 0**、无约束路由 **315 → 0**、route-table **39 → 47 张**、条目 **729 → 977**；顺带修复 6 条真实 404 缺陷。本页 `auth`(146→104) / `rendezvous`(6→10) 端点数订正，合计恰为 1032                                 |
| 2026-05-11 | 第二轮审计 52 项问题全部闭环；48 个合约 JSON commit hash 统一为 `6ba41b535c04`；codegen 重新生成 128 个文件；覆盖率从 ~65% 提升至 ~91%；🔴 待封装模块从 11 降至 0；`worker-admin` 与 `background-update` 管理面契约补齐到 100%                                                                                                                                                                                                                                                                         |
| 2026-04-27 | 初始版本，基于第一轮部分审计结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
