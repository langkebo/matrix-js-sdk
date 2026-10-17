/**
 * Voice Manager - 语音消息管理 API 封装
 *
 * 提供语音消息统计查询、配置获取、上传/获取/删除语音消息等功能
 * 对接后端: synapse-rust/synapse-web/src/routes/voice.rs
 * API 前缀: /_matrix/client/v3/voice（v3）和 /_matrix/vendor/v1/voice（vendor v1）
 *
 * 注意：MSC3245 协议规定语音转码/转录/优化在客户端完成
 *
 * 路径契约（勿凭直觉补后缀）：`/voice/{media_id}/convert|optimize|transcription`
 * 带 `{media_id}`，而 `/voice/room/{room_id}` 与 `/voice/user/{user_id}` **不带任何后缀**
 * （列表与内容共用同一路由，仅响应体不同）。
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getVoiceManager();
 * // 获取语音统计
 * const stats = await manager.getVoiceStats();
 * // 上传语音消息
 * const result = await manager.uploadVoiceMessage({ content_type: "audio/ogg", body: "..." });
 * ```
 */
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix, VendorPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import { ValidationError } from "../errors";
import type { VoicePath } from "./__generated__/route-table";
import type { PathAssert, StripVendor } from "../http-api/strip-prefix";

/**
 * 路径前缀剥离：把契约表里的绝对路径（`/_matrix/client/v3/…`）化成管理器内部
 * 使用的相对路径，供 `vp()` 做编译期断言。与 `e2ee/index.ts`、`notifications/index.ts`
 * 的写法保持一致。
 */

/**
 * 契约路径断言。所有指向 synapse-rust `voice` 路由的调用都必须经过它，
 * 使路径拼写错误成为**编译错误**而不是线上 404。
 *
 * 唯一例外：`deleteVoiceMessage` 的 `DELETE /voice/{media_id}`（后端未注册该
 * 方法，见 `scripts/quality/path-contract-waivers.json`）与 MSC4143 的
 * `/org.matrix.msc4143/rtc/transports`（不属 voice 契约），二者显式保留裸字符串。
 */
function vp<const P extends string>(path: P & PathAssert<P, StripVendor<VoicePath>>): P {
    return path;
}

export interface IVoiceStats {
    total_messages: number;
    total_duration_ms: number;
    average_duration_ms: number;
    storage_used_bytes: number;
}

export interface IVoiceRoomStats {
    room_id: string;
    message_count: number;
    total_duration_ms: number;
}

export interface IVoiceUserStats {
    user_id: string;
    message_count: number;
    total_duration_ms: number;
}

export interface IVoiceConfig {
    max_upload_size_bytes: number;
    allowed_content_types: string[];
    auto_transcribe: boolean;
    retention_days: number;
}

export interface IVoiceUploadRequest {
    /** @deprecated Use uploadVoiceMessage(formData) with FormData instead. */
    content: string;
    content_type: string;
    room_id?: string;
    filename?: string;
}

/**
 * Upload a voice message using multipart/form-data (raw binary, no base64 overhead).
 *
 * This is the recommended upload path for P0-2: it sends the raw audio bytes
 * in a multipart form, avoiding the ~33% size inflation of base64 JSON encoding.
 *
 * The FormData fields are:
 *   - `file`: the audio file (File or Blob)
 *   - `room_id` (optional): target room ID
 *   - `duration_ms` (optional): audio duration in milliseconds
 *   - `waveform` (optional): comma-separated uint16 waveform samples
 *   - `content_type` (optional): MIME type; default "audio/ogg"
 */
export interface IVoiceUploadRequestMultipart {
    formData: FormData;
    prefix?: string;
}

/**
 * Response of `POST /voice/upload`.
 *
 * Contract source: `synapse-services/src/voice_service.rs::upload_voice_message`
 * → `json!({ "content_uri", "content", "content_type", "duration_ms", "size" })`.
 *
 * The stored media URI is exposed as `content_uri` (there is no `url`/`mxc_url`
 * alias) and the byte count is `size` (not `size_bytes`); the endpoint does not
 * return a `message_id` — callers derive it from `content_uri` via
 * `MediaLocator::parse`.
 */
