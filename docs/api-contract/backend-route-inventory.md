# 后端路由总表

> 本文档用于补足未单独拆分模块的后端路由覆盖。路径与方法以当前装配代码为准。

## 主装配已挂载模块

| 模块 | 路由源文件 | 真实挂载情况 |
|------|------------|--------------|
| 顶层公开端点 | `assembly.rs` | `/` `/health` `versions` `well-known` `capabilities` `media/config` `voip/*` |
| Account Data | `account_data.rs` | 已拆到 `account-data.md` |
| Device | `device.rs` | 已拆到 `device.md` |
| E2EE Core | `e2ee_routes.rs` | 已拆到 `e2ee.md` |
| Presence | `presence.rs` | 已拆到 `presence.md` |
| Media | `media.rs` | 已拆到 `media.md` |
| Key Backup | `key_backup.rs` | 已拆到 `key-backup.md` |
| Verification | `verification_routes.rs` | 已拆到 `verification.md` |
| Relations / Reactions | `relations.rs` `reactions.rs` | `/_matrix/client/v1|v3` 与 `r0` 兼容路由 |
| Moderation | `moderation.rs` | 举报与 scanner 相关房间路由 |
| Room Summary | `room_summary.rs` | 已拆到 `room-summary.md` |
| Typing | `typing.rs` | `/_matrix/client/v3/rooms/{room_id}/typing*` |
| Thread | `handlers/thread.rs` | `/_matrix/client/v1/rooms/{room_id}/threads*` |
| Tags | `tags.rs` | `/_matrix/client/r0|v3/user/{user_id}/rooms/{room_id}/tags*` |
| Thirdparty | `thirdparty.rs` | `/_matrix/client/r0|v3/thirdparty*` |
| Voice | `voice.rs` | `/_matrix/client/r0/voice*` 与 `/_matrix/client/v1/voice/transcription` |
| Widget | `widget.rs` | `/_matrix/client/v1/widgets*` 与 `rooms/{room_id}/widgets*` |
| Rendezvous | `rendezvous.rs` | `/_matrix/client/v1/rendezvous*` |
| Push Notification | `push_notification.rs` | `/_matrix/client/r0/push/*` 与 `/_synapse/admin/v1/push/*` |
| Federation | `federation.rs` | 已拆到 `federation.md` |
| Worker | `worker.rs` | `/_synapse/worker/v1/*` |
| Telemetry | `telemetry.rs` | `/_synapse/admin/v1/telemetry/*` |
| Feature Flags | `feature_flags.rs` | `/_synapse/admin/v1/feature-flags*` |
| Event Report | `event_report.rs` | `/_synapse/admin/v1/event_reports*` |
| Module | `module.rs` | `/_synapse/admin/v1/modules*` 与若干模块化回调管理端点 |

## 仍未单独拆文档模块

### Relations / Reactions / Typing / Tags / Thirdparty

| 模块 | 路径族 |
|------|--------|
| Relations | `/_matrix/client/{v1,v3}/rooms/{room_id}/relations*`、`aggregations*`，`r0` 保留核心关系查询 |
| Reactions | `PUT /_matrix/client/{v1,v3}/rooms/{room_id}/send/m.reaction/{txn_id}` |
| Typing | `GET/PUT /_matrix/client/v3/rooms/{room_id}/typing/{user_id}`、`GET /typing`、`POST /rooms/typing` |
| Tags | `/_matrix/client/{r0,v3}/user/{user_id}/tags`、`rooms/{room_id}/tags/{tag}` |
| Thirdparty | `/_matrix/client/{r0,v3}/thirdparty/protocols`、`protocol/{protocol}`、`location`、`user` |

### Voice / Widget / Rendezvous / Thread

| 模块 | 路径族 |
|------|--------|
| Voice | `/_matrix/client/r0/voice/upload` `stats` `{message_id}` `user/{user_id}` `room/{room_id}` `config` `convert` `optimize`，以及 `/_matrix/client/v1/voice/transcription` |
| Widget | `/_matrix/client/v1/widgets*`、`rooms/{room_id}/widgets*`、`sessions*`、`permissions*` |
| Rendezvous | `/_matrix/client/v1/rendezvous`、`/{session_id}`、`/messages` |
| Thread | `/_matrix/client/v1/rooms/{room_id}/threads*`、`replies/{event_id}/redact` |

### Event Report / Feature Flags / Telemetry / Worker / Module

| 模块 | 路径族 |
|------|--------|
| Event Report | `/_synapse/admin/v1/event_reports*` |
| Feature Flags | `/_synapse/admin/v1/feature-flags*` |
| Telemetry | `/_synapse/admin/v1/telemetry/status` `attributes` `metrics` `alerts` `health` |
| Worker | `/_synapse/worker/v1/register` `workers*` `commands*` `tasks*` `replication*` `events` `statistics*` |
| Module | `/_synapse/admin/v1/modules*`、`account_validity*`、`password_auth_providers`、`presence_routes`、`media_callbacks`、`rate_limit_callbacks`、`account_data_callbacks` |

## 明确未挂载

以下路由文件存在实现但未并入当前主路由树，本次不计入契约正文:

- `openclaw.rs`
- `key_rotation.rs`
- `websocket.rs`
