# Matrix JS SDK API 契约目录

> 本目录以 `synapse-rust` 当前磁盘代码为准，按“装配入口 -> 路由模块 -> 处理器/提取器”重审。

## 审查基线

- 主装配入口: `synapse-rust/src/web/routes/assembly.rs`
- 管理端装配入口: `synapse-rust/src/web/routes/admin/mod.rs`
- 联邦装配入口: `synapse-rust/src/web/routes/federation.rs`
- 认证提取器: `synapse-rust/src/web/routes/extractors/auth.rs`
- 条件挂载模块: `SAML`、`OIDC`

## 文档索引

| 文档                         | 范围                                                      | 说明                                                           |
| ---------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `auth.md`                    | 认证、账户、目录、公开发现端点                            | 覆盖 `assembly.rs` 中 auth/account/directory 顶层路由          |
| `account-data.md`            | 用户级/房间级 account data 与 filter                      | 覆盖 `account_data.rs`                                         |
| `admin.md`                   | `/_synapse/admin/*`                                       | 覆盖用户、房间、媒体、安全、通知、令牌、联邦、报表、保留策略   |
| `device.md`                  | 设备管理与设备列表变更                                    | 覆盖 `device.rs`                                               |
| `e2ee.md`                    | 核心 E2EE、设备信任、to-device                            | 覆盖 `e2ee_routes.rs`                                          |
| `key-backup.md`              | Room key backup / recover / import-export / secure backup | 覆盖 `key_backup.rs` 与 `e2ee_routes.rs` 中 secure backup 路由 |
| `media.md`                   | Media API 与配额接口                                      | 覆盖 `media.rs`                                                |
| `presence.md`                | Presence 状态与 presence list                             | 覆盖 `presence.rs`                                             |
| `room.md`                    | Room 主链路与扩展房间端点                                 | 覆盖 `room.rs` 的 `r0/v1/v3` 路由树                            |
| `room-summary.md`            | Room Summary 读写与内部汇总接口                           | 覆盖 `room_summary.rs`                                         |
| `sync.md`                    | Sync / Events / Joined Rooms / Sliding Sync               | 覆盖 `sync.rs` 与 `sliding_sync.rs`                            |
| `push.md`                    | Pushers / Push Rules / Notifications                      | 覆盖 `push.rs`                                                 |
| `space.md`                   | Space CRUD / 层级 / 树路径                                | 覆盖 `space.rs`                                                |
| `dm.md`                      | DM 创建、direct map、DM 伙伴查询                          | 覆盖 `dm.rs`                                                   |
| `friend.md`                  | 好友、好友请求、分组                                      | 覆盖 `friend_room.rs`                                          |
| `verification.md`            | SAS/二维码设备校验                                        | 覆盖 `verification_routes.rs`                                  |
| `federation.md`              | Matrix Federation public/protected 路由                   | 覆盖 `federation.rs`                                           |
| `backend-route-inventory.md` | 已挂载后端路由总表                                        | 用于补足未单独拆文档的模块                                     |
| `exports.md`                 | SDK 导出清单                                              | 与 `package.json#exports` 对齐，用于 CI 校验                   |
| `VERIFICATION_REPORT.md`     | 文档与代码交叉验证说明                                    | 记录审查方法、已覆盖范围、明确排除项                           |
| `CHANGELOG.md`               | 本轮契约修订记录                                          | 记录重审日期与范围                                             |

## 文档约束

- 只记录“当前已挂载并可达”的外部路由，不把未挂载文件当成可用 API。
- 路径与 HTTP 方法以 `Router::route()` / `nest()` / `merge()` 为准。
- 认证要求以 `AuthenticatedUser`、`AdminUser`、`OptionalAuthenticatedUser` 与联邦中间件为准。
- 对复杂响应体，只记录代码中稳定可见的字段；若由 service 直接序列化返回，会在备注中标明。
- 版本兼容路由必须拆开描述，不把 `v1` / `r0` / `v3` 混写为一个虚构端点。

## 当前明确排除

以下路由文件存在实现，但当前未在主装配入口挂载，不计入“可达 API 契约”：

- `synapse-rust/src/web/routes/openclaw.rs`
- `synapse-rust/src/web/routes/key_rotation.rs`
- `synapse-rust/src/web/routes/websocket.rs`

## 使用方式

- 先看对应模块文档，再用 `backend-route-inventory.md` 复核完整覆盖。
- 后端新增路由时，先更新总表，再补充模块文档。
- 只要处理器修改了 `Json(...)`、`json!(...)` 或 DTO 字段，就要同步修订契约文档。
- SDK 公共 API 类型签名变更（如 `any` → 具体类型）须在 `CHANGELOG.md` 中记录。
