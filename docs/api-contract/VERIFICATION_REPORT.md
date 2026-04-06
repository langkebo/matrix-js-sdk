# API 契约交叉验证报告

> 审查日期: 2026-04-04
> 审查对象: `synapse-rust` 当前磁盘代码 + `matrix-js-sdk/docs/api-contract`

## 验证方法

1. 从 `synapse-rust/src/web/routes/assembly.rs` 确认实际挂载的顶层 router。
2. 从 `synapse-rust/src/web/routes/admin/mod.rs` 确认管理端聚合模块。
3. 从各 route 文件核对 `route()`、`nest()`、`merge()` 组合关系。
4. 从 `extractors/auth.rs` 与联邦中间件确认认证要求。
5. 对现有文档逐份重写，删除依赖 SDK 推断但与后端不一致的描述。

## 已重审文档

| 文档 | 结果 | 说明 |
|------|------|------|
| `README.md` | 已更新 | 改为后端优先索引 |
| `auth.md` | 已更新 | 补上 auth/account/directory/discovery 真实路由 |
| `account-data.md` | 已新增 | 拆分用户级/房间级 account data 与 filter 契约 |
| `admin.md` | 已更新 | 按 admin 子模块分组重写 |
| `device.md` | 已新增 | 补齐设备管理与设备变更查询 |
| `e2ee.md` | 已新增 | 拆分核心 E2EE、设备信任与 to-device 契约 |
| `key-backup.md` | 已新增 | 拆分 room key backup / recover / import-export / secure backup |
| `media.md` | 已新增 | 补齐 Media API 与配额端点 |
| `presence.md` | 已新增 | 补齐 presence 状态与 v3 presence list |
| `room.md` | 已更新 | 按 `r0/v1/v3` 真实挂载重写 |
| `room-summary.md` | 已新增 | 拆分 room summary 读写与内部接口 |
| `sync.md` | 已更新 | 区分 GET sync 与 POST Sliding Sync |
| `push.md` | 已更新 | 以 `push.rs` 为准重写 |
| `space.md` | 已更新 | 以 `space.rs` 为准重写 |
| `dm.md` | 已更新 | 改为后端真实 DM 路由 |
| `friend.md` | 已更新 | 改为 `friend_room.rs` 真实路由 |
| `verification.md` | 已新增 | 拆分 SAS / QR 设备校验兼容路由 |
| `federation.md` | 已新增 | 拆分 public/protected federation 路由 |
| `backend-route-inventory.md` | 新增 | 覆盖未单独拆分模块 |
| `CHANGELOG.md` | 已更新 | 记录本轮重审 |

## 已确认排除项

以下文件未在主装配入口挂载，不计入本轮可达 API 契约：

- `synapse-rust/src/web/routes/openclaw.rs`
- `synapse-rust/src/web/routes/key_rotation.rs`
- `synapse-rust/src/web/routes/websocket.rs`

## 本轮修正的典型问题

- 纠正把纯 SDK 本地行为误写成后端 HTTP 接口的问题
- 纠正把 `v1` / `r0` / `v3` 混写成单一路径的问题
- 纠正把未挂载文件路由当成可用接口的问题
- 纠正把 SDK 假定字段写成后端已承诺字段的问题

## 仍需注意

- 复杂响应对象有一部分由 service 层直接序列化返回，文档目前只保留了稳定可见字段与响应形态。
- 条件挂载模块 `SAML`、`OIDC` 的“是否可达”取决于运行时配置，因此只在总表中标注来源，不在核心模块文档里宣称默认启用。

## 结论

- 已将契约文档基线从“SDK 推断”切换为“后端真实挂载代码”。
- 核心业务模块与核心 E2EE 路由已逐文档重审。
- 其余已挂载模块继续通过 `backend-route-inventory.md` 补齐索引与路径族说明。
