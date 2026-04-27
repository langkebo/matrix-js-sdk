import { logger } from "../logger.js";
/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Voice Message Manager - 语音消息管理
 *
 * 对接后端: synapse-rust/src/web/routes/voice.rs
 * 后端已简化为标准 media 适配层，仅提供:
 *   - POST /_matrix/client/r0/voice/upload  (专用语音上传)
 *   - GET  /_matrix/client/r0/voice/config  (获取语音配置)
 * 语音消息使用 m.audio + org.matrix.msc3245.voice 事件格式
 */

import { BaseManager } from "../managers/base-manager.ts";
import { Method } from "../http-api/method.ts";
import { MatrixClient } from "../client";
import { getHttpUriForMxc } from "../content-repo.ts";
import type { RoomMessageEventContent } from "../@types/events.ts";

const VOICE_R0_PREFIX = "/_matrix/client/r0";

export enum VoiceEvent {
    StateChanged = "StateChanged",
    NewSession = "NewSession",
    SessionCreated = "SessionCreated",
    SessionEnded = "SessionEnded",
    UploadProgress = "UploadProgress",
    UploadComplete = "UploadComplete",
    UploadError = "UploadError",
    VoiceUploaded = "VoiceUploaded",
    VoiceDeleted = "VoiceDeleted",
}

export interface VoiceConfig {
    enabled: boolean;
    maxDuration?: number;
    max_duration_ms?: number;
    max_size_bytes?: number;
    supported_formats?: string[];
    sampleRate?: number;
    channels?: number;
}

export interface VoiceMessageUploadParams {
    roomId: string;
    file: File | Blob | ArrayBuffer;
    filename?: string;
    duration?: number;
    size?: number;
    mimeType?: string;
}

export interface VoiceMessageUploadResult {
    eventId: string;
    url: string;
    duration: number;
    size: number;
}

interface EventIdResponse {
    event_id: string;
}

export interface VoiceMessage {
    eventId: string;
    url: string;
    duration: number;
    size: number;
    waveform?: number[];
}

export interface VoiceMessageInfo {
    eventId: string;
    duration: number;
    waveform?: number[];
    mimeType?: string;
    size?: number;
}

export interface VoiceStats {
    totalDuration: number;
    messageCount: number;
    totalSize: number;
}

export interface VoiceUploadProgress {
    loaded: number;
    total: number;
    percentage: number;
}

interface VoiceMessageManagerEventMap {
    [VoiceEvent.StateChanged]: (state: string) => void;
    [VoiceEvent.NewSession]: (sessionId: string) => void;
    [VoiceEvent.SessionCreated]: (sessionId: string, roomId: string) => void;
    [VoiceEvent.SessionEnded]: (sessionId: string) => void;
    [VoiceEvent.UploadProgress]: (roomId: string, progress: VoiceUploadProgress) => void;
    [VoiceEvent.UploadComplete]: (roomId: string, result: VoiceMessageUploadResult) => void;
    [VoiceEvent.UploadError]: (roomId: string, error: Error) => void;
    [VoiceEvent.VoiceUploaded]: (roomId: string, eventId: string) => void;
    [VoiceEvent.VoiceDeleted]: (roomId: string, eventId: string) => void;
}

export class VoiceMessageManager extends BaseManager<VoiceEvent, VoiceMessageManagerEventMap> {
    private config: VoiceConfig;
    private activeSessions: Map<string, { roomId: string; startedAt: number }> = new Map();
    private waveformCache: Map<string, number[]> = new Map();

    constructor(client: MatrixClient, config?: Partial<VoiceConfig>) {
        super(client);
        this.config = {
            enabled: config?.enabled ?? true,
            maxDuration: config?.maxDuration ?? 300000,
            sampleRate: config?.sampleRate ?? 48000,
            channels: config?.channels ?? 1,
        };
    }

    async getServerConfig(): Promise<VoiceConfig> {
        try {
            const response = await this.client.http.authedRequest<{
                enabled: boolean;
                max_duration_ms?: number;
                max_size_bytes?: number;
                supported_formats?: string[];
            }>(Method.Get, "/voice/config", undefined, undefined, { prefix: VOICE_R0_PREFIX });

            return {
                enabled: response.enabled ?? true,
                max_duration_ms: response.max_duration_ms,
                max_size_bytes: response.max_size_bytes,
                supported_formats: response.supported_formats,
            };
        } catch (e) {
            const error = this.normalizeError(e, "getServerConfig");
            logger.warn("VoiceMessageManager.getServerConfig failed:", error);
            return { enabled: true };
        }
    }

