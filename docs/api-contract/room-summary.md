# Room Summary 模块契约

> 审查来源: `synapse-rust/src/web/routes/room_summary.rs`

## 挂载版本

| 前缀 | 说明 |
|------|------|
| `/_matrix/client/r0` | 只读 summary 路由 |
| `/_matrix/client/v3` | 读写与维护路由 |
| `/_synapse/room_summary/v1` | 内部汇总与更新处理接口 |

## 客户端路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary` | 获取房间摘要 |
| GET | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/members` | 获取摘要成员 |
| GET | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/state` | 获取摘要状态 |
| GET | `/_matrix/client/{r0,v3}/rooms/{room_id}/summary/stats` | 获取摘要统计 |
| POST | `/_matrix/client/v3/rooms/{room_id}/summary` | 创建或刷新摘要 |
| PUT | `/_matrix/client/v3/rooms/{room_id}/summary` | 更新摘要 |
| DELETE | `/_matrix/client/v3/rooms/{room_id}/summary` | 删除摘要 |
| POST | `/_matrix/client/v3/rooms/{room_id}/summary/sync` | 同步摘要 |
| POST | `/_matrix/client/v3/rooms/{room_id}/summary/members` | 批量写入成员摘要 |
| PUT | `/_matrix/client/v3/rooms/{room_id}/summary/members/{user_id}` | 更新单成员摘要 |
| DELETE | `/_matrix/client/v3/rooms/{room_id}/summary/members/{user_id}` | 删除单成员摘要 |
| GET | `/_matrix/client/v3/rooms/{room_id}/summary/state/{event_type}/{state_key}` | 获取特定状态摘要 |
| PUT | `/_matrix/client/v3/rooms/{room_id}/summary/state/{event_type}/{state_key}` | 更新特定状态摘要 |
| POST | `/_matrix/client/v3/rooms/{room_id}/summary/stats/recalculate` | 重算统计 |
| POST | `/_matrix/client/v3/rooms/{room_id}/summary/heroes/recalculate` | 重算 heroes |
| POST | `/_matrix/client/v3/rooms/{room_id}/summary/unread/clear` | 清理未读摘要 |

## 内部路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/_synapse/room_summary/v1/summaries` | 获取用户摘要列表 |
| POST | `/_synapse/room_summary/v1/summaries` | 创建内部 room summary |
| POST | `/_synapse/room_summary/v1/updates/process` | 处理待更新摘要 |

## 响应形态

- 读取类接口返回 summary、members、state、stats 等 JSON 对象
- 维护类接口通常返回空对象或更新结果
- 内部列表接口返回用户相关的 summary 集合

## 认证与状态码

- 客户端路由默认需要用户认证
- 内部 `/_synapse/room_summary/v1/*` 路由由当前服务内部逻辑使用
- 常见状态码: `200` `400` `401` `404`

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/room_summary.rs`
