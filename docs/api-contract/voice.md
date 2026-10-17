---
module: voice
generated_from: docs/api-contract/generated/modules/voice.json
generated_hash: sha256-3e7dc0a51ff641a1052595bd0ed981e31c1036c1f1a25cfc0ecbf612c329d2e2
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Voice 模块契约

> 版本: v1.0.0
> 更新日期: 2026-04-14
> 对应 SDK 模块: `src/voice/index.ts`
> 审查来源: `synapse-rust/synapse-web/src/routes/voice.rs`
> 审计状态: ✅ 当前 Ledger 仅统计 `voice/config` 与 `voice/upload` 两条主路径，SDK 已完成直连封装

## 挂载版本

| 前缀                 | 路由                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/_matrix/vendor/v1` | `/voice/upload`、`/voice/stats`、`/voice/config`、`/voice/register`、`/voice/{media_id}`、`/voice/{media_id}/convert`、`/voice/{media_id}/optimize`、`/voice/{media_id}/transcription`、`/voice/user/{user_id}`、`/voice/user/{user_id}/stats`、`/voice/room/{room_id}`、`/voice/room/{room_id}/stats` |

> **命名空间变更（2026-10-12 核对）**：voice 属**私有扩展模块**，其端点此前冒用
> `/_matrix/client/{r0,v1}` 标准命名空间，后已按 ISSUE-13 统一迁至 `/_matrix/vendor/v1`。
> 本页历史版本中列出的 `/_matrix/client/r0/voice/*`、`/_matrix/client/v1/voice/transcription`
> 在后端**已不存在**（后端 `voice.rs` 现仅注册 `/_matrix/vendor/v1/voice/*`），
> 打这些地址会得到 404。另注：后端注册模板用 `{media_id}`，本页早期写作 `{message_id}`，
> 二者指同一路径段，现已对齐为 `{media_id}`；响应体字段名仍为 `message_id`（不受影响）。

## 路由清单

| 方法   | 路径                                                | 说明             | 认证 |
| ------ | --------------------------------------------------- | ---------------- | ---- |
| POST   | `/_matrix/vendor/v1/voice/upload`                   | 上传语音消息     | 用户 |
| GET    | `/_matrix/vendor/v1/voice/stats`                    | 获取当前用户统计 | 用户 |
| GET    | `/_matrix/vendor/v1/voice/{media_id}`               | 获取语音内容     | 用户 |
| DELETE | `/_matrix/vendor/v1/voice/{media_id}`               | 删除语音消息     | 用户 |
| GET    | `/_matrix/vendor/v1/voice/user/{user_id}`           | 获取指定用户语音 | 用户 |
| GET    | `/_matrix/vendor/v1/voice/room/{room_id}`           | 获取房间语音列表 | 用户 |
| GET    | `/_matrix/vendor/v1/voice/user/{user_id}/stats`     | 获取指定用户统计 | 用户 |
| GET    | `/_matrix/vendor/v1/voice/config`                   | 获取语音配置     | 公开 |
| POST   | `/_matrix/vendor/v1/voice/{media_id}/convert`       | 转换语音格式     | 用户 |
| POST   | `/_matrix/vendor/v1/voice/{media_id}/optimize`      | 压缩优化语音     | 用户 |
| POST   | `/_matrix/vendor/v1/voice/{media_id}/transcription` | 语音转写         | 用户 |

## 请求体与稳定响应

### `POST /_matrix/vendor/v1/voice/upload`

- 请求体稳定字段: `content`(base64)、`content_type`、`duration_ms`、可选 `room_id`、`session_id`
- 处理器会校验 base64、音频 MIME、大小上限与 `duration_ms > 0`
- 当携带 `room_id` 时，要求认证用户是该房间成员；非成员上传返回 `403 M_FORBIDDEN`
- 成功时直接透传 `voice_service.save_voice_message(...)` 的 JSON 结果

### `GET /_matrix/vendor/v1/voice/stats`

- 返回当前认证用户的统计对象
- 处理器直接透传 `voice_service.get_user_stats(...)` 的 JSON 结果

### `GET /_matrix/vendor/v1/voice/{media_id}`

- 成功响应稳定字段: `message_id`、`content`(base64)、`content_type`、`size`
- 仅允许消息所有者或关联房间成员读取；无权访问返回 `403 M_FORBIDDEN`

### `DELETE /_matrix/vendor/v1/voice/{media_id}`

- 成功响应稳定字段: `deleted`、`message_id`
- 仅允许消息所有者删除；管理员可覆盖删除；其他用户返回 `403 M_FORBIDDEN`

### `GET /_matrix/vendor/v1/voice/user/{user_id}`

- 处理器固定按 `limit=50 offset=0` 查询
- 仅允许认证用户读取自己的语音列表；跨用户访问返回 `403 M_FORBIDDEN`
- 成功时直接透传 service 层返回对象

### `GET /_matrix/vendor/v1/voice/room/{room_id}`

- 处理器固定按 `limit=50` 查询
- 仅允许房间成员读取该房间的语音列表；非成员访问返回 `403 M_FORBIDDEN`
- 成功时直接透传 service 层返回对象

### `GET /_matrix/vendor/v1/voice/user/{user_id}/stats`

- 返回指定用户的统计对象
- 仅允许认证用户读取自己的统计；跨用户访问返回 `403 M_FORBIDDEN`

### `GET /_matrix/vendor/v1/voice/config`

- 稳定字段: `supported_formats`、`max_size_bytes`、`max_duration_ms`、`default_sample_rate`、`default_channels`

### `POST /_matrix/vendor/v1/voice/{media_id}/convert`

- 请求体必填字段: `message_id`、`target_format`
- 可选字段: `quality`、`bitrate`
- 当前实现会在参数校验通过后返回显式未支持错误，不再伪装为成功
- 错误体使用 `M_UNRECOGNIZED`，错误消息会回显 `message_id`、`target_format`、`quality`、`bitrate`

### `POST /_matrix/vendor/v1/voice/{media_id}/optimize`

- 请求体必填字段: `message_id`
- 可选字段: `target_size_kb`、`preserve_quality`、`remove_silence`、`normalize_volume`
- 当前实现会在参数校验通过后返回显式未支持错误，不再伪装为成功
- 错误体使用 `M_UNRECOGNIZED`，错误消息会回显 `message_id`、`target_size_kb`、`preserve_quality`、`remove_silence`、`normalize_volume`

### `POST /_matrix/vendor/v1/voice/{media_id}/transcription`

- 请求体要求 `event_id` 或 `mxc` 二选一
- 成功响应稳定字段: `event_id`、`transcription`、`duration_ms`、`status`
- 仅允许消息所有者或关联房间成员读取转写；无权访问返回 `403 M_FORBIDDEN`
- 若已有转写缺失，会回落为 `"Transcription not available for voice message {event_id}"`

## 结构化类型（codegen 源）

> 本节是 `scripts/sdk-contract-codegen.mjs` 的 DTO 提取源，也是 `src/voice/__generated__/dto.ts`
> 的权威来源。形状逐条对照 `synapse-rust/synapse-web/src/routes/voice.rs` 的路由注册与
> `synapse-rust/synapse-services/src/voice_service.rs` 的 `json!` 组装，**不凭印象**。
>
> ⚠️ **本节暴露出一批「SDK 手写类型与后端不符」**（`src/voice/index.ts` 的 `IVoice*`），
> 这些是独立缺陷，不在本机制的清偿范围内，但**必须记录**（否则生成物与手写类型会各说各话）：
>
> | 手写类型               | 手写形状                                                                            | 后端真实形状                                                                                                                                                             |
> | ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | `IVoiceConfig`         | `{ max_upload_size_bytes, allowed_content_types, auto_transcribe, retention_days }` | `{ enabled, max_duration, allowed_formats, supported_formats, max_size_bytes, max_duration_ms, content_type, voice_extension, auto_transcribe, server_side_processing }` |
> | `IVoiceStats`          | `{ total_messages, total_duration_ms, average_duration_ms, storage_used_bytes }`    | `{ user_id, total_uploads, total_duration_ms, total_size_bytes, uploads_today }`                                                                                         |
> | `IVoiceRoomStats`      | `{ room_id, message_count, total_duration_ms }`                                     | `{ room_id, total_uploads, total_duration_ms, total_size_bytes }`                                                                                                        |
> | `IVoiceUserStats`      | `{ user_id, message_count, total_duration_ms }`                                     | `{ user_id, total_uploads, total_duration_ms, total_size_bytes, uploads_today }`                                                                                         |
> | `IVoiceDeleteResponse` | `{ message_id, deleted }`                                                           | 后端**未注册** `DELETE /voice/{media_id}` ⇒ 该类型无对应端点                                                                                                             |
>
> **`Voice*Response` 的命名刻意不同于手写类型的 `IVoice*`**，以便两者并存期间不产生歧义；
> 收敛顺序：先让本节成为契约真相，再由消费方逐个切换，最后删手写类型。

```typescript
/** `GET /_matrix/vendor/v1/voice/config` 响应（后端 `get_voice_config` 的 `json!`）。 */
export interface VoiceConfigResponse {
    enabled: boolean;
    /** 单个语音消息最大时长（秒）；后端硬编码 `600`。 */
    max_duration: number;
    allowed_formats: string[];
    supported_formats: string[];
    /** 单文件最大字节数，取自服务端 `config.server.max_upload_size`（非硬编码）。 */
    max_size_bytes: number;
    /** 与 `max_duration` 同源的毫秒表示；后端硬编码 `60_0000`。 */
    max_duration_ms: number;
    content_type: string;
    voice_extension: string;
    auto_transcribe: boolean;
    server_side_processing: {
        convert: boolean;
        optimize: boolean;
        transcription: boolean;
    };
}