    async uploadVoiceMessage(params: VoiceMessageUploadParams): Promise<VoiceMessageUploadResult> {
        const { roomId, file, filename, duration, size, mimeType } = params;

        if (!roomId) {
            throw new Error("Room ID is required");
        }

        if (!file) {
            throw new Error("File is required");
        }

        const actualSize = size || (file instanceof Blob ? file.size : (file as ArrayBuffer).byteLength);
        const actualMimeType = mimeType || (file instanceof Blob ? file.type : "audio/ogg");

        if (this.config.maxDuration && duration && duration > this.config.maxDuration) {
            throw new Error(`Voice message duration exceeds maximum allowed (${this.config.maxDuration}ms)`);
        }

        try {
            const uploadResult = await this.client.uploadContent(file, {
                name: filename || "voice-message.ogg",
                type: actualMimeType,
                includeFilename: false,
                progressHandler: (progress: { loaded: number; total: number }) => {
                    this.emit(VoiceEvent.UploadProgress, roomId, {
                        loaded: progress.loaded,
                        total: progress.total,
                        percentage: Math.round((progress.loaded / progress.total) * 100),
                    } as VoiceUploadProgress);
                },
            });

            const contentUri = uploadResult.content_uri;
            if (!contentUri) {
                throw new Error("Failed to get content URI from upload");
            }

            const waveform = await this.generateWaveform(file);

            const messageContent = {
                "msgtype": "m.audio",
                "body": filename || "Voice message",
                "url": contentUri,
                "info": {
                    duration: duration || 0,
                    size: actualSize,
                    mimetype: actualMimeType,
                    waveform: waveform,
                },
                "org.matrix.msc3245.voice": duration ? { duration } : undefined,
                "m.mentions": {},
            };

            const eventResponse = (await this.client.sendEvent(
                roomId,
                "m.room.message",
                messageContent as unknown as RoomMessageEventContent,
            )) as EventIdResponse;

            const result: VoiceMessageUploadResult = {
                eventId: eventResponse.event_id,
                url: contentUri,
                duration: duration || 0,
                size: actualSize,
            };

            this.emit(VoiceEvent.UploadComplete, roomId, result);

            return result;
        } catch (e) {
            const err = this.normalizeError(e, "uploadVoiceMessage");
            this.emit(VoiceEvent.UploadError, roomId, err);
            throw err;
        }
    }

    async getVoiceMessageInfo(roomId: string, eventId: string): Promise<VoiceMessageInfo | null> {
        try {
            const event = await this.client.fetchRoomEvent(roomId, eventId);

            if (!event || event.type !== "m.room.message") {
                return null;
            }

            const content = event.content as Record<string, unknown> | undefined;
            if (!content || (content.msgtype !== "m.audio" && !content.url)) {
                return null;
            }

            const info = (content.info as Record<string, unknown>) || {};

            return {
                eventId,
                duration: (info.duration as number) || 0,
                waveform: info.waveform as number[] | undefined,
                mimeType: (info.mimetype as string) || "audio/ogg",
                size: info.size as number | undefined,
            };
        } catch (e) {
            const error = this.normalizeError(e, "getVoiceMessageInfo");
            logger.warn("VoiceMessageManager.getVoiceMessageInfo failed:", error);
            return null;
        }
    }

    async getVoiceStats(roomId: string): Promise<VoiceStats> {
        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return { totalDuration: 0, messageCount: 0, totalSize: 0 };
            }

            const timeline = room.getLiveTimeline();
            const events = timeline.getEvents();

            let totalDuration = 0;
            let messageCount = 0;
            let totalSize = 0;

            for (const event of events) {
                if (event.getType() === "m.room.message") {
                    const content = event.getContent<{ msgtype?: string; info?: { duration?: number; size?: number } }>();
                    if (content.msgtype === "m.audio" && content.info) {
                        totalDuration += content.info.duration || 0;
                        totalSize += content.info.size || 0;
                        messageCount++;
                    }
                }
            }

