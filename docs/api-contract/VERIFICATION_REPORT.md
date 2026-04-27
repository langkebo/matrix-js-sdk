# API 契约交叉验证报告

> 审查日期: 2026-04-27
> 审查对象: `synapse-rust` 当前磁盘代码 + `matrix-js-sdk/docs/api-contract`

## 验证方法

1. 从 `synapse-rust/src/web/routes/assembly.rs` 确认实际挂载的顶层 router。
2. 从 `synapse-rust/src/web/routes/admin/mod.rs` 确认管理端聚合模块。
3. 从各 route 文件核对 `route()`、`nest()`、`merge()` 组合关系。
4. 从 `extractors/auth.rs` 与联邦中间件确认认证要求。
5. 对现有文档逐份重写，删除依赖 SDK 推断但与后端不一致的描述。

## 已重审文档

| 文档                         | 结果   | 说明                                                           |
| ---------------------------- | ------ | -------------------------------------------------------------- |
| `README.md`                  | 已更新 | 改为后端优先索引                                               |
| `auth.md`                    | 已更新 | 补上 auth/account/directory/discovery 真实路由                 |
| `account-data.md`            | 已更新 | 覆盖用户级/房间级 account data、filter、openid 与 room tags    |
| `admin.md`                   | 已更新 | 按 admin 子模块分组重写                                        |
| `device.md`                  | 已新增 | 补齐设备管理与设备变更查询                                     |
| `e2ee.md`                    | 已新增 | 拆分核心 E2EE、设备信任与 to-device 契约                       |
| `key-backup.md`              | 已新增 | 拆分 room key backup / recover / import-export / secure backup |
| `media.md`                   | 已新增 | 补齐 Media API 与配额端点                                      |
| `voice.md`                   | 已新增 | 从混合 Media 描述中拆分 voice 独立契约并复核 SDK/后端差异      |
| `presence.md`                | 已新增 | 补齐 presence 状态与 v3 presence list                          |
| `room.md`                    | 已更新 | 按 `r0/v1/v3` 真实挂载重写                                     |
| `room-summary.md`            | 已新增 | 拆分 room summary 读写与内部接口                               |
| `sync.md`                    | 已更新 | 区分 GET sync 与 POST Sliding Sync                             |
| `push.md`                    | 已更新 | 以 `push.rs` 为准重写                                          |
| `rendezvous.md`              | 已新增 | 覆盖二维码登录会话与消息交换路由                               |
| `space.md`                   | 已更新 | 以 `space.rs` 为准重写                                         |
| `worker-admin.md`            | 已更新 | 区分管理员控制面与 worker replication 协议面                   |
| `dm.md`                      | 已更新 | 改为后端真实 DM 路由                                           |
| `friend.md`                  | 已更新 | 改为 `friend_room.rs` 真实路由                                 |
| `widget.md`                  | 已新增 | 拆分 widget CRUD、权限、会话与房间级能力接口                   |
| `thread.md`                  | 已新增 | 拆分全局/房间线程、回复、订阅、统计与兼容搜索接口              |
| `verification.md`            | 已新增 | 拆分 SAS / QR 设备校验兼容路由                                 |
| `federation.md`              | 已新增 | 拆分 public/protected federation 路由                          |
| `backend-route-inventory.md` | 新增   | 覆盖未单独拆分模块                                             |
| `CHANGELOG.md`               | 已更新 | 记录本轮重审                                                   |

## 已确认排除项

以下文件未在主装配入口挂载，不计入本轮可达 API 契约：

- `synapse-rust/src/web/routes/openclaw.rs`
- `synapse-rust/src/web/routes/websocket.rs`

## 本轮修正的典型问题

- 纠正把纯 SDK 本地行为误写成后端 HTTP 接口的问题
- 纠正把 `v1` / `r0` / `v3` 混写成单一路径的问题
- 纠正把未挂载文件路由或未复核模块误判为不可达的问题
- 纠正把 SDK 假定字段写成后端已承诺字段的问题
- 纠正把不同认证层或条件挂载接口误写成统一可达接口的问题

### 已收敛的误报示例