export interface IVoiceUploadResponse {
    content_uri: string;
    content: Record<string, unknown>;
    content_type: string;
    duration_ms: number;
    size: number;
}

export interface IVoiceTranscriptionResponse {
    message_id: string;
    text: string;
    language: string;
    confidence: number;
}

/**
 * A stored voice message record.
 *
 * Contract source: `synapse-services/src/voice_service.rs::record_to_message_json`
 * → `{ media_id, user_id, room_id, content_uri, content_type, duration_ms,
 *      size_bytes, created_ts }`.
 *
 * Returned by both the list endpoints and `GET /voice/{media_id}`. The previous
 * shape (`message_id` / `url` / `mxc_url`) never existed on the wire; the mxc
 * URI is `content_uri` and the identifier is `media_id`.
 */
export interface IVoiceMessage {
    media_id: string;
    user_id: string;
    room_id: string | null;
    content_uri: string;
    content_type: string;
    duration_ms: number;
    size_bytes: number;
    created_ts: number;
}

export interface IVoiceDeleteResponse {
    message_id: string;
    deleted: boolean;
}

export interface IVoiceRoomInfo {
    room_id: string;
    [key: string]: unknown;
}

export interface IVoiceUserInfo {
    user_id: string;
    [key: string]: unknown;
}

/**
 * @deprecated The backend never returned `event_id` / `sender` / `duration` /
 * `timestamp` for voice list rows. Alias of {@link IVoiceMessage}.
 */
export type IVoiceMessageItem = IVoiceMessage;

/**
 * Response of `GET /voice/room/{room_id}` and `GET /voice/user/{user_id}`.
 *
 * Contract source: `synapse-services/src/voice_service.rs`
 * (`get_room_voice_messages` / `get_user_voice_messages`) →
 * `{ room_id|user_id, messages: [...], next_batch: <i64|null> }`.
 *
 * `next_batch` is a **keyset cursor carrying the `created_ts` (ms) of the last
 * row**, or `null` when the page is empty. It is a number, not an opaque
 * string, and the backend does **not** return `has_more` — termination is
 * signalled by `messages.length < limit` or `next_batch === null`.
 */
export interface IVoiceMessageList {
    room_id?: string;
    user_id?: string;
    messages: IVoiceMessage[];
    next_batch: number | null;
}

/**
 * Query parameters for the voice list endpoints.
 *
 * Backend `VoiceListQuery` is `#[serde(deny_unknown_fields)]` and only accepts
 * `limit` + `from`; `from` is the millisecond `created_ts` cursor echoed back
 * as `next_batch` by the previous page.
 */
export interface IVoiceListQueryParams {
    limit?: number;
    from?: number;
}

export interface IVoiceConvertOptions {
    format?: string;
    [key: string]: unknown;
}

export interface IVoiceConvertResponse {
    media_id: string;
    [key: string]: unknown;
}

export interface IVoiceOptimizeOptions {
    bitrate?: number;
    [key: string]: unknown;
}

export interface IVoiceOptimizeResponse {
    media_id: string;
    [key: string]: unknown;
}

export interface IVoiceTranscribeOptions {
    language?: string;
    [key: string]: unknown;
}

export interface IVoiceTranscribeResponse {
    media_id: string;
    text: string;
    language?: string;
    confidence?: number;
    [key: string]: unknown;
}

/**
 * Request body for `POST /voice/register` - registering an encrypted voice attachment.
 *
 * Used after uploading via standard media service (`uploadEncryptedFile`) in encrypted
 * rooms: the encrypted file is stored in the `media` table, but we need to register it
 * in `voice_usage_stats` so it appears in the voice lists.
 */
export interface IVoiceRegisterRequest {
    /** The room_id the voice belongs to */
    room_id: string;
    /** The media_id extracted from mxc:// URL */
    media_id: string;
    /** The content type (e.g., "audio/webm") */
    content_type: string;
    /** Duration in milliseconds */
    duration_ms: number;
    /** File size in bytes */
    size_bytes: number;
}