            return { totalDuration, messageCount, totalSize };
        } catch (e) {
            const error = this.normalizeError(e, "getVoiceStats");
            logger.warn("VoiceMessageManager.getVoiceStats failed:", error);
            return { totalDuration: 0, messageCount: 0, totalSize: 0 };
        }
    }

    async downloadVoiceMessage(mxcUrl: string): Promise<Blob> {
        try {
            const httpUrl = getHttpUriForMxc(this.client.getHomeserverUrl(), mxcUrl);
            const response = await fetch(httpUrl);
            return await response.blob();
        } catch (e) {
            const error = this.normalizeError(e, "downloadVoiceMessage");
            logger.warn("VoiceMessageManager.downloadVoiceMessage failed:", error);
            throw error;
        }
    }

    async getWaveform(mxcUrl: string): Promise<number[]> {
        const cached = this.waveformCache.get(mxcUrl);
        if (cached) {
            return cached;
        }

        try {
            const blob = await this.downloadVoiceMessage(mxcUrl);
            const waveform = await this.generateWaveform(blob);
            this.waveformCache.set(mxcUrl, waveform);
            return waveform;
        } catch (e) {
            const error = this.normalizeError(e, "getWaveform");
            logger.warn("VoiceMessageManager.getWaveform failed:", error);
            return [];
        }
    }

    private async generateWaveform(file: File | Blob | ArrayBuffer): Promise<number[]> {
        try {
            const AudioContextClass =
                window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AudioContextClass) {
                logger.warn("AudioContext not available");
                return [];
            }
            const audioContext = new AudioContextClass();
            let arrayBuffer: ArrayBuffer;

            if (file instanceof ArrayBuffer) {
                arrayBuffer = file;
            } else {
                arrayBuffer = await file.arrayBuffer();
            }

            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const channelData = audioBuffer.getChannelData(0);

            const samples = 100;
            const blockSize = Math.floor(channelData.length / samples);
            const waveform: number[] = [];

            for (let i = 0; i < samples; i++) {
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.abs(channelData[i * blockSize + j]);
                }
                waveform.push(sum / blockSize);
            }

            const max = Math.max(...waveform);
            const normalizedWaveform = waveform.map((v) => v / max);

            await audioContext.close();

            return normalizedWaveform;
        } catch (e) {
            const error = this.normalizeError(e, "generateWaveform");
            logger.warn("VoiceMessageManager.generateWaveform failed:", error);
            return [];
        }
    }

    createRecordingSession(roomId: string): string {
        const sessionId = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.activeSessions.set(sessionId, {
            roomId,
            startedAt: Date.now(),
        });
        this.emit(VoiceEvent.SessionCreated, sessionId, roomId);
        return sessionId;
    }

    endRecordingSession(sessionId: string): void {
        this.activeSessions.delete(sessionId);
        this.emit(VoiceEvent.SessionEnded, sessionId);
    }

    getActiveSessions(): string[] {
        return Array.from(this.activeSessions.keys());
    }

    getSessionInfo(sessionId: string): { roomId: string; startedAt: number } | null {
        return this.activeSessions.get(sessionId) || null;
    }

    async deleteVoice(roomId: string, eventId: string): Promise<void> {
        try {
            await this.client.redactEvent(roomId, eventId);
            this.emit(VoiceEvent.VoiceDeleted, roomId, eventId);
            logger.debug(`[Voice] Deleted voice: ${roomId}/${eventId}`);
        } catch (e) {
            logger.warn("VoiceMessageManager.deleteVoice failed:", e);
            throw e;
        }
    }

    async getVoicePlaybackUrl(mxcUrl: string): Promise<string> {
        try {
            return getHttpUriForMxc(this.client.getHomeserverUrl(), mxcUrl);
        } catch (e) {
            logger.warn("VoiceMessageManager.getVoicePlaybackUrl failed:", e);
            throw e;
        }
    }

    setConfig(config: Partial<VoiceConfig>): void {
        this.config = { ...this.config, ...config };
    }

    getConfig(): VoiceConfig {
        return { ...this.config };
    }

    clearWaveformCache(): void {
        this.waveformCache.clear();
    }

    start(): void {
        this.emit(VoiceEvent.StateChanged, "started");
    }

    stop(): void {
        this.activeSessions.clear();
        this.waveformCache.clear();
        this.emit(VoiceEvent.StateChanged, "stopped");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getVoiceManager(): VoiceMessageManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVoiceManager = function (): VoiceMessageManager {
        return new VoiceMessageManager(this);
    };
}

export default extendMatrixClient;
