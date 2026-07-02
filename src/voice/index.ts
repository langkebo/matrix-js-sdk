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
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
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

    constructor(client: MatrixClient) {
        super(client);
    }

    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.Voice, true);
    }

    public async getVoiceStats(prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceStats> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceStats>(
                    Method.Get,
                    "/voice/stats",
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "getVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getVoiceStats");
        }
    }

    public async getRoomVoiceStats(roomId: string, prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceRoomStats> {
        this.requireNonEmptyString(roomId, "Room ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceRoomStats>(
                    Method.Get,
                    `/voice/room/${encodeURIComponent(roomId)}/stats`,
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "getRoomVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getRoomVoiceStats");
        }
    }

    public async getUserVoiceStats(userId: string, prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceUserStats> {
        this.requireNonEmptyString(userId, "User ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceUserStats>(
                    Method.Get,
                    `/voice/user/${encodeURIComponent(userId)}/stats`,
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "getUserVoiceStats");
        } catch (e) {
            throw this.normalizeError(e, "getUserVoiceStats");
        }
    }

    public async getVoiceConfig(prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceConfig> {
        try {
            const config = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceConfig>(
                    Method.Get,
                    "/voice/config",
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "getVoiceConfig");
            this.cachedConfig = config;
            this.emit(VoiceEvent.ConfigUpdated, config);
            return config;
        } catch (e) {
            throw this.normalizeError(e, "getVoiceConfig");
        }
    }

    public async uploadVoiceMessage(request: IVoiceUploadRequest, prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceUploadResponse> {
        this.requireNonEmptyString(request.content, "Content");
        this.requireNonEmptyString(request.content_type, "Content type");
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceUploadResponse>(
                    Method.Post,
                    "/voice/upload",
                    undefined,
                    request,
                    { prefix },
                );
            }, "uploadVoiceMessage");
            this.emit(VoiceEvent.MessageUploaded, response);
            return response;
        } catch (e) {
            throw this.normalizeError(e, "uploadVoiceMessage");
        }
    }

    public async getVoiceMessage(messageId: string, prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceMessage> {
        this.requireNonEmptyString(messageId, "Message ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceMessage>(
                    Method.Get,
                    `/voice/${encodeURIComponent(messageId)}`,
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "getVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "getVoiceMessage");
        }
    }

    public async deleteVoiceMessage(messageId: string, prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceDeleteResponse> {
        this.requireNonEmptyString(messageId, "Message ID");
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceDeleteResponse>(
                    Method.Delete,
                    `/voice/${encodeURIComponent(messageId)}`,
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "deleteVoiceMessage");
            this.emit(VoiceEvent.MessageDeleted, messageId);
            return response;
        } catch (e) {
            throw this.normalizeError(e, "deleteVoiceMessage");
        }
    }

    public async getRoomVoice(roomId: string, prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceRoomInfo> {
        this.requireNonEmptyString(roomId, "Room ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceRoomInfo>(
                    Method.Get,
                    `/voice/room/${encodeURIComponent(roomId)}`,
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "getRoomVoice");
        } catch (e) {
            throw this.normalizeError(e, "getRoomVoice");
        }
    }

    public async getUserVoice(userId: string, prefix: ClientPrefix = ClientPrefix.V3): Promise<IVoiceUserInfo> {
        this.requireNonEmptyString(userId, "User ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceUserInfo>(
                    Method.Get,
                    `/voice/user/${encodeURIComponent(userId)}`,
                    undefined,
                    undefined,
                    { prefix },
                );
            }, "getUserVoice");
        } catch (e) {
            throw this.normalizeError(e, "getUserVoice");
        }
    }

    public async convertVoiceMessage(
        mediaId: string,
        options?: IVoiceConvertOptions,
        prefix: ClientPrefix = ClientPrefix.V3,
    ): Promise<IVoiceConvertResponse> {
        this.requireNonEmptyString(mediaId, "Media ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceConvertResponse>(
                    Method.Post,
                    `/voice/${encodeURIComponent(mediaId)}/convert`,
                    undefined,
                    options ?? {},
                    { prefix },
                );
            }, "convertVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "convertVoiceMessage");
        }
    }

    public async optimizeVoiceMessage(
        mediaId: string,
        options?: IVoiceOptimizeOptions,
        prefix: ClientPrefix = ClientPrefix.V3,
    ): Promise<IVoiceOptimizeResponse> {
        this.requireNonEmptyString(mediaId, "Media ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceOptimizeResponse>(
                    Method.Post,
                    `/voice/${encodeURIComponent(mediaId)}/optimize`,
                    undefined,
                    options ?? {},
                    { prefix },
                );
            }, "optimizeVoiceMessage");
        } catch (e) {
            throw this.normalizeError(e, "optimizeVoiceMessage");
        }
    }

    public async transcribeVoiceMessage(
        mediaId: string,
        options?: IVoiceTranscribeOptions,
        prefix: ClientPrefix = ClientPrefix.V3,
    ): Promise<IVoiceTranscribeResponse> {
        this.requireNonEmptyString(mediaId, "Media ID");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVoiceTranscribeResponse>(
                    Method.Post,
                    `/voice/${encodeURIComponent(mediaId)}/transcription`,
                    undefined,
                    options ?? {},
                    { prefix },
                );
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

export default VoiceManager;