- `room.md` 不再把 widget `capabilities` / `send` 误写为“未出现在路由树中”
- `auth.md` 不再把 `GET /_matrix/client/v1/config/client` 误写为返回 `M_UNRECOGNIZED`
- `key-backup.md` 不再把 `uploadSessionKey()` 的单会话 PUT 路径误写为未挂载
- `backend-route-inventory.md` / `README.md` / `CHANGELOG.md` 不再把 `key_rotation.rs` 误列为未挂载文件
- `media.md` 不再继续把 `voice.rs` 混写为 Media 子章节，Voice 改为独立契约文档
- `thread.md` 不再把 `ThreadingManager` 仅视作本地 timeline 能力，现已补齐 `thread.rs` 全量 REST 封装、收敛真实返回类型，并补齐字段级响应契约
- `sync` 不再把 `getMyRooms()` 的旧 `join_state` 类型假设直接映射为后端响应；SDK 现以真实 `membership` 字段为准，并在 `membership` / `join_state` 之间双向补齐兼容别名
- `thread` 不再遗漏创建线程时后端必需的 `content` 请求体字段，也不再漏掉 legacy 线程列表的 `include_all` 查询参数
- `room-summary` 不再把 `getRoomThread()` 与 `getRoomThreadById()` 视作同一返回结构；SDK 现已按两条后端路径的真实响应拆分类型
- `room-summary` 不再把 `getRoomCapabilities()`、`getRoomNotifications()`、`getRoomUnreadCount()`、`getRoomMetadata()` 约束为旧字段名；SDK 现已按 `room.rs` 真实响应补齐 `features` / `join_rule` / `next_token` / `notification_type` / `ts` / `is_read` / `notification_count` / `highlight_count` / `encryption` / `is_public` / `member_count` / `created_ts`，并为通知分页与旧未读计数字段补出兼容别名
- `sync` 已补充 `peekInRoom()` 的 `/events` 回归校验，确认 SDK 会消费 `chunk` 中带 `event_id` 的房间事件，并使用响应 `end` 作为下一次轮询的 `from`
- `sync` 已补充 `/sync` 查询参数回归校验，确认 SDK 端会继续透传 `set_presence` 与 filter id；后端现已消费已保存 filter 与 inline JSON filter 的 `event_fields` / `event_format` / `room.rooms` / `room.not_rooms` / `room.include_leave` / `room.timeline.limit`，并支持 `contains_url` 值过滤、按 `user_id + device_id + room_id` 维度缓存已发送成员的 `lazy_load_members`，以及真正生效的 `include_redundant_members`；`room.timeline` 的基础类型/发送者过滤已下推到事件抓取链路，`room.state` / `room.ephemeral` / `room.account_data` 与顶层 `presence` 也已接入同级基础事件过滤，增量 `/sync` 在未开启 lazy-load 时也会正常返回 state delta，同时 `lazy_load_members` 在 `timeline.limited = true` 时不会额外回放仅存在于 state delta 的成员变化
- `sync` 已额外补充 timeline 截断边界回归，确认 `/sync` 会先探测 `limit + 1` 条事件后再裁剪输出，因此 `timeline.limited` 只会在确有更多 timeline 事件未返回时置为 `true`，且最终 `timeline.events` 会按旧到新顺序交付给客户端
- `account-data` 不再把 `tags.rs` 视为未拆文档模块，现已并入 `account-data.md`，补齐 `/tags` 全量与按房间读写删除契约
- `worker-admin` 不再把全部 `/_synapse/worker/v1/*` 端点误写为管理员接口；文档现已区分 admin 控制面、replication HTTP 协议面，以及 `worker.enabled` 条件挂载行为
- `worker-admin` 不再把复制位点接口误写为 `GET /replication/{worker_id}/{stream_name}`；现已按真实实现修正为 `GET /replication/{worker_id}/position?stream_name=...` 与 `PUT /replication/{worker_id}/{stream_name}`

## 仍需注意

- `room-summary.md`、`push.md` 与 `sync.md` 已补齐当前可稳定核对的字段级契约；其余直接复用 Matrix 标准大对象且由服务层透传的模块，仍以稳定字段与顶层形态为主。
- 复杂响应对象里仍有部分字段由 service 层直接序列化透传；对于 SDK 以 `Record<string, unknown>` 接收的结果，文档只承诺稳定字段与顶层形态。
- 条件挂载模块 `SAML`、`OIDC` 的“是否可达”取决于运行时配置，因此只在总表中标注来源，不在核心模块文档里宣称默认启用。
- `worker` 协议面同样属于条件挂载模块，其可达性取决于 `state.services.config.worker.enabled`，文档已按“默认代码行为 + 条件说明”记录。
- `sync` 的 `set_presence` 已确认被后端消费；`filter` 现已接入已保存 filter 与 inline JSON filter 的 `event_fields` / `event_format` / `room.rooms` / `room.not_rooms` / `room.include_leave` / `room.timeline.limit`，并支持 `room.timeline` / `room.state` / `room.ephemeral` / `room.account_data` / `presence` 的基础类型/发送者过滤、`contains_url` 值过滤，以及带数据库持久化与进程内热缓存的 `lazy_load_members` / `include_redundant_members`。其中 `lazy_load_members` 已补齐非截断增量 `/sync` 中“来自 state delta 但不在 timeline 的 membership 变化”补发语义，并已明确 `timeline.limited = true` 时不会因此额外扩张成员 state；未开启 lazy-load 的增量 `/sync` 也会继续返回普通 state delta。当前主要剩余差异已从缓存持久化转移到更细的 Synapse 兼容边角语义。
- `sync` 的 `/sync` timeline 现已补齐两个基础兼容点：返回给客户端的 `timeline.events` 会保持旧到新顺序，而 `timeline.limited` 只会在服务端确认还有更多 timeline 事件未返回时才置为 `true`；这也避免了事件数恰好等于 `room.timeline.limit` 时的误报。
- `sync` 本轮额外执行了 `cargo test --lib` 全量库单测验证，结果为 `1757 passed; 0 failed; 1 ignored`，当前库测试链路已恢复稳定。

## 结论

- 已将契约文档基线从“SDK 推断”切换为“后端真实挂载代码”。
- `README.md` 已明确区分“现行主契约基线”与“历史审查/增强版材料”，目录入口层面的阅读优先级已收敛。
- 核心业务模块与核心 E2EE 路由已逐文档重审。
- Account Data / Tags / Space / Worker 四个近期偏差较集中的模块，已完成第二轮字段级收敛。
- Voice / Widget / Thread 三个此前偏差较大的模块，现已完成首轮 SDK-契约回补并落地回归校验。
- Room Summary / Push 已从“仅记录稳定字段”推进到“字段级响应审计 + SDK 类型映射”。
- Sync 已从“响应形态说明”推进到“字段级同步/Sliding Sync 契约 + SDK 行为/类型回归校验”。
- Sync 当前额外完成了 `cargo test --lib` 全量验证，并新增 state-only 增量 `/sync` 回归，说明本轮 `/sync` lazy-load 与 state delta 相关改动未破坏库级单测集合。
- Thread 已从“REST 封装覆盖”推进到“请求体/查询参数级契约回补 + 回归校验”。
- Room Summary 已补充线程读取分支说明，并收敛 SDK 的线程详情返回类型。
- 其余已挂载模块继续通过 `backend-route-inventory.md` 补齐索引与路径族说明。
