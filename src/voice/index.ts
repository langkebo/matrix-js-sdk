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
import { VendorPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";

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
    content: string;
    content_type: string;
    room_id?: string;
    filename?: string;
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
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.Voice, true);
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
            const response = await this.withRetry(async () => {
                return await this.request<IVoiceUploadResponse>({
                    method: Method.Post,
                    path: "/voice/upload",
                    body: request,
                    prefix,
                });
            }, { idempotent: false, label: "uploadVoiceMessage" });
            this.emit(VoiceEvent.MessageUploaded, response);
            return response;
        } catch (e) {
            throw this.normalizeError(e, "uploadVoiceMessage");
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

    public async deleteVoiceMessage(
        messageId: string,
        prefix: string = VendorPrefix,
    ): Promise<IVoiceDeleteResponse> {
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
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVoiceManager = function (): VoiceManager {
        registerManagerClass("voice", VoiceManager);
        return getOrCreateManager(this, "voice", () => new VoiceManager(this));
    };
}
