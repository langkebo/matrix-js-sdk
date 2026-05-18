import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { getOrCreateManager } from "../client-infra/manager-registry";
import type { VoicePathPattern } from "./__generated__/route-table";

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

export interface IVoiceConvertRequest {
    message_id: string;
    target_content_type: string;
}

export interface IVoiceOptimizeRequest {
    message_id: string;
    target_bitrate?: number;
    target_sample_rate?: number;
}

export interface IVoiceTranscriptionRequest {
    message_id: string;
    language?: string;
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

    /** @deprecated MSC3245 does not define server-side audio conversion. Use client-side AudioContext/Web Audio API instead. */
    public async convertVoiceMessage(_request: IVoiceConvertRequest, _prefix: ClientPrefix = ClientPrefix.V3): Promise<never> {
        throw new Error("Server-side voice conversion is not supported per MSC3245. Use client-side Web Audio API for audio format conversion.");
    }

    /** @deprecated MSC3245 does not define server-side audio optimization. Use client-side AudioContext/Web Audio API instead. */
    public async optimizeVoiceMessage(_request: IVoiceOptimizeRequest, _prefix: ClientPrefix = ClientPrefix.V3): Promise<never> {
        throw new Error("Server-side voice optimization is not supported per MSC3245. Use client-side Web Audio API for audio processing.");
    }

    /** @deprecated MSC3245 does not define server-side transcription. Use client-side Web Speech API or a third-party service instead. */
    public async transcribeVoiceMessage(_request: IVoiceTranscriptionRequest, _prefix: ClientPrefix = ClientPrefix.V3): Promise<never> {
        throw new Error("Server-side voice transcription is not supported per MSC3245. Use client-side Web Speech API or a third-party transcription service.");
    }

    public getCachedConfig(): IVoiceConfig | null {
        return this.cachedConfig;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getVoiceManager(): VoiceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVoiceManager = function (): VoiceManager {
        return getOrCreateManager(this, "voice", () => new VoiceManager(this));
    };
}

export default VoiceManager;
