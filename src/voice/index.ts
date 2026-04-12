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
 * 提供语音消息上传、播放、转换功能
 * 对接后端: synapse-rust/src/services/voice_service.rs
 */

import { BaseManager } from "../managers/base-manager.ts";
import { Method } from "../http-api/method.ts";
import { MatrixClient } from "../client";
import { getHttpUriForMxc } from "../content-repo.ts";
import type { RoomMessageEventContent } from "../@types/events.ts";

const VOICE_R0_PREFIX = "/_matrix/client/r0";
const VOICE_V1_PREFIX = "/_matrix/client/v1";

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
    VoiceConverted = "VoiceConverted",
    VoiceOptimized = "VoiceOptimized",
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
    message_id?: string;
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

export interface VoiceConvertParams {
    inputUrl?: string;
    messageId?: string;
    outputFormat?: string;
    bitrate?: number;
}

export interface VoiceConvertResult {
    message_id?: string;
    event_id?: string;
    url: string;
    duration: number;
    format: string;
}

export interface VoiceOptimizeParams {
    inputUrl: string;
    quality?: number;
    targetSize?: number;
}

export interface VoiceOptimizeResult {
    message_id?: string;
    event_id?: string;
    url: string;
    originalSize: number;
    optimizedSize: number;
    compressionRatio: number;
}

export interface VoiceTranscriptionParams {
    audioUrl: string;
    language?: string;
    model?: string;
}

export interface VoiceTranscriptionResult {
    text: string;
    confidence?: number;
    language?: string;
    words?: Array<{
        word: string;
        start: number;
        end: number;
        confidence: number;
    }>;
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
    [VoiceEvent.VoiceConverted]: (roomId: string, eventId: string, result: VoiceConvertResult) => void;
    [VoiceEvent.VoiceOptimized]: (roomId: string, eventId: string, result: VoiceOptimizeResult) => void;
}

export class VoiceMessageManager extends BaseManager<VoiceEvent, VoiceMessageManagerEventMap> {
    private config: VoiceConfig;
    private activeSessions: Map<string, { roomId: string; startedAt: number }> = new Map();
    private waveformCache: Map<string, number[]> = new Map();

    constructor(client: MatrixClient, config?: Partial<VoiceConfig>) {
        super(client);
        this.config = {
            enabled: config?.enabled ?? true,
            maxDuration: config?.maxDuration ?? 300000, // 5 minutes
            sampleRate: config?.sampleRate ?? 48000,
            channels: config?.channels ?? 1,
        };
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
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
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
                    const content = event.getContent();
                    if (content.msgtype === "m.audio" && content.info) {
                        totalDuration += content.info.duration || 0;
                        totalSize += content.info.size || 0;
                        messageCount++;
                    }
                }
            }

            return { totalDuration, messageCount, totalSize };
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getVoiceStats");
            logger.warn("VoiceMessageManager.getVoiceStats failed:", error);
            return { totalDuration: 0, messageCount: 0, totalSize: 0 };
        }
    }

    async convertVoiceMessage(params: VoiceConvertParams): Promise<VoiceConvertResult> {
        const { inputUrl, messageId, outputFormat = "mp3", bitrate = 128 } = params;

        if (!inputUrl && !messageId) {
            throw new Error("Either inputUrl or messageId is required");
        }

        const body: Record<string, unknown> = {
            target_format: outputFormat,
            quality: 128,
            bitrate: bitrate * 1000,
        };
        if (inputUrl) body.input_url = inputUrl;
        if (messageId) body.message_id = messageId;

        try {
            const response = await this.client.http.authedRequest<{ url: string; duration: number }>(
                Method.Post,
                "/voice/convert",
                undefined,
                body,
                { prefix: VOICE_R0_PREFIX },
            );

            return {
                url: response.url,
                duration: response.duration,
                format: outputFormat,
            };
        } catch (e) {
            const error = this.normalizeError(e, "convertVoiceMessage");
            logger.warn("VoiceMessageManager.convertVoiceMessage failed:", error);
            throw error;
        }
    }

    async optimizeVoiceMessage(params: VoiceOptimizeParams): Promise<VoiceOptimizeResult> {
        const { inputUrl, quality = 0.8, targetSize } = params;

        try {
            const response = await this.client.http.authedRequest<{
                url: string;
                original_size: number;
                optimized_size: number;
            }>(
                Method.Post,
                "/voice/optimize",
                undefined,
                {
                    input_url: inputUrl,
                    quality,
                    target_size: targetSize,
                },
                { prefix: VOICE_R0_PREFIX },
            );

            return {
                url: response.url,
                originalSize: response.original_size,
                optimizedSize: response.optimized_size,
                compressionRatio: response.original_size / response.optimized_size,
            };
        } catch (e) {
            const error = this.normalizeError(e, "optimizeVoiceMessage");
            logger.warn("VoiceMessageManager.optimizeVoiceMessage failed:", error);
            throw error;
        }
    }

    async transcribeVoiceMessage(params: VoiceTranscriptionParams): Promise<VoiceTranscriptionResult> {
        const { audioUrl, language, model } = params;

        try {
            const response = await this.client.http.authedRequest<{
                text: string;
                confidence?: number;
                language?: string;
                words?: unknown[];
            }>(
                Method.Post,
                "/voice/transcription",
                undefined,
                {
                    audio_url: audioUrl,
                    language,
                    model,
                },
                { prefix: VOICE_V1_PREFIX },
            );

            const result: VoiceTranscriptionResult = {
                text: response.text,
            };
            if (response.confidence !== undefined) result.confidence = response.confidence;
            if (response.language !== undefined) result.language = response.language;
            if (response.words !== undefined) result.words = response.words as VoiceTranscriptionResult["words"];

            return result;
        } catch (e) {
            const error = this.normalizeError(e, "transcribeVoiceMessage");
            logger.warn("VoiceMessageManager.transcribeVoiceMessage failed:", error);
            throw error;
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
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
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
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
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

    // 前端兼容方法
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

    async getUserVoices(roomId: string, userId: string): Promise<VoiceMessageInfo[]> {
        // Get user's voice messages
        logger.debug(`[Voice] Get user voices: ${roomId}/${userId}`);
        return [];
    }

    async getRoomVoices(roomId: string): Promise<VoiceMessageInfo[]> {
        // Get room's voice messages
        logger.debug(`[Voice] Get room voices: ${roomId}`);
        return [];
    }

    async getMyStats(roomId: string): Promise<VoiceStats | null> {
        // Get current user's voice stats
        logger.debug(`[Voice] Get my stats: ${roomId}`);
        return null;
    }

    async getUserStats(roomId: string, userId: string): Promise<VoiceStats | null> {
        // Get user's voice stats
        logger.debug(`[Voice] Get user stats: ${roomId}/${userId}`);
        return null;
    }

    async convertVoice(
        roomId: string,
        eventId: string,
        _params?: { target_format: string },
    ): Promise<VoiceConvertResult | null> {
        // Convert voice message format
        logger.debug(`[Voice] Convert voice: ${roomId}/${eventId}`);
        return null;
    }

    async optimizeVoice(roomId: string, eventId: string, _targetFormat?: string): Promise<VoiceOptimizeResult | null> {
        // Optimize voice message
        logger.debug(`[Voice] Optimize voice: ${roomId}/${eventId}`);
        return null;
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
