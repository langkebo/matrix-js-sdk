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

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";

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
    inputUrl: string;
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
    confidence: number;
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

export class VoiceMessageManager extends TypedEventEmitter<VoiceEvent, VoiceMessageManagerEventMap> {
    private client: any;
    private config: VoiceConfig;
    private activeSessions: Map<string, { roomId: string; startedAt: number }> = new Map();
    private waveformCache: Map<string, number[]> = new Map();

    constructor(client: any, config?: Partial<VoiceConfig>) {
        super();
        this.client = client;
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
        const actualMimeType = mimeType || (file instanceof Blob ? file.type : 'audio/ogg');

        if (this.config.maxDuration && duration && duration > this.config.maxDuration) {
            throw new Error(`Voice message duration exceeds maximum allowed (${this.config.maxDuration}ms)`);
        }

        try {
            const uploadResult = await this.client.uploadContent(file, {
                name: filename || 'voice-message.ogg',
                type: actualMimeType,
                include_filename: false,
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
                msgtype: 'm.audio',
                body: filename || 'Voice message',
                url: contentUri,
                info: {
                    duration: duration || 0,
                    size: actualSize,
                    mimetype: actualMimeType,
                    waveform: waveform,
                },
                'm.mentions': {},
            };

            const eventResponse = await this.client.sendEvent(roomId, 'm.room.message', messageContent);

            const result: VoiceMessageUploadResult = {
                eventId: eventResponse.event_id,
                url: contentUri,
                duration: duration || 0,
                size: actualSize,
            };

            this.emit(VoiceEvent.UploadComplete, roomId, result);

            return result;
        } catch (error) {
            this.emit(VoiceEvent.UploadError, roomId, error as Error);
            throw error;
        }
    }

    async getVoiceMessageInfo(roomId: string, eventId: string): Promise<VoiceMessageInfo | null> {
        try {
            const event = await this.client.fetchRoomEvent(roomId, eventId);
            
            if (!event || event.type !== 'm.room.message') {
                return null;
            }

            const content = event.content;
            if (content.msgtype !== 'm.audio' && !content.url) {
                return null;
            }

            const info = content.info || {};

            return {
                eventId,
                duration: info.duration || 0,
                waveform: info.waveform,
                mimeType: info.mimetype || 'audio/ogg',
                size: info.size,
            };
        } catch (e) {
            logger.warn('VoiceMessageManager.getVoiceMessageInfo failed:', e);
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
                if (event.getType() === 'm.room.message') {
                    const content = event.getContent();
                    if (content.msgtype === 'm.audio' && content.info) {
                        totalDuration += content.info.duration || 0;
                        totalSize += content.info.size || 0;
                        messageCount++;
                    }
                }
            }

            return { totalDuration, messageCount, totalSize };
        } catch (e) {
            logger.warn('VoiceMessageManager.getVoiceStats failed:', e);
            return { totalDuration: 0, messageCount: 0, totalSize: 0 };
        }
    }

    async convertVoiceMessage(params: VoiceConvertParams): Promise<VoiceConvertResult> {
        const { inputUrl, outputFormat = 'mp3', bitrate = 128 } = params;

        try {
            const response = await this.client.http.authedRequest(
                'POST' as any,
                '/_matrix/client/v3/voice/convert',
                undefined,
                {
                    input_url: inputUrl,
                    output_format: outputFormat,
                    bitrate,
                },
                { prefix: '/_matrix/client/v3' }
            );

            return {
                url: response.url,
                duration: response.duration,
                format: outputFormat,
            };
        } catch (e) {
            logger.warn('VoiceMessageManager.convertVoiceMessage failed:', e);
            throw e;
        }
    }

    async optimizeVoiceMessage(params: VoiceOptimizeParams): Promise<VoiceOptimizeResult> {
        const { inputUrl, quality = 0.8, targetSize } = params;

        try {
            const response = await this.client.http.authedRequest(
                'POST' as any,
                '/_matrix/client/v3/voice/optimize',
                undefined,
                {
                    input_url: inputUrl,
                    quality,
                    target_size: targetSize,
                },
                { prefix: '/_matrix/client/v3' }
            );

            return {
                url: response.url,
                originalSize: response.original_size,
                optimizedSize: response.optimized_size,
                compressionRatio: response.original_size / response.optimized_size,
            };
        } catch (e) {
            logger.warn('VoiceMessageManager.optimizeVoiceMessage failed:', e);
            throw e;
        }
    }

    async transcribeVoiceMessage(params: VoiceTranscriptionParams): Promise<VoiceTranscriptionResult> {
        const { audioUrl, language, model } = params;

        try {
            const response = await this.client.http.authedRequest(
                'POST' as any,
                '/_matrix/client/v3/voice/transcribe',
                undefined,
                {
                    audio_url: audioUrl,
                    language,
                    model,
                },
                { prefix: '/_matrix/client/v3' }
            );

            return {
                text: response.text,
                confidence: response.confidence,
                language: response.language,
                words: response.words,
            };
        } catch (e) {
            logger.warn('VoiceMessageManager.transcribeVoiceMessage failed:', e);
            throw e;
        }
    }

    async downloadVoiceMessage(mxcUrl: string): Promise<Blob> {
        try {
            const httpUrl = this.client.mxcToHttp(mxcUrl);
            const response = await fetch(httpUrl);
            return await response.blob();
        } catch (e) {
            logger.warn('VoiceMessageManager.downloadVoiceMessage failed:', e);
            throw e;
        }
    }

    async getWaveform(mxcUrl: string): Promise<number[]> {
        const cached = this.waveformCache.get(mxcUrl);
        if (cached) {
            return cached;
        }

        try {
            const response = await this.client.http.authedRequest(
                'GET' as any,
                `/_matrix/client/v3/voice/waveform`,
                { url: mxcUrl },
                undefined,
                { prefix: '/_matrix/client/v3' }
            );

            const waveform = response.waveform || [];
            this.waveformCache.set(mxcUrl, waveform);
            
            return waveform;
        } catch (e) {
            logger.warn('VoiceMessageManager.getWaveform failed:', e);
            return [];
        }
    }

    private async generateWaveform(file: File | Blob | ArrayBuffer): Promise<number[]> {
        try {
            const audioContext = new (window as any).AudioContext();
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
            const normalizedWaveform = waveform.map(v => v / max);

            await audioContext.close();

            return normalizedWaveform;
        } catch (e) {
            logger.warn('VoiceMessageManager.generateWaveform failed:', e);
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
            logger.warn('VoiceMessageManager.deleteVoice failed:', e);
            throw e;
        }
    }

    async getVoicePlaybackUrl(mxcUrl: string): Promise<string> {
        try {
            return this.client.mxcToHttp(mxcUrl);
        } catch (e) {
            logger.warn('VoiceMessageManager.getVoicePlaybackUrl failed:', e);
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

    async convertVoice(roomId: string, eventId: string, params?: { target_format: string }): Promise<any> {
        // Convert voice message format
        logger.debug(`[Voice] Convert voice: ${roomId}/${eventId}`);
        return null;
    }

    async optimizeVoice(roomId: string, eventId: string, targetFormat?: string): Promise<any> {
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
        this.emit(VoiceEvent.StateChanged, 'started');
    }

    stop(): void {
        this.activeSessions.clear();
        this.waveformCache.clear();
        this.emit(VoiceEvent.StateChanged, 'stopped');
    }
}
