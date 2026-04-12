# Room 模块契约

> 审查来源: `synapse-rust/src/web/routes/room.rs`

## 挂载版本

| 前缀                 | 说明                                                    |
| -------------------- | ------------------------------------------------------- |
| `/_matrix/client/r0` | 兼容主链路 + `createRoom` + `get_membership_events`     |
| `/_matrix/client/v1` | 仅 `m.room.power_levels` 兼容读取                       |
| `/_matrix/client/v3` | 兼容主链路 + 扩展房间能力、通知、线程、密钥、粘性事件等 |

## 认证与通用响应

- 本文件中的房间端点默认需要用户 access token。
- 常见错误码: `400` 参数错误、`401` 未认证、`403` 无权限、`404` 房间/事件不存在、`429` 限流。
- 常见成功响应:
    - 写操作返回空对象或 `{ "event_id": "..." }`
    - 查询操作返回事件、列表、统计信息或 service 组装后的 JSON 对象

## r0 / v3 共享主链路

| 方法         | 路径                                                                         | 主要请求参数                                          | 主要响应字段                                                 |
| ------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}`                                    | `room_id`                                             | 房间基础信息                                                 |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/messages`                           | `from` `to?` `dir` `limit?` `filter?`                 | `chunk` `start` `end`                                        |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/search`                             | 搜索条件                                              | 搜索结果                                                     |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/membership/{user_id}`               | `user_id`                                             | 成员关系                                                     |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/receipt/{receipt_type}/{event_id}`  | receipt 内容                                          | 空对象                                                       |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/receipts/{receipt_type}/{event_id}` | 路径参数                                              | receipt 列表                                                 |
| POST/PUT     | `/_matrix/client/{r0,v3}/rooms/{room_id}/read_markers`                       | read marker 内容                                      | 空对象                                                       |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/aliases`                            | `room_id`                                             | 房间别名列表                                                 |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/join`                               | 可选 join body                                        | `room_id`                                                    |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/leave`                              | 可选 reason                                           | 空对象                                                       |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/upgrade`                            | `new_version`                                         | 新房间 ID                                                    |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/forget`                             | 可选 body                                             | 空对象                                                       |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/initialSync`                        | 查询参数                                              | 初始同步响应                                                 |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/members`                            | `membership?` 等                                      | `chunk`                                                      |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/members/recent`                     | 查询参数                                              | 最近成员                                                     |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/joined_members`                     | 无                                                    | `joined` 成员映射                                            |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/version`                            | 无                                                    | `room_version`                                               |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/invite`                             | `user_id` `reason?`                                   | 空对象                                                       |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/invites`                            | 无                                                    | 邀请列表                                                     |
| GET          | `/_matrix/client/{r0,v3}/user/{user_id}/rooms`                               | `user_id`                                             | 用户房间列表                                                 |
| GET/PUT      | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/{state_key}`     | 状态事件内容                                          | 状态事件                                                     |
| GET/PUT      | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}/`                | 空 state key                                          | 状态事件                                                     |
| GET/POST/PUT | `/_matrix/client/{r0,v3}/rooms/{room_id}/state/{event_type}`                 | 状态事件内容                                          | 状态事件 / 空对象                                            |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/state`                              | 无                                                    | 房间状态快照                                                 |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/redact/{event_id}/{txn_id}`         | redaction body                                        | `event_id`                                                   |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/redact/{event_id}/{txn_id}`         | redaction body                                        | `event_id`                                                   |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/guest_access`                       | `guest_access`                                        | 空对象                                                       |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/hierarchy`                          | `limit?` `max_depth?` `suggested_only?` `from_token?` | 房间层级结构                                                 |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/kick`                               | `user_id` `reason?`                                   | 空对象                                                       |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/ban`                                | `user_id` `reason?`                                   | 空对象                                                       |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/unban`                              | `user_id` `reason?`                                   | 空对象                                                       |
| GET/POST     | `/_matrix/client/{r0,v3}/rooms/{room_id}/pinned_events`                      | POST 时提供事件信息                                   | pinned events                                                |
| DELETE       | `/_matrix/client/{r0,v3}/rooms/{room_id}/pinned_events/{event_id}`           | `event_id`                                            | 空对象                                                       |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/send/{event_type}/{txn_id}`         | 事件内容                                              | `event_id`                                                   |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/event/{event_id}`                   | `event_id`                                            | 单个事件                                                     |
| GET          | `/_matrix/client/{r0,v3}/rooms/{room_id}/context/{event_id}`                 | `event_id` `limit?` `filter?`                         | `event` `events_before` `events_after` `start` `end` `state` |
| PUT          | `/_matrix/client/{r0,v3}/rooms/{room_id}/typing/{user_id}`                   | `typing` `timeout?`                                   | 空对象                                                       |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/report`                             | `reason` `score?`                                     | 空对象                                                       |
| POST         | `/_matrix/client/{r0,v3}/rooms/{room_id}/report/{event_id}`                  | `reason` `score?`                                     | 空对象                                                       |

## r0 专用

| 方法 | 路径                                                       | 说明                 |
| ---- | ---------------------------------------------------------- | -------------------- |
| POST | `/_matrix/client/r0/createRoom`                            | 创建房间             |
| POST | `/_matrix/client/r0/rooms/{room_id}/get_membership_events` | 获取 membership 事件 |

## v1 专用

| 方法 | 路径                                                            | 说明                   |
| ---- | --------------------------------------------------------------- | ---------------------- |
| GET  | `/_matrix/client/v1/rooms/{room_id}/state/m.room.power_levels/` | 兼容 power levels 读取 |

## v3 扩展房间端点

| 方法     | 路径                                                                  | 主要请求参数        | 主要响应字段        |
| -------- | --------------------------------------------------------------------- | ------------------- | ------------------- |
| GET      | `/_matrix/client/v3/rooms/{room_id}/notifications`                    | 分页查询参数        | `notifications`     |
| GET      | `/_matrix/client/v3/rooms/{room_id}/capabilities`                     | 无                  | 房间能力            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/fragments/{user_id}`              | `user_id`           | 用户碎片信息        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/service_types`                    | 无                  | 服务类型列表        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/sync`                             | 查询参数            | 房间级同步结果      |
| GET      | `/_matrix/client/v3/rooms/{room_id}/timeline`                         | 查询参数            | 时间线              |
| GET      | `/_matrix/client/v3/rooms/{room_id}/unread_count`                     | 无                  | 未读计数            |
| GET/PUT  | `/_matrix/client/v3/rooms/{room_id}/account_data/{type}`              | account data 内容   | account data        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/turn_server`                      | 无                  | TURN 配置           |
| GET      | `/_matrix/client/v3/rooms/{room_id}/metadata`                         | 无                  | 房间元数据          |
| GET/PUT  | `/_matrix/client/v3/rooms/{room_id}/vault_data`                       | vault 内容          | vault 数据          |
| GET      | `/_matrix/client/v3/rooms/{room_id}/retention`                        | 无                  | retention 策略      |
| GET      | `/_matrix/client/v3/rooms/{room_id}/external_ids`                     | 无                  | 外部关联 ID         |
| GET      | `/_matrix/client/v3/rooms/{room_id}/spaces`                           | 无                  | 所属 space 列表     |
| GET      | `/_matrix/client/v3/rooms/{room_id}/event_perspective`                | 查询参数            | 事件视角数据        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/encrypted_events`                 | 查询参数            | 加密事件摘要        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/reduced_events`                   | 查询参数            | 规约事件列表        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/rendered/`                        | 查询参数            | 渲染结果            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/event/{event_id}/url`             | `event_id`          | 事件 URL            |
| POST     | `/_matrix/client/v3/rooms/{room_id}/translate/{event_id}`             | 翻译请求            | 翻译结果            |
| POST     | `/_matrix/client/v3/rooms/{room_id}/convert/{event_id}`               | 转换请求            | 转换结果            |
| PUT      | `/_matrix/client/v3/rooms/{room_id}/sign/{event_id}`                  | 签名请求            | 签名结果            |
| POST     | `/_matrix/client/v3/rooms/{room_id}/verify/{event_id}`                | 校验请求            | 校验结果            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys`                             | 无                  | 房间密钥            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys/count`                       | 无                  | 密钥计数            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys/version`                     | 无                  | 密钥版本            |
| POST     | `/_matrix/client/v3/rooms/{room_id}/keys/claim`                       | claim body          | claim 结果          |
| PUT      | `/_matrix/client/v3/rooms/{room_id}/room_keys/keys`                   | 转发 room key       | 空对象              |
| GET      | `/_matrix/client/v3/rooms/{room_id}/message_queue`                    | 无                  | 队列消息            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/device/{device_id}`               | `device_id`         | 房间设备信息        |
| GET      | `/_matrix/client/v3/rooms/{room_id}/threads/{thread_id}`              | `thread_id`         | 线程详情            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/keys/{event_id}`                  | `event_id`          | 事件密钥            |
| GET      | `/_matrix/client/v3/rooms/{room_id}/thread/{event_id}`                | `event_id`          | 线程视图            |
| POST     | `/_matrix/client/v3/join/{room_id_or_alias}`                          | 可选 via 信息       | `room_id`           |
| POST     | `/_matrix/client/v3/knock/{room_id_or_alias}`                         | knock 请求体        | `room_id` / 空对象  |
| POST     | `/_matrix/client/v3/invite/{room_id}`                                 | `user_id`           | 空对象              |
| GET/POST | `/_matrix/client/v3/rooms/{room_id}/invite_blocklist`                 | blocklist body      | blocklist           |
| GET/POST | `/_matrix/client/v3/rooms/{room_id}/invite_allowlist`                 | allowlist body      | allowlist           |
| GET/POST | `/_matrix/client/v3/rooms/{room_id}/sticky_events`                    | sticky event body   | sticky events       |
| DELETE   | `/_matrix/client/v3/rooms/{room_id}/sticky_events/{event_type}`       | `event_type`        | 空对象              |
| GET      | `/_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities` | `widget_id`         | widget capabilities |
| POST     | `/_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/send`         | widget message body | widget 响应         |

## 典型请求/响应

- 创建房间: `POST /createRoom`，请求体常见字段为 `name` `topic` `invite` `initial_state`，成功返回 `{ "room_id": "..." }`
- 发送消息: `PUT /rooms/{room_id}/send/{event_type}/{txn_id}`，请求体为事件 `content`，成功返回 `{ "event_id": "..." }`
- 拉取消息: `GET /rooms/{room_id}/messages`，核心查询参数为 `from` `dir` `limit?`，返回 `chunk/start/end`
- 成员管理: `invite` `kick` `ban` `unban` 统一返回空对象

## 代码定位

- 路由声明: `synapse-rust/src/web/routes/room.rs`
- 处理器主体: `synapse-rust/src/web/routes/handlers/room.rs`
