# Voice 模块契约

> 版本: v1.0.0
> 更新日期: 2026-04-14
> 对应 SDK 模块: `src/voice/index.ts`
> 审查来源: `synapse-rust/src/web/routes/voice.rs`
> 审计状态: ⚠️ 路由已拆分成独立契约，`transcription` 已完成 SDK 对齐；`convert` / `optimize` 已从“伪成功”收敛为显式未支持，仍有 8 个后端端点未被 SDK 直接封装

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

| 状态码 | 说明                                                                                    |
| ------ | --------------------------------------------------------------------------------------- |
| `200`  | 请求成功                                                                                |
| `400`  | base64 无效、音频 MIME 非法、`duration_ms` 不合法、参数缺失，或 `convert` / `optimize` 当前未启用 |
| `401`  | 需认证接口缺少或使用无效令牌                                                            |
| `403`  | 跨用户读取用户级语音数据、非成员向他人房间上传语音、无权读取房间/消息级语音内容，或非所有者删除语音时被拒绝 |
| `404`  | 语音消息不存在                                                                          |
| `500`  | service 层或存储层内部错误                                                              |

## SDK Manager 对应关系

| 后端端点                                      | SDK Manager           | 方法                       | 现状                                                           |
| --------------------------------------------- | --------------------- | -------------------------- | -------------------------------------------------------------- |
| `POST /_matrix/client/r0/voice/upload`        | `VoiceMessageManager` | `uploadVoiceMessage()`     | ❌ SDK 走 `uploadContent()+sendEvent()`，未调用该后端端点      |
| `GET /_matrix/client/r0/voice/stats`          | `VoiceMessageManager` | `getVoiceStats()`          | ❌ SDK 统计来自本地房间时间线，不调用后端                      |
| `GET /_matrix/client/r0/voice/{message_id}`   | `VoiceMessageManager` | `getVoiceMessageInfo()`    | ❌ SDK 通过 `fetchRoomEvent()` 读取事件，不调用后端            |
| `POST /_matrix/client/r0/voice/convert`       | `VoiceMessageManager` | `convertVoiceMessage()`    | ⚠️ SDK 路径与请求体已对齐，但后端当前显式返回未支持错误       |
| `POST /_matrix/client/r0/voice/optimize`      | `VoiceMessageManager` | `optimizeVoiceMessage()`   | ⚠️ SDK 路径与请求体已对齐，但后端当前显式返回未支持错误       |
| `POST /_matrix/client/v1/voice/transcription` | `VoiceMessageManager` | `transcribeVoiceMessage()` | ✅ 已改为发送 `event_id` / `mxc`，并映射后端稳定响应字段       |

## 当前对齐结论

- `voice.rs` 的 11 个外部端点现已从 `media.md` 的混合描述中拆出，形成独立契约。
- SDK 已完成 `convert`、`optimize`、`transcription` 三条语音 REST 路径的请求封装对齐，但其中前两者当前只会得到显式未支持错误。
- `uploadVoiceMessage()`、`getVoiceStats()`、`getVoiceMessageInfo()` 属于 SDK 本地/事件层能力，不应再误写成已对接 `voice.rs` REST 契约。
- `GET /voice/config` 是当前唯一公开语音接口，其余 10 个端点均依赖 `AuthenticatedUser`。
- `GET /voice/user/{user_id}` 与 `GET /voice/user/{user_id}/stats` 现已补齐对象级鉴权，不再允许任意已登录用户读取他人语音数据。
- `GET /voice/room/{room_id}` 现已要求调用方为房间成员，避免跨房间读取语音列表。
- `POST /voice/upload`、`GET /voice/{message_id}` 与 `POST /voice/transcription` 现已按房间成员/消息归属做对象级鉴权，不再允许跨房间挂载或任意已登录用户读取他人语音内容。
- `DELETE /voice/{message_id}` 现已对现存消息返回显式对象级鉴权结果：非所有者删除返回 `403`，管理员允许覆盖删除。

## 封装覆盖率

- **后端路由总数**: 11 个端点
- **SDK 已直接调用同一路径**: 3/11
- **完全正确封装**: 3/11
- **仅本地能力或语义替代**: 3/11

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/voice.rs`
- SDK 封装: `matrix-js-sdk/src/voice/index.ts`