/**
 * 语音消息对应的 `m.audio` 事件内容（后端 `upload_voice_message` 组装的 `voice_content`）。
 *
 * `waveform` 是 **comma-separated 的 uint16 采样串**（与 multipart 上传表单里的同名可选字段一致），
 * 仅在调用方提供了波形时才出现。
 */
export interface VoiceEventContent {
    body: string;
    msgtype: string;
    url: string;
    info: {
        mimetype: string;
        size: number;
        duration: number;
    };
    "org.matrix.msc3245.voice": {
        waveform?: string;
    };
}

/**
 * `POST /_matrix/vendor/v1/voice/upload` 响应
 * （后端 `voice_service.rs::upload_voice_message`）。
 *
 * 字节数字段名是 **`size`**（不是 `size_bytes`）。
 */
export interface VoiceUploadResponse {
    content_uri: string;
    content: VoiceEventContent;
    content_type: string;
    duration_ms: number;
    size: number;
}

/** 单条语音消息记录（后端 `record_to_message_json`，列表端点与 `GET /voice/{media_id}` 共用）。 */
export interface VoiceMessageRecord {
    media_id: string;
    user_id: string;
    room_id: string | null;
    content_uri: string;
    content_type: string;
    duration_ms: number;
    size_bytes: number;
    created_ts: number;
}

