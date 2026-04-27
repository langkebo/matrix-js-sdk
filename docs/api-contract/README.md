# Matrix JS SDK API 契约目录

> 本目录以 `synapse-rust` 当前磁盘代码为准，按“装配入口 -> 路由模块 -> 处理器/提取器”重审。

## 审查基线

- 主装配入口: `synapse-rust/src/web/routes/assembly.rs`
- 管理端装配入口: `synapse-rust/src/web/routes/admin/mod.rs`
- 联邦装配入口: `synapse-rust/src/web/routes/federation.rs`
- 认证提取器: `synapse-rust/src/web/routes/extractors/auth.rs`
- 条件挂载模块: `SAML`、`OIDC`

## 文档索引

| 文档                          | 范围                                                      | 说明                                                           |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `auth.md`                     | 认证、账户、目录、公开发现端点                            | 覆盖 `assembly.rs` 中 auth/account/directory 顶层路由          |
| `account-data.md`             | 用户级/房间级 account data、filter、openid、room tags     | 覆盖 `account_data.rs` 与 `tags.rs`                            |
| `admin.md`                    | `/_synapse/admin/*`                                       | 覆盖用户、房间、媒体、安全、通知、令牌、联邦、报表、保留策略   |
| `device.md`                   | 设备管理与设备列表变更                                    | 覆盖 `device.rs`                                               |
| `e2ee.md`                     | 核心 E2EE、设备信任、to-device                            | 覆盖 `e2ee_routes.rs`                                          |
| `key-backup.md`               | Room key backup / recover / import-export / secure backup | 覆盖 `key_backup.rs` 与 `e2ee_routes.rs` 中 secure backup 路由 |
| `media.md`                    | Media API 与配额接口                                      | 覆盖 `media.rs`                                                |
| `voice.md`                    | Voice 上传、转换、优化、转写                              | 覆盖 `voice.rs`                                                |
| `presence.md`                 | Presence 状态与 presence list                             | 覆盖 `presence.rs`                                             |
| `room.md`                     | Room 主链路与扩展房间端点                                 | 覆盖 `room.rs` 的 `r0/v1/v3` 路由树                            |
| `room-summary.md`             | Room Summary 读写与内部汇总接口                           | 覆盖 `room_summary.rs`                                         |
| `sync.md`                     | Sync / Events / Joined Rooms / Sliding Sync               | 覆盖 `sync.rs` 与 `sliding_sync.rs`                            |
| `push.md`                     | Pushers / Push Rules / Notifications                      | 覆盖 `push.rs`                                                 |
| `rendezvous.md`               | 二维码登录 Rendezvous 会话与消息交换                      | 覆盖 `rendezvous.rs`                                           |
| `space.md`                    | Space CRUD / 层级 / 树路径 / 成员与摘要                   | 覆盖 `space.rs` 及 `space/*` 子模块                            |
| `dm.md`                       | DM 创建、direct map、DM 伙伴查询                          | 覆盖 `dm.rs`                                                   |
| `friend.md`                   | 好友、好友请求、分组                                      | 覆盖 `friend_room.rs`                                          |
| `widget.md`                   | Widget CRUD、权限、会话、房间级能力与消息                 | 覆盖 `widget.rs`                                               |
| `thread.md`                   | 全局/房间线程、回复、订阅、统计、兼容搜索                 | 覆盖 `handlers/thread.rs`                                      |
| `verification.md`             | SAS/二维码设备校验                                        | 覆盖 `verification_routes.rs`                                  |
| `federation.md`               | Matrix Federation public/protected 路由                   | 覆盖 `federation.rs`                                           |
| `worker-admin.md`             | Worker 注册、调度、复制与事件流                           | 覆盖 `worker.rs`                                               |
| `backend-route-inventory.md`  | 已挂载后端路由总表                                        | 用于补足未单独拆文档的模块                                     |
| `exports.md`                  | SDK 导出清单                                              | 与 `package.json#exports` 对齐，用于 CI 校验                   |
| `THROW_ON_ERROR_MIGRATION.md` | Manager 错误处理默认策略迁移                              | 记录 `throwOnError` 收敛范围与兼容状态                         |
| `VERIFICATION_REPORT.md`      | 文档与代码交叉验证说明                                    | 记录审查方法、已覆盖范围、明确排除项                           |
| `CHANGELOG.md`                | 本轮契约修订记录                                          | 记录重审日期与范围                                             |
| `history/README.md`           | 历史材料索引                                              | 汇总历史报告、总结、专项变更清单与增强版契约                   |

## 推荐阅读顺序

- 先看 `README.md`，确认模块归属、审查基线和当前目录约束。
- 再看对应模块主契约文档，如 `auth.md`、`account-data.md`、`space.md`、`worker-admin.md`。
- 需要确认审查覆盖范围与剩余风险时，再看 `VERIFICATION_REPORT.md`。
- 需要追踪某轮具体修订内容时，再看 `CHANGELOG.md`。
- 只有在追溯历史决策、专项整改过程或旧版补充说明时，才阅读 `*_REVIEW_SUMMARY.md`、`*_REVIEW_REPORT.md`、`*_CHANGELOG.md` 与 `*-enhanced.md`。

## 现行基线

- 当前主契约基线以标准模块文档为准，不以历史专项报告或历史增强版文档为准。
- 判断“当前真实契约”时，优先级如下：
  1. 模块主契约文档（如 `account-data.md`、`space.md`、`worker-admin.md`）
  2. `README.md`
  3. `VERIFICATION_REPORT.md`
  4. `CHANGELOG.md`
