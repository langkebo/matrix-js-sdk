---
module: voice
generated_from: docs/api-contract/generated/modules/voice.json
generated_hash: sha256-753c40eacb553b2408af4c837d70f209e8845b38bddd213c87c0fe8b9827f7b8
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Voice 模块契约

> 版本: v1.0.0
> 更新日期: 2026-04-14
> 对应 SDK 模块: `src/voice/index.ts`
> 审查来源: `synapse-rust/src/web/routes/voice.rs`
> 审计状态: ✅ 当前 Ledger 仅统计 `voice/config` 与 `voice/upload` 两条主路径，SDK 已完成直连封装

## 挂载版本

| 前缀                 | 路由                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/_matrix/client/r0` | `/voice/upload`、`/voice/stats`、`/voice/{message_id}`、`/voice/user/{user_id}`、`/voice/user/{user_id}/stats`、`/voice/room/{room_id}`、`/voice/config`、`/voice/convert`、`/voice/optimize` |
| `/_matrix/client/v1` | `/voice/transcription`                                                                                                                                                                        |

## 路由清单

| 方法   | 路径                                            | 说明             | 认证 |
| ------ | ----------------------------------------------- | ---------------- | ---- |
| POST   | `/_matrix/client/r0/voice/upload`               | 上传语音消息     | 用户 |
| GET    | `/_matrix/client/r0/voice/stats`                | 获取当前用户统计 | 用户 |
| GET    | `/_matrix/client/r0/voice/{message_id}`         | 获取语音内容     | 用户 |
| DELETE | `/_matrix/client/r0/voice/{message_id}`         | 删除语音消息     | 用户 |
| GET    | `/_matrix/client/r0/voice/user/{user_id}`       | 获取指定用户语音 | 用户 |
| GET    | `/_matrix/client/r0/voice/room/{room_id}`       | 获取房间语音列表 | 用户 |
| GET    | `/_matrix/client/r0/voice/user/{user_id}/stats` | 获取指定用户统计 | 用户 |
| GET    | `/_matrix/client/r0/voice/config`               | 获取语音配置     | 公开 |
| POST   | `/_matrix/client/r0/voice/convert`              | 转换语音格式     | 用户 |
| POST   | `/_matrix/client/r0/voice/optimize`             | 压缩优化语音     | 用户 |
| POST   | `/_matrix/client/v1/voice/transcription`        | 语音转写         | 用户 |

## 请求体与稳定响应

### `POST /_matrix/client/r0/voice/upload`

- 请求体稳定字段: `content`(base64)、`content_type`、`duration_ms`、可选 `room_id`、`session_id`
- 处理器会校验 base64、音频 MIME、大小上限与 `duration_ms > 0`
- 当携带 `room_id` 时，要求认证用户是该房间成员；非成员上传返回 `403 M_FORBIDDEN`
- 成功时直接透传 `voice_service.save_voice_message(...)` 的 JSON 结果

### `GET /_matrix/client/r0/voice/stats`

- 返回当前认证用户的统计对象
- 处理器直接透传 `voice_service.get_user_stats(...)` 的 JSON 结果

### `GET /_matrix/client/r0/voice/{message_id}`

- 成功响应稳定字段: `message_id`、`content`(base64)、`content_type`、`size`
- 仅允许消息所有者或关联房间成员读取；无权访问返回 `403 M_FORBIDDEN`

### `DELETE /_matrix/client/r0/voice/{message_id}`

- 成功响应稳定字段: `deleted`、`message_id`
- 仅允许消息所有者删除；管理员可覆盖删除；其他用户返回 `403 M_FORBIDDEN`

### `GET /_matrix/client/r0/voice/user/{user_id}`

- 处理器固定按 `limit=50 offset=0` 查询
- 仅允许认证用户读取自己的语音列表；跨用户访问返回 `403 M_FORBIDDEN`
- 成功时直接透传 service 层返回对象

### `GET /_matrix/client/r0/voice/room/{room_id}`

- 处理器固定按 `limit=50` 查询
- 仅允许房间成员读取该房间的语音列表；非成员访问返回 `403 M_FORBIDDEN`
- 成功时直接透传 service 层返回对象

### `GET /_matrix/client/r0/voice/user/{user_id}/stats`

- 返回指定用户的统计对象
- 仅允许认证用户读取自己的统计；跨用户访问返回 `403 M_FORBIDDEN`

### `GET /_matrix/client/r0/voice/config`

- 稳定字段: `supported_formats`、`max_size_bytes`、`max_duration_ms`、`default_sample_rate`、`default_channels`

### `POST /_matrix/client/r0/voice/convert`

- 请求体必填字段: `message_id`、`target_format`
- 可选字段: `quality`、`bitrate`
- 当前实现会在参数校验通过后返回显式未支持错误，不再伪装为成功
- 错误体使用 `M_UNRECOGNIZED`，错误消息会回显 `message_id`、`target_format`、`quality`、`bitrate`

### `POST /_matrix/client/r0/voice/optimize`

- 请求体必填字段: `message_id`
- 可选字段: `target_size_kb`、`preserve_quality`、`remove_silence`、`normalize_volume`
- 当前实现会在参数校验通过后返回显式未支持错误，不再伪装为成功
- 错误体使用 `M_UNRECOGNIZED`，错误消息会回显 `message_id`、`target_size_kb`、`preserve_quality`、`remove_silence`、`normalize_volume`

### `POST /_matrix/client/v1/voice/transcription`

- 请求体要求 `event_id` 或 `mxc` 二选一
- 成功响应稳定字段: `event_id`、`transcription`、`duration_ms`、`status`
- 仅允许消息所有者或关联房间成员读取转写；无权访问返回 `403 M_FORBIDDEN`
- 若已有转写缺失，会回落为 `"Transcription not available for voice message {event_id}"`

## 常见状态码

| 状态码 | 说明                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| `200`  | 请求成功                                                                                                    |
| `400`  | base64 无效、音频 MIME 非法、`duration_ms` 不合法、参数缺失，或 `convert` / `optimize` 当前未启用           |
| `401`  | 需认证接口缺少或使用无效令牌                                                                                |
| `403`  | 跨用户读取用户级语音数据、非成员向他人房间上传语音、无权读取房间/消息级语音内容，或非所有者删除语音时被拒绝 |
| `404`  | 语音消息不存在                                                                                              |
| `500`  | service 层或存储层内部错误                                                                                  |

## SDK Manager 对应关系

| 后端端点                                      | SDK Manager           | 方法                         | 现状                                                      |
| --------------------------------------------- | --------------------- | ---------------------------- | --------------------------------------------------------- |
| `POST /_matrix/client/r0/voice/upload`        | `VoiceMessageManager` | `uploadVoiceMessageDirect()` | ✅ 已直连 `voice/upload`，按后端要求发送 base64 `content` |
| `GET /_matrix/client/r0/voice/stats`          | `VoiceMessageManager` | `getVoiceStats()`            | ❌ SDK 统计来自本地房间时间线，不调用后端                 |
| `GET /_matrix/client/r0/voice/{message_id}`   | `VoiceMessageManager` | `getVoiceMessageInfo()`      | ❌ SDK 通过 `fetchRoomEvent()` 读取事件，不调用后端       |
| `POST /_matrix/client/v1/voice/transcription` | `VoiceMessageManager` | 本轮未纳入 Ledger 统计       | 文档保留说明，当前 codegen 不再生成该路径                 |

## 当前对齐结论

- 当前 `generated/modules/voice.json` 只统计 2 条稳定主路径：`GET /voice/config` 与 `POST /voice/upload`。
- `src/voice/index.ts` 已绑定生成的 `VoicePathPattern`，避免 `r0 /voice/*` 主路径继续手写漂移。
- `uploadVoiceMessageDirect()` 新增为显式 REST 上传入口，直连后端 `voice/upload`，返回后端透传的 `content_uri` / `content` / `duration_ms` / `size`。
- 既有 `uploadVoiceMessage()` 继续保留事件流上传逻辑，负责 `uploadContent()+sendEvent()` 的高层语音消息发送，不与 REST 上传入口混用。
- `GET /voice/user/{user_id}` 与 `GET /voice/user/{user_id}/stats` 现已补齐对象级鉴权，不再允许任意已登录用户读取他人语音数据。
- `GET /voice/room/{room_id}` 现已要求调用方为房间成员，避免跨房间读取语音列表。
- `POST /voice/upload`、`GET /voice/{message_id}` 与 `POST /voice/transcription` 现已按房间成员/消息归属做对象级鉴权，不再允许跨房间挂载或任意已登录用户读取他人语音内容。
- `DELETE /voice/{message_id}` 现已对现存消息返回显式对象级鉴权结果：非所有者删除返回 `403`，管理员允许覆盖删除。

## 封装覆盖率

- **Ledger 主路径总数**: 2 个端点
- **SDK 已直接调用同一路径**: 2/2
- **完全正确封装**: 2/2
- **额外本地/事件层能力**: `uploadVoiceMessage()`、`getVoiceStats()`、`getVoiceMessageInfo()` 等

## 人工 Review 对齐

- 新增 `uploadVoiceMessageDirect()` 作为 `POST /_matrix/client/r0/voice/upload` 的显式 SDK wrapper。
- `uploadVoiceMessageDirect()` 会把二进制音频转成 base64 `content`，并按后端要求发送 `content_type`、`duration_ms`、`room_id`、`waveform`。
- `getServerConfig()` 与 `uploadVoiceMessageDirect()` 均已绑定生成 `route-table`，单测覆盖 `GET /voice/config` 和 `POST /voice/upload`。

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/voice.rs`
- SDK 封装: `matrix-js-sdk/src/voice/index.ts`
