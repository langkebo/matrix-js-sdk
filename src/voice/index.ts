/**
 * Voice Manager - 语音消息管理 API 封装
 *
 * 提供语音消息统计查询、配置获取、上传/获取/删除语音消息等功能
 * 对接后端: synapse-rust/src/web/routes/voice.rs
 * API 前缀: /_matrix/client/v3/voice（v3）和 /_matrix/client/v1/voice（v1）
 *
 * 注意：MSC3245 协议规定语音转码/转录/优化在客户端完成
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

export interface IVoiceUploadResponse {
    message_id: string;
    url: string;
    mxc_url: string;
    content_type: string;
    size_bytes: number;
    duration_ms: number;
}

export interface IVoiceTranscriptionResponse {
    message_id: string;
    text: string;
    language: string;
    confidence: number;
}

export interface IVoiceMessage {
    message_id: string;
    url: string;
    mxc_url: string;
    content_type: string;
    size_bytes: number;
    duration_ms: number;
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

    public async isSupported(): Promise<boolean> {
        // 后端未实 Voice 路由：探测失败时绝不能误判支持（FT-S13）
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.Voice, false);
    }

    public async getVoiceStats(prefix: string = VendorPrefix): Promise<IVoiceStats> {
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceStats>({
                    method: Method.Get,
                    path: "/voice/stats",
                    prefix,
                });
            }, "getVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getVoiceStats");
        }
    }

    public async getRoomVoiceStats(roomId: string, prefix: string = VendorPrefix): Promise<IVoiceRoomStats> {
        this.requireNonEmptyString(roomId, "Room ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceRoomStats>({
                    method: Method.Get,
                    path: `/voice/room/${encodeURIComponent(roomId)}/stats`,
                    prefix,
                });
            }, "getRoomVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getRoomVoiceStats");
        }
    }

    public async getUserVoiceStats(userId: string, prefix: string = VendorPrefix): Promise<IVoiceUserStats> {
        this.requireNonEmptyString(userId, "User ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceUserStats>({
                    method: Method.Get,
                    path: `/voice/user/${encodeURIComponent(userId)}/stats`,
                    prefix,
                });
            }, "getUserVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getUserVoiceStats");
        }
    }

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
                    path: "/voice/config",
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
                        path: "/voice/upload",
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
     */
    public async uploadVoiceMessageMultipart(
        request: IVoiceUploadRequestMultipart,
    ): Promise<IVoiceUploadResponse> {
        try {
            const response = await this.withRetry(
                async () => {
                    const formData = request.formData;
                    // Check for required file field
                    if (!formData.has("file")) {
                        throw new ValidationError("Voice upload requires 'file' field in FormData");
                    }
                    const fileValue = formData.get("file");
                    if (!fileValue || (typeof Blob !== "undefined" && fileValue instanceof Blob && fileValue.size === 0)) {
                        throw new ValidationError("Voice upload file is empty");
                    }
                    return await this.request<IVoiceUploadResponse>({
                        method: Method.Post,
                        path: "/voice/upload",
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

    public async getVoiceMessage(messageId: string, prefix: string = VendorPrefix): Promise<IVoiceMessage> {
        this.requireNonEmptyString(messageId, "Message ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceMessage>({
                    method: Method.Get,
                    path: `/voice/${encodeURIComponent(messageId)}`,
                    prefix,
                });
            }, "getVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "getVoiceMessage");
        }
    }

    public async deleteVoiceMessage(messageId: string, prefix: string = VendorPrefix): Promise<IVoiceDeleteResponse> {
        this.requireNonEmptyString(messageId, "Message ID");
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IVoiceDeleteResponse>({
                    method: Method.Delete,
                    path: `/voice/${encodeURIComponent(messageId)}`,
                    prefix,
                });
            }, "deleteVoiceMessage");
            this.emit(VoiceEvent.MessageDeleted, messageId);
            return response;
        } catch (e) {
            throw this.normalizeError(e, "deleteVoiceMessage");
        }
    }

    public async getRoomVoice(roomId: string, prefix: string = VendorPrefix): Promise<IVoiceRoomInfo> {
        this.requireNonEmptyString(roomId, "Room ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceRoomInfo>({
                    method: Method.Get,
                    path: `/voice/room/${encodeURIComponent(roomId)}`,
                    prefix,
                });
            }, "getRoomVoice");
        } catch (e) {
            throw this.normalizeError(e, "getRoomVoice");
        }
    }

    public async getUserVoice(userId: string, prefix: string = VendorPrefix): Promise<IVoiceUserInfo> {
        this.requireNonEmptyString(userId, "User ID");
        try {
            return await this.withRetry(async () => {
                return await this.request<IVoiceUserInfo>({
                    method: Method.Get,
                    path: `/voice/user/${encodeURIComponent(userId)}`,
                    prefix,
                });
            }, "getUserVoice");
        } catch (e) {
            throw this.normalizeError(e, "getUserVoice");
        }
    }

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
                    path: `/voice/${encodeURIComponent(mediaId)}/convert`,
                    body: options ?? {},
                    prefix,
                });
            }, "convertVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "convertVoiceMessage");
        }
    }

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
                    path: `/voice/${encodeURIComponent(mediaId)}/optimize`,
                    body: options ?? {},
                    prefix,
                });
            }, "optimizeVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "optimizeVoiceMessage");
        }
    }

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
                    path: `/voice/${encodeURIComponent(mediaId)}/transcription`,
                    body: options ?? {},
                    prefix,
                });
            }, "transcribeVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "transcribeVoiceMessage");
        }
    }

    public getCachedConfig(): IVoiceConfig | null {
        return this.cachedConfig;
    }

    /**
     * 获取 RTC 传输协议信息（MSC4143 unstable 端点）。
     *
     * 对应后端 GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports。
     * 失败时抛出错误，调用方按无 RTC 能力处理。
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