/**
 * Response of `POST /voice/register`.
 */
export interface IVoiceRegisterResponse {
    content_uri: string;
    exists: boolean;
}

export enum VoiceEvent {
    StatsUpdated = "StatsUpdated",
    ConfigUpdated = "ConfigUpdated",
    MessageUploaded = "MessageUploaded",
    MessageDeleted = "MessageDeleted",
    Error = "Error",
}

interface VoiceManagerEventMap {
    [VoiceEvent.StatsUpdated]: (stats: IVoiceStats) => void;
    [VoiceEvent.ConfigUpdated]: (config: IVoiceConfig) => void;
    [VoiceEvent.MessageUploaded]: (response: IVoiceUploadResponse) => void;
    [VoiceEvent.MessageDeleted]: (messageId: string) => void;
    [VoiceEvent.Error]: (error: Error) => void;
}

export class VoiceManager extends BaseManager<VoiceEvent, VoiceManagerEventMap> {
    private cachedConfig: IVoiceConfig | null = null;
    private configPromise: Promise<IVoiceConfig> | null = null;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 检测当前后端是否支持语音消息服务（FT-S13：探测失败时一律按不支持处理）。
     *
     * @returns 后端是否开放 Voice 路由
     * @example
     * ```typescript
     * const supported = await client.getVoiceManager().isSupported();
     * console.log("Voice supported:", supported);
     * ```
     */
    public async isSupported(): Promise<boolean> {
        // 后端未实 Voice 路由：探测失败时绝不能误判支持（FT-S13）
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.Voice, false);
    }

    /**
     * 获取当前用户的语音消息汇总统计。
     *
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 语音统计数据（消息数、总时长、平均时长、占用存储）
     * @throws 当请求失败时抛出经过归一化的错误
     * @example
     * ```typescript
     * const stats = await client.getVoiceManager().getVoiceStats();
     * console.log(stats.total_messages, stats.storage_used_bytes);
     * ```
     */
    public async getVoiceStats(prefix: string = VendorPrefix): Promise<IVoiceStats> {
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceStats>({
                    method: Method.Get,
                    path: vp("/voice/stats"),
                    prefix,
                });
            }, "getVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getVoiceStats");
        }
    }

    /**
     * 获取指定房间的语音消息统计。
     *
     * @param roomId - 目标房间 ID
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 该房间的语音统计
     * @throws 当 roomId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const stats = await client.getVoiceManager().getRoomVoiceStats("!room:example.org");
     * console.log(stats.message_count);
     * ```
     */
    public async getRoomVoiceStats(roomId: string, prefix: string = VendorPrefix): Promise<IVoiceRoomStats> {
        this.requireNonEmptyString(roomId, "Room ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceRoomStats>({
                    method: Method.Get,
                    path: vp(`/voice/room/${encodeURIComponent(roomId)}/stats`),
                    prefix,
                });
            }, "getRoomVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getRoomVoiceStats");
        }
    }

    /**
     * 获取指定用户的语音消息统计。
     *
     * @param userId - 目标用户 ID
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 该用户的语音统计
     * @throws 当 userId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const stats = await client.getVoiceManager().getUserVoiceStats("@alice:example.org");
     * console.log(stats.message_count);
     * ```
     */
    public async getUserVoiceStats(userId: string, prefix: string = VendorPrefix): Promise<IVoiceUserStats> {
        this.requireNonEmptyString(userId, "User ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceUserStats>({
                    method: Method.Get,
                    path: vp(`/voice/user/${encodeURIComponent(userId)}/stats`),
                    prefix,
                });
            }, "getUserVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getUserVoiceStats");
        }
    }

    /**
     * 获取语音服务配置（带进程内缓存与并发去重）。
     *
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 语音服务配置
     * @example
     * ```typescript
     * const config = await client.getVoiceManager().getVoiceConfig();
     * console.log(config.max_upload_size_bytes, config.allowed_content_types);
     * ```
     */
    public async getVoiceConfig(prefix: string = VendorPrefix): Promise<IVoiceConfig> {
        if (this.cachedConfig) return this.cachedConfig;
        if (this.configPromise) return this.configPromise;
        this.configPromise = this.fetchVoiceConfig(prefix);
        try {
            return await this.configPromise;
        } finally {
            this.configPromise = null;
        }
    }

    private async fetchVoiceConfig(prefix: string): Promise<IVoiceConfig> {
        try {
            const config = await this.withRetry(async () => {
                return await this.request<IVoiceConfig>({
                    method: Method.Get,
                    path: vp("/voice/config"),
                    prefix,
                });
            }, "getVoiceConfig");
            this.cachedConfig = config;
            this.emit(VoiceEvent.ConfigUpdated, config);
            return config;
        } catch (e) {
            throw this.normalizeError(e, "getVoiceConfig");
        }
    }

    /**
     * 通过 JSON（base64）方式上传语音消息。
     *
     * @param request - 上传请求体（内容、内容类型、可选房间与文件名）
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 上传响应（含 content_uri、时长、大小）
     * @throws 当内容或内容类型为空、或请求失败时抛出错误
     * @example
     * ```typescript
     * const res = await client.getVoiceManager().uploadVoiceMessage({
     *     content: base64Audio,
     *     content_type: "audio/ogg",
     * });
     * console.log(res.content_uri);
     * ```
     */
    public async uploadVoiceMessage(
        request: IVoiceUploadRequest,
        prefix: string = VendorPrefix,
    ): Promise<IVoiceUploadResponse> {
        this.requireNonEmptyString(request.content, "Content");
        this.requireNonEmptyString(request.content_type, "Content type");
        try {
            const response = await this.withRetry(
                async () => {
                    return await this.request<IVoiceUploadResponse>({
                        method: Method.Post,
                        path: vp("/voice/upload"),
                        body: request,
                        prefix,
                    });
                },
                { idempotent: false, label: "uploadVoiceMessage" },
            );
            this.emit(VoiceEvent.MessageUploaded, response);
            return response;
        } catch (e) {
            throw this.normalizeError(e, "uploadVoiceMessage");
        }
    }

    /**
     * Upload a voice message using multipart/form-data (P0-2 fix).
     *
     * Avoids the ~33% base64 expansion of the JSON upload path by sending
     * raw audio bytes in a multipart form. Backend must accept multipart
     * (synapse-web `voice.rs` extractor switched to `Multipart`).
     *
     * @throws 当 FormData 缺少 file 字段或文件为空时抛出 ValidationError；请求失败时抛出归一化错误
     * @example
     * ```typescript
     * const formData = new FormData();
     * formData.append("file", audioFile);
     * formData.append("duration_ms", "1200");
     * const res = await client.getVoiceManager().uploadVoiceMessageMultipart({ formData });
     * console.log(res.content_uri);
     * ```
     */
    public async uploadVoiceMessageMultipart(request: IVoiceUploadRequestMultipart): Promise<IVoiceUploadResponse> {
        try {
            const response = await this.withRetry(
                async () => {
                    const formData = request.formData;
                    // Check for required file field
                    if (!formData.has("file")) {
                        throw new ValidationError("Voice upload requires 'file' field in FormData");
                    }
                    const fileValue = formData.get("file");
                    if (
                        !fileValue ||
                        (typeof Blob !== "undefined" && fileValue instanceof Blob && fileValue.size === 0)
                    ) {
                        throw new ValidationError("Voice upload file is empty");
                    }
                    return await this.request<IVoiceUploadResponse>({
                        method: Method.Post,
                        path: vp("/voice/upload"),
                        body: formData,
                        prefix: request.prefix ?? VendorPrefix,
                        // Let the browser set Content-Type with boundary; override only if
                        // the caller explicitly sets content_type in the FormData fields.
                    });
                },
                { idempotent: false, label: "uploadVoiceMessageMultipart" },
            );
            this.emit(VoiceEvent.MessageUploaded, response);
            return response;
        } catch (e) {
            throw this.normalizeError(e, "uploadVoiceMessageMultipart");
        }
    }

    /**
     * 按 media_id 获取单条语音消息记录。
     *
     * @param messageId - 语音消息的 media_id
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 语音消息记录
     * @throws 当 messageId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const message = await client.getVoiceManager().getVoiceMessage(mediaId);
     * console.log(message.content_uri, message.duration_ms);
     * ```
     */
    public async getVoiceMessage(messageId: string, prefix: string = VendorPrefix): Promise<IVoiceMessage> {
        this.requireNonEmptyString(messageId, "Message ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceMessage>({
                    method: Method.Get,
                    path: vp(`/voice/${encodeURIComponent(messageId)}`),
                    prefix,
                });
            }, "getVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "getVoiceMessage");
        }
    }

    /**
     * 按 media_id 删除一条语音消息。
     *
     * @param messageId - 语音消息的 media_id
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 删除结果
     * @throws 当 messageId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const res = await client.getVoiceManager().deleteVoiceMessage(mediaId);
     * console.log(res.deleted);
     * ```
     */
    public async deleteVoiceMessage(messageId: string, prefix: string = VendorPrefix): Promise<IVoiceDeleteResponse> {
        this.requireNonEmptyString(messageId, "Message ID");
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IVoiceDeleteResponse>({
                    method: Method.Delete,
                    path: vp(`/voice/${encodeURIComponent(messageId)}`),
                    prefix,
                });
            }, "deleteVoiceMessage");
            this.emit(VoiceEvent.MessageDeleted, messageId);
            return response;
        } catch (e) {
            throw this.normalizeError(e, "deleteVoiceMessage");
        }
    }

    /**
     * @deprecated The backend exposes a single route for this path; it returns a
     * **voice-message page**, not a room-info object. Use
     * {@link listRoomVoiceMessages} for the correctly-typed result. Kept as a
     * thin delegate so existing callers keep the same request.
     */
    public async getRoomVoice(roomId: string, prefix: string = VendorPrefix): Promise<IVoiceRoomInfo> {
        this.requireNonEmptyString(roomId, "Room ID");
        const page = await this.listRoomVoiceMessages(roomId, {}, prefix);
        return { ...page, room_id: page.room_id ?? roomId };
    }

    /**
     * List voice messages in a room with keyset pagination.
     * GET /_matrix/vendor/v1/voice/room/{room_id}
     *
     * NOTE: the route has **no `/messages` suffix** — it is the same path as
     * `getRoomVoice`, distinguished only by the way the handler renders the
     * body. `synapse-web/src/routes/voice.rs` registers exactly
     * `/voice/room/{room_id}` for both v3 and vendor/v1; appending `/messages`
     * would produce a 404.
     *
     * Backend returns `{ room_id, messages: [...], next_batch: <ms>|null }`.
     *
     * @param roomId - The room ID to list messages for
     * @param params - Optional pagination parameters (`limit`, `from`)
     * @param prefix - API prefix (default: VendorPrefix)
     * @throws 当请求失败时抛出经过归一化的错误
     * @example
     * ```typescript
     * const page = await client.getVoiceManager().listRoomVoiceMessages("!room:example.org", { limit: 20 });
     * console.log(page.messages.length, page.next_batch);
     * ```
     */
    public async listRoomVoiceMessages(
        roomId: string,
        params: IVoiceListQueryParams = {},
        prefix: string = VendorPrefix,
    ): Promise<IVoiceMessageList> {
        this.requireNonEmptyString(roomId, "Room ID");
        try {
            return await this.withRetry(async () => {
                const queryParams: Record<string, string | number | undefined> = {
                    limit: params.limit ?? 50,
                };
                if (params.from !== undefined && params.from !== null) {
                    queryParams.from = params.from;
                }
                return await this.request<IVoiceMessageList>({
                    method: Method.Get,
                    path: vp(`/voice/room/${encodeURIComponent(roomId)}`),
                    queryParams,
                    prefix,
                });
            }, "listRoomVoiceMessages");
        } catch (e) {
            throw this.normalizeError(e, "listRoomVoiceMessages");
        }
    }

    /**
     * List voice messages for a user with keyset pagination.
     * GET /_matrix/vendor/v1/voice/user/{user_id}
     *
     * NOTE: see {@link listRoomVoiceMessages} — no `/messages` suffix exists on
     * the server side, and the caller must be the user themselves
     * (`voice.rs::get_user_voice_messages` rejects cross-user reads with 403).
     *
     * Backend returns `{ user_id, messages: [...], next_batch: <ms>|null }`.
     *
     * @param userId - The user ID to list messages for (must be the caller)
     * @param params - Optional pagination parameters (`limit`, `from`)
     * @param prefix - API prefix (default: VendorPrefix)
     * @throws 当请求失败时抛出经过归一化的错误
     * @example
     * ```typescript
     * const page = await client.getVoiceManager().listUserVoiceMessages("@alice:example.org", { limit: 20 });
     * console.log(page.messages.length, page.next_batch);
     * ```
     */
    public async listUserVoiceMessages(
        userId: string,
        params: IVoiceListQueryParams = {},
        prefix: string = VendorPrefix,
    ): Promise<IVoiceMessageList> {
        this.requireNonEmptyString(userId, "User ID");
        try {
            return await this.withRetry(async () => {
                const queryParams: Record<string, string | number | undefined> = {
                    limit: params.limit ?? 50,
                };
                if (params.from !== undefined && params.from !== null) {
                    queryParams.from = params.from;
                }
                return await this.request<IVoiceMessageList>({
                    method: Method.Get,
                    path: vp(`/voice/user/${encodeURIComponent(userId)}`),
                    queryParams,
                    prefix,
                });
            }, "listUserVoiceMessages");
        } catch (e) {
            throw this.normalizeError(e, "listUserVoiceMessages");
        }
    }

    /**
     * @deprecated Same route as {@link listUserVoiceMessages}, which returns the
     * correctly-typed voice-message page. Kept as a thin delegate.
     */
    public async getUserVoice(userId: string, prefix: string = VendorPrefix): Promise<IVoiceUserInfo> {
        this.requireNonEmptyString(userId, "User ID");
        const page = await this.listUserVoiceMessages(userId, {}, prefix);
        return { ...page, user_id: page.user_id ?? userId };
    }

    /**
     * 将语音消息转换为指定格式（MSC3245 约定由客户端完成转码）。
     *
     * @param mediaId - 语音消息的 media_id
     * @param options - 转换选项（如目标 format）
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 转换结果
     * @throws 当 mediaId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const res = await client.getVoiceManager().convertVoiceMessage(mediaId, { format: "ogg" });
     * console.log(res.media_id);
     * ```
     */
    public async convertVoiceMessage(
        mediaId: string,
        options?: IVoiceConvertOptions,
        prefix: string = VendorPrefix,
    ): Promise<IVoiceConvertResponse> {
        this.requireNonEmptyString(mediaId, "Media ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceConvertResponse>({
                    method: Method.Post,
                    path: vp(`/voice/${encodeURIComponent(mediaId)}/convert`),
                    body: options ?? {},
                    prefix,
                });
            }, "convertVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "convertVoiceMessage");
        }
    }

    /**
     * 优化语音消息（降低码率/体积，MSC3245 约定由客户端完成）。
     *
     * @param mediaId - 语音消息的 media_id
     * @param options - 优化选项（如目标 bitrate）
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 优化结果
     * @throws 当 mediaId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const res = await client.getVoiceManager().optimizeVoiceMessage(mediaId, { bitrate: 24000 });
     * console.log(res.media_id);
     * ```
     */
    public async optimizeVoiceMessage(
        mediaId: string,
        options?: IVoiceOptimizeOptions,
        prefix: string = VendorPrefix,
    ): Promise<IVoiceOptimizeResponse> {
        this.requireNonEmptyString(mediaId, "Media ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceOptimizeResponse>({
                    method: Method.Post,
                    path: vp(`/voice/${encodeURIComponent(mediaId)}/optimize`),
                    body: options ?? {},
                    prefix,
                });
            }, "optimizeVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "optimizeVoiceMessage");
        }
    }

    /**
     * 转写语音消息为文本（MSC3245 约定由客户端完成）。
     *
     * @param mediaId - 语音消息的 media_id
     * @param options - 转写选项（如 language）
     * @param prefix - API 前缀（默认 VendorPrefix）
     * @returns 转写结果（文本、语言、置信度）
     * @throws 当 mediaId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const res = await client.getVoiceManager().transcribeVoiceMessage(mediaId, { language: "zh" });
     * console.log(res.text);
     * ```
     */
    public async transcribeVoiceMessage(
        mediaId: string,
        options?: IVoiceTranscribeOptions,
        prefix: string = VendorPrefix,
    ): Promise<IVoiceTranscribeResponse> {
        this.requireNonEmptyString(mediaId, "Media ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceTranscribeResponse>({
                    method: Method.Post,
                    path: vp(`/voice/${encodeURIComponent(mediaId)}/transcription`),
                    body: options ?? {},
                    prefix,
                });
            }, "transcribeVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "transcribeVoiceMessage");
        }
    }

    /**
     * Register an encrypted voice attachment to the voice_usage_stats table.
     *
     * Phase 2.3 - After uploading encrypted voice via standard media service
     * (e.g., `matrixMediaService.uploadEncryptedFile`), call this method to
     * register the voice so it appears in lists.
     *
     * @param roomId - The room the voice belongs to
     * @param mediaId - The media_id from the mxc:// URL
     * @param durationMs - Duration in milliseconds
     * @param sizeBytes - File size in bytes
     * @param contentType - Content type (e.g., "audio/webm")
     * @param prefix - API prefix (default: VendorPrefix)
     * @throws 当 roomId/mediaId 为空或请求失败时抛出错误
     * @example
     * ```typescript
     * const res = await client.getVoiceManager().registerEncryptedVoice(
     *     "!room:example.org",
     *     mediaId,
     *     1200,
     *     4096,
     * );
     * console.log(res.exists);
     * ```
     */
    public async registerEncryptedVoice(
        roomId: string,
        mediaId: string,
        durationMs: number,
        sizeBytes: number,
        contentType: string = "audio/webm",
        prefix: string = VendorPrefix,
    ): Promise<IVoiceRegisterResponse> {
        this.requireNonEmptyString(roomId, "Room ID");
        this.requireNonEmptyString(mediaId, "Media ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceRegisterResponse>({
                    method: Method.Post,
                    path: vp("/voice/register"),
                    body: {
                        room_id: roomId,
                        media_id: mediaId,
                        content_type: contentType,
                        duration_ms: durationMs,
                        size_bytes: sizeBytes,
                    },
                    prefix,
                });
            }, "registerEncryptedVoice");
        } catch (e) {
            throw this.normalizeError(e, "registerEncryptedVoice");
        }
    }

    /**
     * 同步读取已缓存的语音配置（不发起请求）。
     *
     * @returns 已缓存的配置，尚未获取时为 null
     * @example
     * ```typescript
     * const cached = client.getVoiceManager().getCachedConfig();
     * if (cached) console.log("cached max size:", cached.max_upload_size_bytes);
     * ```
     */
    public getCachedConfig(): IVoiceConfig | null {
        return this.cachedConfig;
    }

    /**
     * 获取 RTC 传输协议信息（MSC4143 unstable 端点）。
     *
     * 对应后端 GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports。
     * 失败时抛出错误，调用方按无 RTC 能力处理。
     *
     * @throws 当请求失败时抛出经过归一化的错误
     * @example
     * ```typescript
     * const transports = await client.getVoiceManager().getRtcTransports();
     * console.log(Object.keys(transports));
     * ```
     */
    public async getRtcTransports(): Promise<Record<string, unknown>> {
        try {
            return await this.withRetry(async () => {
                return await this.request<Record<string, unknown>>({
                    method: Method.Get,
                    path: "/org.matrix.msc4143/rtc/transports",
                    prefix: ClientPrefix.Unstable,
                });
            }, "getRtcTransports");
        } catch (e) {
            throw this.normalizeError(e, "getRtcTransports");
        }
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVoiceManager = function (): VoiceManager {
        registerManagerClass("voice", VoiceManager);
        return getOrCreateManager(this, "voice", () => new VoiceManager(this));
    };
}