- 若历史材料中的描述与以上文档冲突，应以后端最新重审后的主契约文档为准。

## 历史材料

- 以下文件现已统一归档到 `history/` 目录，保留为历史审查快照或阶段性增强版补充材料，不作为当前主契约基线：
  - `history/*_REVIEW_SUMMARY.md`
  - `history/*_REVIEW_REPORT.md`
  - `history/*_CHANGELOG.md`
  - `history/auth-enhanced.md`
  - `history/device-enhanced.md`
  - `history/dm-enhanced.md`
- 这些文件仍有参考价值，但主要用于追溯审查过程、专项整改记录和旧版补充说明。
- 历史材料统一入口见 `history/README.md`。
- 历史正文里若保留 `docs/api-contract/...` 的旧路径文本，应视为原始记录，不表示这些文件仍位于主目录。

### 历史材料清单

| 文件 | 类型 | 当前用途 |
| ---- | ---- | -------- |
| `history/ADMIN_REVIEW_SUMMARY.md` | 审查总结 | 保留 2026-04-15 的 admin 阶段性审查结论 |
| `history/ADMIN_SDK_COVERAGE_REPORT.md` | 覆盖率报告 | 保留 admin SDK 封装覆盖率盘点结果 |
| `history/ADMIN_UPDATE_2026-04-15.md` | 功能更新记录 | 保留 admin 模块当时的增量封装记录 |
| `history/AUTH_REVIEW_SUMMARY.md` | 审查总结 | 保留 auth 快速评审结论 |
| `history/AUTH_REVIEW_REPORT.md` | 完整评审报告 | 保留 auth 全量审查过程与当时结论 |
| `history/AUTH_CHANGELOG.md` | 专项变更清单 | 保留 auth 2026-04-15 的专项整改记录 |
| `history/ACCOUNT_DATA_REVIEW_REPORT.md` | 完整评审报告 | 保留 account-data 首轮专项审查过程 |
| `history/ACCOUNT_DATA_CHANGELOG.md` | 专项变更清单 | 保留 account-data 首轮专项整改记录 |
| `history/DEVICE_REVIEW_SUMMARY.md` | 审查总结 | 保留 device 阶段性审查结论 |
| `history/DM_REVIEW_SUMMARY.md` | 审查总结 | 保留 dm 阶段性审查结论 |
| `history/E2EE_REVIEW_SUMMARY.md` | 审查总结 | 保留 e2ee 阶段性审查结论 |
| `history/FEDERATION_REVIEW_SUMMARY.md` | 审查总结 | 保留 federation 阶段性审查结论 |
| `history/FRIEND_REVIEW_SUMMARY.md` | 审查总结 | 保留 friend 阶段性审查结论 |
| `history/KEY_BACKUP_REVIEW_SUMMARY.md` | 审查总结 | 保留 key-backup 阶段性审查结论 |
| `history/MEDIA_REVIEW_SUMMARY.md` | 审查总结 | 保留 media 阶段性审查结论 |
| `history/SPACE_REVIEW_SUMMARY.md` | 审查总结 | 保留 space 首轮审查结论；当前 space 主契约以 `space.md` 为准 |
| `history/SYNC_REVIEW_SUMMARY.md` | 审查总结 | 保留 sync 阶段性审查结论 |
| `history/auth-enhanced.md` | 历史增强版契约 | 保留 auth 在 2026-04-15 的补充型契约写法 |
| `history/device-enhanced.md` | 历史增强版契约 | 保留 device 在 2026-04-15 的补充型契约写法 |
| `history/dm-enhanced.md` | 历史增强版契约 | 保留 dm 在 2026-04-15 的补充型契约写法 |

### 历史材料使用原则

- 只在需要追溯历史判断、查专项整改过程、对比旧版文档结构时使用这些文件。
- 若历史材料与主契约冲突，以模块主文档和后端当前代码为准。
- 新一轮契约修订不再继续向这些历史材料追加“当前结论”，而是统一更新主契约文档与总表。

## 文档约束

- 只记录“当前已挂载并可达”的外部路由，不把未挂载文件当成可用 API。
- 路径与 HTTP 方法以 `Router::route()` / `nest()` / `merge()` 为准。
- 认证要求以 `AuthenticatedUser`、`AdminUser`、`OptionalAuthenticatedUser` 与联邦中间件为准。
- 对复杂响应体，只记录代码中稳定可见的字段；若由 service 直接序列化返回，会在备注中标明。
- 版本兼容路由必须拆开描述，不把 `v1` / `r0` / `v3` 混写为一个虚构端点。

## 当前明确排除

以下路由文件存在实现，但当前未在主装配入口挂载，不计入“可达 API 契约”：

- `synapse-rust/src/web/routes/openclaw.rs`
- `synapse-rust/src/web/routes/websocket.rs`

## 使用方式

- 先看对应模块文档，再用 `backend-route-inventory.md` 复核尚未独立拆文档的模块。
- 后端新增路由时，先更新总表，再补充模块文档。
- 只要处理器修改了 `Json(...)`、`json!(...)` 或 DTO 字段，就要同步修订契约文档。
- SDK 公共 API 类型签名变更（如 `any` → 具体类型）须在 `CHANGELOG.md` 中记录。
