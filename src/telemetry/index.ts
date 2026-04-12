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

import { logger } from "../logger";
import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";

export interface TelemetryEvent {
    event: string;
    timestamp: number;
    data?: Record<string, unknown>;
}

export interface TelemetryConfig {
    enabled: boolean;
    endpoint?: string;
    sampleRate?: number;
}

export interface UsageStats {
    messagesSent: number;
    messagesReceived: number;
    roomsJoined: number;
    callsMade: number;
    mediaUploaded: number;
    lastActive: number;
}

export interface ClientMetrics {
    version: string;
    platform: string;
    runtime: string;
    features: string[];
}

export interface TelemetryManagerEvents {
    telemetry_enabled: void;
    telemetry_disabled: void;
    telemetry_flushed: { count: number };
}

export class TelemetryManager extends BaseManager<keyof TelemetryManagerEvents, TelemetryManagerEvents> {
    private config: TelemetryConfig;
    private eventQueue: TelemetryEvent[] = [];
    private sessionStart: number;
    private stats: UsageStats;

    constructor(client: MatrixClient, config?: Partial<TelemetryConfig>) {
        super(client);
        this.config = {
            enabled: config?.enabled || false,
            endpoint: config?.endpoint,
            sampleRate: config?.sampleRate || 1.0,
        };
        this.sessionStart = Date.now();
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            roomsJoined: 0,
            callsMade: 0,
            mediaUploaded: 0,
            lastActive: Date.now(),
        };
    }

    public configure(config: Partial<TelemetryConfig>): void {
        this.config = { ...this.config, ...config };
    }

    public enable(): void {
        this.config.enabled = true;
    }

    public disable(): void {
        this.config.enabled = false;
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    public track(event: string, data?: Record<string, unknown>): void {
        if (!this.config.enabled) return;

        if (Math.random() > (this.config.sampleRate ?? 1.0)) return;

        const telemetryEvent: TelemetryEvent = {
            event,
            timestamp: Date.now(),
            data,
        };

        this.eventQueue.push(telemetryEvent);

        if (this.eventQueue.length >= 10) {
            this.flush();
        }
    }

    public trackMessageSent(roomId: string, type: string): void {
        this.stats.messagesSent++;
        this.stats.lastActive = Date.now();

        this.track("message_sent", {
            room_id: roomId,
            message_type: type,
        });
    }

    public trackMessageReceived(roomId: string, type: string): void {
        this.stats.messagesReceived++;
        this.stats.lastActive = Date.now();

        this.track("message_received", {
            room_id: roomId,
            message_type: type,
        });
    }

    public trackRoomJoined(roomId: string): void {
        this.stats.roomsJoined++;
        this.stats.lastActive = Date.now();

        this.track("room_joined", { room_id: roomId });
    }

    public trackCall(type: "voice" | "video"): void {
        this.stats.callsMade++;
        this.stats.lastActive = Date.now();

        this.track("call_made", { call_type: type });
    }

    public trackMediaUploaded(size: number, type: string): void {
        this.stats.mediaUploaded++;
        this.stats.lastActive = Date.now();

        this.track("media_uploaded", {
            size,
            media_type: type,
        });
    }

    public trackError(error: Error, context?: Record<string, unknown>): void {
        this.track("error", {
            message: error.message,
            stack: error.stack,
            ...context,
        });
    }

    public getClientInfo(): ClientMetrics {
        return {
            version: (this.client as unknown as { version?: string }).version || "unknown",
            platform: this.getPlatform(),
            runtime: this.getRuntime(),
            features: this.getEnabledFeatures(),
        };
    }

    private getPlatform(): string {
        if (typeof window !== "undefined") {
            return "web";
        }
        return "node";
    }

    private getRuntime(): string {
        if (typeof window !== "undefined") {
            return navigator.userAgent;
        }
        return `Node.js ${process.version}`;
    }

    private getEnabledFeatures(): string[] {
        const features: string[] = [];

        if (this.client.getCrypto()) features.push("encryption");
        if (this.client.supportsVoip()) features.push("voip");
        if (this.client.supportsThreads()) features.push("threads");

        return features;
    }

    public getUsageStats(): UsageStats {
        return { ...this.stats };
    }

    public getSessionDuration(): number {
        return Date.now() - this.sessionStart;
    }

    public getPendingEvents(): TelemetryEvent[] {
        return [...this.eventQueue];
    }

    public flush(): void {
        if (this.eventQueue.length === 0) return;

        const events = [...this.eventQueue];
        this.eventQueue = [];

        if (this.config.endpoint) {
            this.sendToServer(events);
        }
    }

    private async sendToServer(events: TelemetryEvent[]): Promise<void> {
        try {
            await fetch(this.config.endpoint!, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    events,
                    client_info: this.getClientInfo(),
                    usage_stats: this.getUsageStats(),
                }),
            });
        } catch (e) {
            logger.warn("TelemetryManager.sendToServer failed:", e);
            this.eventQueue.push(...events);
        }
    }

    public resetStats(): void {
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            roomsJoined: 0,
            callsMade: 0,
            mediaUploaded: 0,
            lastActive: Date.now(),
        };
    }

    public start(): void {}

    public stop(): void {
        this.flush();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getTelemetryManager(config?: Partial<TelemetryConfig>): TelemetryManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTelemetryManager = function (config?: Partial<TelemetryConfig>): TelemetryManager {
        return new TelemetryManager(this, config);
    };
}

export default extendMatrixClient;
