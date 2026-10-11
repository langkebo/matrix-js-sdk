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
 * Telemetry Manager - 遥测与告警管理 API 封装
 *
 * 提供服务器遥测数据查询、告警管理、系统指标监控等功能
 * 对接后端: synapse-rust/src/web/routes/telemetry.rs
 * API 前缀: /_synapse/admin/v1/telemetry
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getTelemetryManager();
 * // 获取遥测指标
 * const metrics = await manager.getMetrics();
 * // 确认告警
 * await manager.acknowledgeAlert("alert-1");
 * ```
 */
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import type { TelemetryPath } from "./__generated__/route-table";
import { registerManagerFactory, getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";
import type { PathAssert, StripAdminV1 } from "../http-api/strip-prefix";

function tp<const P extends string>(path: P & PathAssert<P, StripAdminV1<TelemetryPath>>): P {
    return path;
}

export interface TelemetryEvent {
    event: string;
    timestamp: number;
    data?: Record<string, unknown>; // Dynamic: client-side event payload
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

export interface ServerTelemetryStatus {
    enabled: boolean;
    trace_enabled: boolean;
    metrics_enabled: boolean;
    service_name: string;
    service_version: string;
    sampling_ratio: number;
    export_config: {
        otlp_endpoint?: string | null;
        prometheus_port?: number | null;
        prometheus_path?: string | null;
        batch_export: boolean;
    };
}

export interface ServerTelemetryAttributes {
    attributes: Record<string, string>;
}

export interface ServerTelemetryMetricsSummary {
    total_metrics: number;
    total_counters: number;
    total_gauges: number;
    total_histograms: number;
    rendered_bytes: number;
    snapshot_ts: number;
}

export interface ServerTelemetryAlert {
    alert_id: string;
    alert_key: string;
    severity: string;
    status: string;
    title?: string;
    message?: string;
    created_at_ms?: number;
    updated_at_ms?: number;
    acknowledged_by?: string | null;
    acknowledged_at_ms?: number | null;
    metadata?: Record<string, unknown>; // Dynamic: alert metadata from backend
}

export interface ServerTelemetryAlertsResponse {
    alerts: ServerTelemetryAlert[];
}

export interface TelemetryCheckResult {
    status: string;
    message: string;
    duration_ms: number;
}

export interface ConnectionPoolTelemetry {
    total_connections: number;
    idle_connections: number;
    busy_connections: number;
    max_connections: number;
    connection_utilization: number;
}

export interface DatabasePerformanceMetrics {
    average_query_time_ms: number;
    slow_queries_count: number;
    total_queries: number;
    transactions_per_second: number;
    cache_hit_ratio: number;
    deadlock_count: number;
    redis_latency_ms: number;
    redis_slow_commands_count: number;
}

export interface DatabaseTelemetry {
    is_healthy: boolean;
    connection_pool_status: ConnectionPoolTelemetry;
    performance_metrics: DatabasePerformanceMetrics;
    last_checked: string;
}

export interface ServerTelemetryHealth {
    status: string;
    service: string;
    trace_enabled: boolean;
    metrics_enabled: boolean;
    checks: Record<string, TelemetryCheckResult>;
    database: DatabaseTelemetry;
    alerts: ServerTelemetryAlert[];
}

export interface ServerTelemetryAlertQuery {
    status?: string;
    severity?: string;
    refresh?: boolean;
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

    constructor(client: MatrixClient, config?: Partial<TelemetryConfig>, opts?: ManagerOpts) {
        super(client, opts);
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

    /**
     * 合并更新遥测配置。
     *
     * @param config - 需要覆盖的配置片段
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().configure({ enabled: true, sampleRate: 0.5 });
     * ```
     */
    public configure(config: Partial<TelemetryConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 启用遥测上报。
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().enable();
     * ```
     */
    public enable(): void {
        this.config.enabled = true;
    }

    /**
     * 关闭遥测上报。
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().disable();
     * ```
     */
    public disable(): void {
        this.config.enabled = false;
    }

    /**
     * 判断遥测当前是否已启用。
     *
     * @returns 启用返回 true，否则返回 false
     *
     * @example
     * ```typescript
     * if (client.getTelemetryManager().isEnabled()) {
     *     console.log("telemetry is on");
     * }
     * ```
     */
    public isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * 上报一个自定义遥测事件；未启用或未命中采样率时会被忽略。
     *
     * @param event - 事件名
     * @param data - 事件附带的任意数据
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().track("button_click", { button: "send" });
     * ```
     */
    public track(event: string, data?: Record<string, unknown> /* Dynamic: arbitrary event payload */): void {
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

    /**
     * 记录一条已发送的消息。
     *
     * @param roomId - 消息所在房间 ID
     * @param type - 消息类型（如 "m.text"）
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackMessageSent("!room:example.org", "m.text");
     * ```
     */
    public trackMessageSent(roomId: string, type: string): void {
        this.stats.messagesSent++;
        this.stats.lastActive = Date.now();

        this.track("message_sent", {
            room_id: roomId,
            message_type: type,
        });
    }

    /**
     * 记录一条已接收的消息。
     *
     * @param roomId - 消息所在房间 ID
     * @param type - 消息类型（如 "m.text"）
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackMessageReceived("!room:example.org", "m.text");
     * ```
     */
    public trackMessageReceived(roomId: string, type: string): void {
        this.stats.messagesReceived++;
        this.stats.lastActive = Date.now();

        this.track("message_received", {
            room_id: roomId,
            message_type: type,
        });
    }

    /**
     * 记录一次加入房间事件。
     *
     * @param roomId - 加入的房间 ID
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackRoomJoined("!room:example.org");
     * ```
     */
    public trackRoomJoined(roomId: string): void {
        this.stats.roomsJoined++;
        this.stats.lastActive = Date.now();

        this.track("room_joined", { room_id: roomId });
    }

    /**
     * 记录一次通话事件。
     *
     * @param type - 通话类型，语音或视频
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackCall("video");
     * ```
     */
    public trackCall(type: "voice" | "video"): void {
        this.stats.callsMade++;
        this.stats.lastActive = Date.now();

        this.track("call_made", { call_type: type });
    }

    /**
     * 记录一次媒体上传事件。
     *
     * @param size - 上传字节数
     * @param type - 媒体 MIME 类型
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackMediaUploaded(1024, "image/png");
     * ```
     */
    public trackMediaUploaded(size: number, type: string): void {
        this.stats.mediaUploaded++;
        this.stats.lastActive = Date.now();

        this.track("media_uploaded", {
            size,
            media_type: type,
        });
    }

    /**
     * 记录一个错误事件。
     *
     * @param error - 需要上报的错误对象
     * @param context - 附加上下文数据
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackError(new Error("boom"), { feature: "upload" });
     * ```
     */
    public trackError(error: Error, context?: Record<string, unknown> /* Dynamic: arbitrary error context */): void {
        this.track("error", {
            message: error.message,
            stack: error.stack,
            ...context,
        });
    }

    /**
     * 获取客户端信息（版本、平台、运行时与已启用特性）。
     *
     * @returns 客户端信息对象
     *
     * @example
     * ```typescript
     * const info = client.getTelemetryManager().getClientInfo();
     * console.log(info.platform, info.runtime);
     * ```
     */
    public getClientInfo(): ClientMetrics {
        return {
            version: this.client.version || "unknown",
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

    /**
     * 获取当前使用统计的快照。
     *
     * @returns 使用统计副本
     *
     * @example
     * ```typescript
     * const stats = client.getTelemetryManager().getUsageStats();
     * console.log(stats.messagesSent, stats.roomsJoined);
     * ```
     */
    public getUsageStats(): UsageStats {
        return { ...this.stats };
    }

    // ===== Performance Metrics (扩展 getMetrics 功能) =====

    /**
     * 记录一次缓存命中/未命中事件。
     *
     * @param cacheName - 缓存名称
     * @param hit - 是否命中
     * @param duration - 可选，耗时（毫秒）
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackCacheHitMiss("rooms", true, 3);
     * ```
     */
    public trackCacheHitMiss(cacheName: string, hit: boolean, duration?: number): void {
        if (!this.config.enabled) return;

        const key = `cache_${cacheName}`;
        const data: Record<string, unknown> = { hit };
        if (duration !== undefined) {
            data.duration_ms = duration;
        }

        this.track(key, data);
    }

    /**
     * 记录一次请求耗时；超过 200ms 时会额外上报慢请求事件。
     *
     * @param method - HTTP 方法
     * @param durationMs - 耗时（毫秒）
     * @param status - 请求结果状态
     * @param endpoint - 可选，请求端点
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackRequestTiming("GET", 120, "success", "/sync");
     * ```
     */
    public trackRequestTiming(
        method: string,
        durationMs: number,
        status: "success" | "failure",
        endpoint?: string,
    ): void {
        if (!this.config.enabled) return;

        this.track("request_timing", {
            method,
            duration_ms: durationMs,
            status,
            ...(endpoint ? { endpoint } : {}),
        });

        // 监控慢请求 (> 200ms)
        if (durationMs > 200) {
            this.track("slow_request", {
                method,
                duration_ms: durationMs,
                endpoint,
            });
        }
    }

    /**
     * 记录一个性能基线指标。
     *
     * @param metric - 指标名
     * @param value - 指标取值
     * @param threshold - 可选，阈值；提供时会附带是否达标
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().trackPerformanceBaseline("sync_latency_ms", 150, 200);
     * ```
     */
    public trackPerformanceBaseline(metric: string, value: number, threshold?: number): void {
        if (!this.config.enabled) return;

        this.track("performance_baseline", {
            metric,
            value,
            ...(threshold ? { threshold, passed: value <= threshold } : {}),
        });
    }

    /**
     * 获取服务器遥测健康状态。
     *
     * @returns 服务器健康信息
     *
     * @example
     * ```typescript
     * const health = await client.getTelemetryManager().getServerHealth();
     * console.log(health.status);
     * ```
     */
    public async getServerHealth(): Promise<ServerTelemetryHealth> {
        return this.adminRequest(Method.Get, tp("/telemetry/health"));
    }

    /**
     * 获取待上报事件队列的快照。
     *
     * @returns 事件队列副本
     *
     * @example
     * ```typescript
     * const pending = client.getTelemetryManager().getPendingEvents();
     * console.log(pending.length);
     * ```
     */
    public getPendingEvents(): TelemetryEvent[] {
        return [...this.eventQueue];
    }

    /**
     * 获取当前会话已持续的时长。
     *
     * @returns 会话时长（毫秒）
     *
     * @example
     * ```typescript
     * const ms = client.getTelemetryManager().getSessionDuration();
     * ```
     */
    public getSessionDuration(): number {
        return Date.now() - this.sessionStart;
    }

    /**
     * 获取服务器遥测状态。
     *
     * @returns 服务器遥测状态
     *
     * @example
     * ```typescript
     * const status = await client.getTelemetryManager().getServerStatus();
     * console.log(status.enabled);
     * ```
     */
    public async getServerStatus(): Promise<ServerTelemetryStatus> {
        return this.adminRequest(Method.Get, tp("/telemetry/status"));
    }

    /**
     * 获取服务器遥测属性。
     *
     * @returns 服务器遥测属性集合
     *
     * @example
     * ```typescript
     * const attrs = await client.getTelemetryManager().getServerAttributes();
     * ```
     */
    public async getServerAttributes(): Promise<ServerTelemetryAttributes> {
        return this.adminRequest(Method.Get, tp("/telemetry/attributes"));
    }

    /**
     * 获取服务器指标摘要。
     *
     * @returns 指标摘要
     *
     * @example
     * ```typescript
     * const summary = await client.getTelemetryManager().getServerMetricsSummary();
     * console.log(summary.total_metrics);
     * ```
     */
    public async getServerMetricsSummary(): Promise<ServerTelemetryMetricsSummary> {
        return this.adminRequest(Method.Get, tp("/telemetry/metrics"));
    }

    /**
     * 查询服务器告警列表。
     *
     * @param query - 可选，按状态/严重级别过滤并控制是否刷新
     * @returns 告警列表响应
     *
     * @example
     * ```typescript
     * const { alerts } = await client.getTelemetryManager().getServerAlerts({ severity: "warning", refresh: true });
     * ```
     */
    public async getServerAlerts(query?: ServerTelemetryAlertQuery): Promise<ServerTelemetryAlertsResponse> {
        const queryParams: Record<string, string> = {};
        if (query?.status) queryParams.status = query.status;
        if (query?.severity) queryParams.severity = query.severity;
        if (typeof query?.refresh === "boolean") queryParams.refresh = String(query.refresh);
        return this.adminRequest(
            Method.Get,
            tp("/telemetry/alerts"),
            Object.keys(queryParams).length > 0 ? queryParams : undefined,
        );
    }

    /**
     * 确认一条服务器告警。
     *
     * @param alertId - 需要确认的告警 ID
     * @returns 更新后的告警
     *
     * @throws {ValidationError} 当 alertId 为空时
     *
     * @example
     * ```typescript
     * await client.getTelemetryManager().acknowledgeServerAlert("alert-1");
     * ```
     */
    public async acknowledgeServerAlert(alertId: string): Promise<ServerTelemetryAlert> {
        if (!alertId) {
            throw new ValidationError("Alert ID is required");
        }
        return this.adminRequest(Method.Post, tp(`/telemetry/alerts/${encodeURIComponent(alertId)}/ack`));
    }

    /**
     * 将当前缓存的事件立即上报。
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().flush();
     * ```
     */
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

    /**
     * 重置使用统计。
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().resetStats();
     * ```
     */
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

    /**
     * 停止遥测并刷新剩余事件。
     *
     * @example
     * ```typescript
     * client.getTelemetryManager().stop();
     * ```
     */
    public stop(): void {
        this.flush();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTelemetryManager = function (config?: Partial<TelemetryConfig>): TelemetryManager {
        registerManagerFactory("telemetry", (client) => new TelemetryManager(client));
        return getOrCreateManager(this, "telemetry", () => new TelemetryManager(this, config));
    };
}