/** `GET /_matrix/vendor/v1/voice/room/{room_id}` 响应。 */
export interface VoiceRoomListResponse {
    room_id: string;
    messages: VoiceMessageRecord[];
    /** keyset 游标：上一页最后一条的 `created_ts`（毫秒）；空页为 `null`。后端无 `has_more`。 */
    next_batch: number | null;
}

/** `GET /_matrix/vendor/v1/voice/user/{user_id}` 响应。 */
export interface VoiceUserListResponse {
    user_id: string;
    messages: VoiceMessageRecord[];
    next_batch: number | null;
}

/** `GET /_matrix/vendor/v1/voice/user/{user_id}/stats` 响应。 */
export interface VoiceUserStatsResponse {
    user_id: string;
    total_uploads: number;
    total_duration_ms: number;
    total_size_bytes: number;
    uploads_today: number;
}

/** `GET /_matrix/vendor/v1/voice/room/{room_id}/stats` 响应。 */
export interface VoiceRoomStatsResponse {
    room_id: string;
    total_uploads: number;
    total_duration_ms: number;
    total_size_bytes: number;
}

/** `POST /_matrix/vendor/v1/voice/register` 响应（`exists` 表示该 media 是否已在表中）。 */
export interface VoiceRegisterResponse {
    content_uri: string;
    exists: boolean;
}

/** `POST /_matrix/vendor/v1/voice/register` 请求体（后端 `RegisterEncryptedVoiceRequest`）。 */
export interface RegisterEncryptedVoiceRequest {
    media_id: string;
    room_id?: string;
    content_type: string;
    duration_ms: number;
    size_bytes: number;
}

