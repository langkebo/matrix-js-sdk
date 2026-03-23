import { logger } from "../logger"
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * Telemetry Manager - 遥测数据管理
 * 
 * 提供使用统计和遥测功能
 */

export interface TelemetryEvent {
    event: string
    timestamp: number
    data?: Record<string, any>
}

export interface TelemetryConfig {
    enabled: boolean
    endpoint?: string
    sampleRate?: number
}

export interface UsageStats {
    messagesSent: number
    messagesReceived: number
    roomsJoined: number
    callsMade: number
    mediaUploaded: number
    lastActive: number
}

export interface ClientMetrics {
    version: string
    platform: string
    runtime: string
    features: string[]
}

export class TelemetryManager {
    private client: any;
    private config: TelemetryConfig;
    private eventQueue: TelemetryEvent[] = [];
    private sessionStart: number;
    private stats: UsageStats;

    constructor(client: any, config?: Partial<TelemetryConfig>) {
        this.client = client;
        this.config = {
            enabled: config?.enabled || false,
            endpoint: config?.endpoint,
            sampleRate: config?.sampleRate || 1.0
        };
        this.sessionStart = Date.now();
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            roomsJoined: 0,
            callsMade: 0,
            mediaUploaded: 0,
            lastActive: Date.now()
        };
    }

    /**
     * 配置遥测
     */
    configure(config: Partial<TelemetryConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 启用遥测
     */
    enable(): void {
        this.config.enabled = true;
    }

    /**
     * 禁用遥测
     */
    disable(): void {
        this.config.enabled = false;
    }

    /**
     * 检查是否启用
     */
    isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * 跟踪事件
     */
    track(event: string, data?: Record<string, any>): void {
        if (!this.config.enabled) return;

        // 采样检查
        if (Math.random() > (this.config.sampleRate ?? 1.0)) return;

        const telemetryEvent: TelemetryEvent = {
            event,
            timestamp: Date.now(),
            data
        };

        this.eventQueue.push(telemetryEvent);

        // 批量发送
        if (this.eventQueue.length >= 10) {
            this.flush();
        }
    }

    /**
     * 记录消息发送
     */
    trackMessageSent(roomId: string, type: string): void {
        this.stats.messagesSent++;
        this.stats.lastActive = Date.now();
        
        this.track('message_sent', {
            room_id: roomId,
            message_type: type
        });
    }

    /**
     * 记录消息接收
     */
    trackMessageReceived(roomId: string, type: string): void {
        this.stats.messagesReceived++;
        this.stats.lastActive = Date.now();
        
        this.track('message_received', {
            room_id: roomId,
            message_type: type
        });
    }

    /**
     * 记录加入房间
     */
    trackRoomJoined(roomId: string): void {
        this.stats.roomsJoined++;
        this.stats.lastActive = Date.now();
        
        this.track('room_joined', { room_id: roomId });
    }

    /**
     * 记录通话
     */
    trackCall(type: 'voice' | 'video'): void {
        this.stats.callsMade++;
        this.stats.lastActive = Date.now();
        
        this.track('call_made', { call_type: type });
    }

    /**
     * 记录媒体上传
     */
    trackMediaUploaded(size: number, type: string): void {
        this.stats.mediaUploaded++;
        this.stats.lastActive = Date.now();
        
        this.track('media_uploaded', {
            size,
            media_type: type
        });
    }

    /**
     * 记录错误
     */
    trackError(error: Error, context?: Record<string, any>): void {
        this.track('error', {
            message: error.message,
            stack: error.stack,
            ...context
        });
    }

    /**
     * 获取客户端信息
     */
    getClientInfo(): ClientMetrics {
        return {
            version: this.client.version || 'unknown',
            platform: this.getPlatform(),
            runtime: this.getRuntime(),
            features: this.getEnabledFeatures()
        };
    }

    private getPlatform(): string {
        if (typeof window !== 'undefined') {
            return 'web';
        }
        return 'node';
    }

    private getRuntime(): string {
        if (typeof window !== 'undefined') {
            return navigator.userAgent;
        }
        return `Node.js ${process.version}`;
    }

    private getEnabledFeatures(): string[] {
        const features: string[] = [];
        
        if (this.client.isCryptoEnabled?.()) features.push('encryption');
        if (this.client.supportsVoip?.()) features.push('voip');
        if (this.client.supportsThreads?.()) features.push('threads');
        if (this.client.isRoomEncrypted?.()) features.push('e2ee_rooms');
        
        return features;
    }

    /**
     * 获取使用统计
     */
    getUsageStats(): UsageStats {
        return { ...this.stats };
    }

    /**
     * 获取会话时长
     */
    getSessionDuration(): number {
        return Date.now() - this.sessionStart;
    }

    /**
     * 获取待发送的事件
     */
    getPendingEvents(): TelemetryEvent[] {
        return [...this.eventQueue];
    }

    /**
     * 清空事件队列
     */
    flush(): void {
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
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    events,
                    client_info: this.getClientInfo(),
                    usage_stats: this.getUsageStats()
                })
            });
        } catch (e) {
            logger.warn('TelemetryManager.sendToServer failed:', e);
            // 重新加入队列
            this.eventQueue.push(...events);
        }
    }

    /**
     * 重置统计
     */
    resetStats(): void {
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            roomsJoined: 0,
            callsMade: 0,
            mediaUploaded: 0,
            lastActive: Date.now()
        };
    }

    start(): void {}
    stop(): void {
        this.flush();
    }
}
