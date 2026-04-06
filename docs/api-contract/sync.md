# Sync 模块契约

> 审查来源: `synapse-rust/src/web/routes/sync.rs` 与 `sliding_sync.rs`

## 挂载版本

| 前缀 | 路由 |
|------|------|
| `/_matrix/client/r0` | `/sync` `/events` `/joined_rooms` |
| `/_matrix/client/v1` | `/sync` |
| `/_matrix/client/v3` | `/sync` `/events` `/joined_rooms` `/my_rooms` |
| `/_matrix/client/unstable/org.matrix.msc3575` | `POST /sync` |

## GET 同步端点

| 方法 | 路径 | 查询参数 | 主要响应字段 | 认证 |
|------|------|----------|--------------|------|
| GET | `/_matrix/client/r0/sync` | `since?` `timeout?` `filter?` `full_state?` `set_presence?` | `next_batch` `rooms` `presence` `account_data` `to_device` | 用户 |
| GET | `/_matrix/client/v1/sync` | 同上 | 同上 | 用户 |
| GET | `/_matrix/client/v3/sync` | 同上 | 同上 | 用户 |
| GET | `/_matrix/client/r0/events` | 流水线查询参数 | 事件流结果 | 用户 |
| GET | `/_matrix/client/v3/events` | 流水线查询参数 | 事件流结果 | 用户 |
| GET | `/_matrix/client/r0/joined_rooms` | 无 | `joined_rooms` | 用户 |
| GET | `/_matrix/client/v3/joined_rooms` | 无 | `joined_rooms` | 用户 |
| GET | `/_matrix/client/v3/my_rooms` | 无 | `rooms` | 用户 |

## POST Sliding Sync

| 方法 | 路径 | 主要请求字段 | 主要响应字段 | 认证 |
|------|------|--------------|--------------|------|
| POST | `/_matrix/client/v3/sync` | `pos?` `lists?` `rooms?` `extensions?` | `pos` `lists` `rooms` `extensions` | 用户 |
| POST | `/_matrix/client/unstable/org.matrix.msc3575/sync` | 同上 | 同上 | 用户 |

## 响应形态

- `GET /sync`: Matrix 标准增量同步响应，核心字段为 `next_batch`
- `GET /joined_rooms`: `{ "joined_rooms": ["!room:server", ...] }`
- `GET /my_rooms`: `{ "rooms": [{ "room_id": "...", "membership": "join" }, ...] }`
- `POST /sync`: Sliding Sync 响应，核心字段为 `pos`、`lists`、`rooms`

## 常见状态码

| 状态码 | 说明 |
|--------|------|
| `200` | 请求成功 |
| `400` | 参数错误 |
| `401` | Token 无效或缺失 |
| `429` | 长轮询或同步请求被限流 |

## 代码定位

- 路由声明: `synapse-rust/src/web/routes/sync.rs`
- Sliding Sync 路由: `synapse-rust/src/web/routes/sliding_sync.rs`
- 处理器: `synapse-rust/src/web/routes/handlers/sync.rs`