/** 语音列表端点的查询参数（后端 `VoiceListQuery`，带 `#[serde(deny_unknown_fields)]`）。 */
export interface VoiceListQuery {
    limit?: number;
    /** 毫秒 `created_ts` 游标，等于上一页返回的 `next_batch`。 */
    from?: number;
}
```

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

| 后端端点                                                 | SDK Manager           | 方法                         | 现状                                                      |
| -------------------------------------------------------- | --------------------- | ---------------------------- | --------------------------------------------------------- |
| `POST /_matrix/vendor/v1/voice/upload`                   | `VoiceMessageManager` | `uploadVoiceMessageDirect()` | ✅ 已直连 `voice/upload`，按后端要求发送 base64 `content` |
| `GET /_matrix/vendor/v1/voice/stats`                     | `VoiceMessageManager` | `getVoiceStats()`            | ❌ SDK 统计来自本地房间时间线，不调用后端                 |
| `GET /_matrix/vendor/v1/voice/{media_id}`                | `VoiceMessageManager` | `getVoiceMessageInfo()`      | ❌ SDK 通过 `fetchRoomEvent()` 读取事件，不调用后端       |
| `POST /_matrix/vendor/v1/voice/{media_id}/transcription` | `VoiceMessageManager` | 本轮未纳入 Ledger 统计       | 文档保留说明，当前 codegen 不再生成该路径                 |

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

- 新增 `uploadVoiceMessageDirect()` 作为 `POST /_matrix/vendor/v1/voice/upload` 的显式 SDK wrapper。
- `uploadVoiceMessageDirect()` 会把二进制音频转成 base64 `content`，并按后端要求发送 `content_type`、`duration_ms`、`room_id`、`waveform`。
- `getServerConfig()` 与 `uploadVoiceMessageDirect()` 均已绑定生成 `route-table`，单测覆盖 `GET /voice/config` 和 `POST /voice/upload`。

## 代码定位

- 路由与处理器: `synapse-rust/synapse-web/src/routes/voice.rs`
- SDK 封装: `matrix-js-sdk/src/voice/index.ts`

## 实现口径补充（2026-10-17 后端契约回灌）

> 本节依据 `synapse-rust/docs/sdk/rtc.md` 回灌。正文的路由表、端点计数、覆盖率与日期保持不变；若正文与本节冲突，以本节为准。

### RTC 与 VoIP

#### TURN 凭据 `/voip/turnServer`

- `GET` 与 `POST /_matrix/client/v3/voip/turnServer` 均可用，需 `Authorization`。
- 响应 `{username, password, uris, ttl}`，`ttl` 单位是秒；到期前重新调用即可。
- 服务端未启用 VoIP 时不报错，返回 `{"username":"","password":"","uris":[],"ttl":0}`；客户端必须以 `uris` 为空判断“无 TURN”，不能只看 HTTP 200。
- 已启用但当前用户是 guest 且禁用 guest 使用 TURN 时返回 `403 M_FORBIDDEN`。

#### `/voip/config`

- `GET /_matrix/client/v3/voip/config` 返回 `turn_servers` 与 `stun_servers`。
- `turn_servers` 永远是数组，可能是空数组而不是 `null`；`stun_servers` 可能为 `null`，客户端不要假设其一定存在。
- VoIP 未启用时 `turn_servers` 为 `[]`、`stun_servers` 为 `null`。
- 已启用但动态凭据生成失败（未配置 shared secret）时 `turn_servers` 静默回退为 `[]`，不报错。

#### guest 凭据

- `GET /_matrix/client/v3/voip/turnServer/guest` 仍需 `Authorization`，名字中的 guest 只表示用 guest 身份签发。
- 未启用 VoIP 时该端点返回 `404 M_NOT_FOUND`（`VoIP/TURN service is not configured`），与 `/voip/turnServer` 返回空凭据的行为不同。
- 禁用 guest 使用 TURN 时返回 `403 M_FORBIDDEN`。

#### MSC4143 RTC transports

- `GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports`，需 `Authorization`。
- 能力发现读 `/versions` 的 `unstable_features.org.matrix.msc4143`；为 `true` 时才应调用。
- 响应 `{transports: [{type, ice_servers}]}`，`type` 只有 `org.matrix.msc4403.ice-server-transport`。
- TURN 凭据字段是 `credential`，不是 `/voip/turnServer` 的 `password`；STUN 项只有 `urls`，没有 `username` / `credential`。
- `urls` 是数组，即使只有一条。
- 未启用 VoIP 或未配置出任何一项时返回 `{"transports": []}`（200，不报错）。

#### MSC3079 call 事件（需 `voip-tracking`）

- 5 条写路由：`PUT /rooms/{room_id}/send/m.call.invite/{txn_id}`、`m.call.candidates`、`m.call.answer`、`m.call.hangup`，以及读路由 `GET /rooms/{room_id}/call/{call_id}`。
- 这些路由由 `voip-tracking` Cargo feature 注册；默认特性集下为 404，参考部署（`all-extensions`）已启用。SDK 应先探测或收到 404 后回退为客户端直连。
- `m.call.candidates` 的字段名是 `sdpMid` / `sdpMLineIndex`（驼峰），不是 snake_case。
- `m.call.invite` 的 `invitee` 必须是 user_id 字符串才会写入 `callee_id`；传对象会导致 `callee_id` 为 `null`，随后 `m.call.answer` 必然返回 403。
- `GET /rooms/{room_id}/call/{call_id}` 返回 `call_id`、`room_id`、`caller_id`、`callee_id`、`state`、`candidates`；`state` 取值 `ringing` / `connected` / `held` / `ended`，无人上报候选时 `candidates` 为 `[]`。
- 所有 5 条均要求调用者是房间成员，否则 `403 M_FORBIDDEN`。
