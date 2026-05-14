import { logger } from "../logger";
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
 * Widget Manager - 小组件管理
 *
 * 提供小组件的创建、管理、权限验证功能
 * 对接后端: synapse-rust/src/services/widget_service.rs
 */

import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { InvalidParamError } from "../common/errors";
import type { WidgetPathPattern } from "./__generated__/route-table";

export enum WidgetEvent {
    WidgetAdded = "WidgetAdded",
    WidgetRemoved = "WidgetRemoved",
    WidgetUpdated = "WidgetUpdated",
    WidgetError = "WidgetError",
    PermissionRequested = "PermissionRequested",
    PermissionGranted = "PermissionGranted",
    PermissionDenied = "PermissionDenied",
}

export interface IWidget {
    id: string;
    type: string;
    name: string;
    url: string;
    data?: Record<string, unknown>;
    creatorUserId?: string;
    roomId?: string;
}

export interface IWidgetPermission {
    widgetId: string;
    roomId: string;
    permissions: string[];
    granted: boolean;
    grantedAt?: number;
}

export interface IWidgetCapabilities {
    capabilities: string[];
}

export interface WidgetOpenURLOptions {
    useIframe?: boolean;
    width?: number;
    height?: number;
    title?: string;
}

export interface WidgetMessage {
    type?: string;
    content?: Record<string, unknown>;
    api?: string;
    action?: string;
    data?: Record<string, unknown>;
    requestId?: string;
}

export interface WidgetMessageResponse {
    requestId: string;
    eventId?: string;
    widgetId?: string;
    roomId?: string;
    type?: string;
    content?: Record<string, unknown>;
    response?: Record<string, unknown>;
    error?: {
        message: string;
        code?: string;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// v1 REST API types (对接 synapse-rust/src/web/routes/widget.rs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Backend widget API response structure
 * GET /_matrix/client/v1/rooms/{room_id}/widgets
 * POST /_matrix/client/v1/widgets
 * GET /_matrix/client/v1/widgets/{widget_id}
 */
export interface WidgetApiData {
    id?: number;
    widget_id: string;
    room_id: string | null;
    user_id: string;
    /** e.g. "customwidget", "jitsi" */
    widget_type: string;
    url: string;
    name: string;
    data: Record<string, unknown>;
    is_active: boolean;
    created_ts?: number;
    updated_ts?: number | null;
}

export interface WidgetApiResponse {
    widget: WidgetApiData;
}

export interface WidgetListApiResponse {
    widgets: WidgetApiData[];
    total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// v1 REST API types for config
// ─────────────────────────────────────────────────────────────────────────────

export interface WidgetConfigResponse {
    widget_id: string;
    room_id: string | null;
    url: string;
    name: string;
    data: Record<string, unknown>;
    type: string;
}

export interface JitsiConfigResponse {
    conf_id: string;
    name: string;
    domain: string;
    app_id: string | null;
    jwt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// v1 REST API types for permissions
// ─────────────────────────────────────────────────────────────────────────────

export interface SetPermissionRequest {
    user_id: string;
    permissions: string[];
}

export interface SetPermissionResponse {
    success: boolean;
    permission_id: number;
}

export interface WidgetPermissionItem {
    id: number;
    user_id: string;
    widget_id: string;
    permissions: string[];
    created_ts?: number;
    updated_ts?: number | null;
}

export interface WidgetPermissionsResponse {
    permissions: WidgetPermissionItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// v1 REST API types for sessions
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSessionRequest {
    widget_id: string;
    device_id?: string;
    expires_in_ms?: number;
}

export interface SessionApiData {
    id?: number;
    session_id: string;
    widget_id: string;
    user_id: string;
    device_id: string | null;
    expires_at: number;
    created_ts?: number;
    last_active_ts?: number;
    is_active?: boolean;
}

export interface SessionResponse {
    session: SessionApiData;
}

export interface SessionListResponse {
    sessions: SessionApiData[];
    total: number;
}

export interface CreateWidgetOptions {
    roomId?: string;
    type: string;
    url: string;
    name: string;
    data?: Record<string, unknown>;
}

export interface UpdateWidgetOptions {
    url?: string;
    name?: string;
    data?: Record<string, unknown>;
}

export interface WidgetSession {
    id?: number;
    session_id: string;
    widget_id: string;
    user_id: string;
    device_id: string | null;
    expires_at: number;
    created_ts?: number;
    last_active_ts?: number;
    is_active?: boolean;
}

export interface WidgetSessionResponse {
    session: SessionApiData;
}

export interface WidgetSessionListResponse {
    sessions: SessionApiData[];
    total: number;
}

interface WidgetManagerEventMap {
    [WidgetEvent.WidgetAdded]: (roomId: string, widget: IWidget) => void;
    [WidgetEvent.WidgetRemoved]: (roomId: string, widgetId: string) => void;
    [WidgetEvent.WidgetUpdated]: (roomId: string, widget: IWidget) => void;
    [WidgetEvent.WidgetError]: (roomId: string | undefined, widgetId: string | undefined, error: Error) => void;
    [WidgetEvent.PermissionRequested]: (widgetId: string, permissions: string[]) => void;
    [WidgetEvent.PermissionGranted]: (widgetId: string, permissions: string[]) => void;
    [WidgetEvent.PermissionDenied]: (widgetId: string, permissions: string[]) => void;
}

type StripWidgetPrefix<P extends string> =
    P extends `/_matrix/client/v1${infer Rest}`
        ? Rest
        : P extends `/_matrix/client/v3${infer Rest}`
          ? Rest
          : never;

function wp<P extends StripWidgetPrefix<WidgetPathPattern>>(path: P): P {
    return path;
}

export class WidgetManager extends BaseManager<WidgetEvent, WidgetManagerEventMap> {
    private widgets: Map<string, Map<string, IWidget>> = new Map();
    private permissions: Map<string, IWidgetPermission> = new Map();
    private pendingRequests: Map<string, (response: WidgetMessageResponse) => void> = new Map();

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 将后端 WidgetApiData 转换为 IWidget
     */
    private toIWidget(data: WidgetApiData, roomId?: string): IWidget {
        return {
            id: data.widget_id,
            type: data.widget_type,
            name: data.name,
            url: data.url,
            data: data.data,
            creatorUserId: data.user_id,
            roomId: roomId ?? data.room_id ?? undefined,
        };
    }

    private emitWidgetRequestError(roomId: string | undefined, widgetId: string | undefined, error: Error): void {
        this.emit(WidgetEvent.WidgetError, roomId, widgetId, error);
    }

    private toCreateWidgetBody(options: CreateWidgetOptions, widgetId?: string): Record<string, unknown> {
        return {
            room_id: options.roomId,
            widget_id: widgetId,
            widget_type: options.type,
            url: options.url,
            name: options.name,
            data: options.data ?? {},
        };
    }

    private normalizeWidgetMessage(message: WidgetMessage): { type: string; content: Record<string, unknown> } {
        const type = message.type ?? message.action ?? message.api;
        if (!type) {
            throw new InvalidParamError("Widget message type is required");
        }

        if (message.content) {
            return {
                type,
                content: message.content,
            };
        }

        if (message.data) {
            return {
                type,
                content: message.api ? { api: message.api, ...message.data } : message.data,
            };
        }

        return {
            type,
            content: message.api ? { api: message.api } : {},
        };
    }

    /**
     * 获取房间的小组件列表
     * GET /_matrix/client/v1/rooms/{room_id}/widgets
     *
     * 对接后端 REST API，不再从 room state events 读取
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为空列表）
     * @returns 房间小组件列表
     */
    async getRoomWidgets(roomId: string, throwOnError = true): Promise<IWidget[]> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        // 优先从缓存返回
        if (this.widgets.has(roomId)) {
            return Array.from(this.widgets.get(roomId)!.values());
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<WidgetListApiResponse>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/widgets`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "getRoomWidgets");

            const widgets: IWidget[] = (response.widgets ?? []).map((w) => this.toIWidget(w, roomId));

            this.widgets.set(roomId, new Map());
            widgets.forEach((w) => this.widgets.get(roomId)!.set(w.id, w));

            return widgets;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getRoomWidgets");
            this.emitWidgetRequestError(roomId, undefined, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn("WidgetManager.getRoomWidgets failed:", error);
            return [];
        }
    }

    /**
     * 获取单个小组件
     * GET /_matrix/client/v1/widgets/{widget_id}
     *
     * @param widgetId - 小组件 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 null）
     * @returns 小组件详情
     */
    async getWidget(widgetId: string, throwOnError = true): Promise<IWidget | null> {
        if (!widgetId) {
            throw new InvalidParamError("Widget ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<WidgetApiResponse>(
                    Method.Get,
                    `/widgets/${encodeURIComponent(widgetId)}`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "getWidget");

            return this.toIWidget(response.widget);
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getWidget");
            this.emitWidgetRequestError(undefined, widgetId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.getWidget failed for ${widgetId}:`, error);
            return null;
        }
    }

    /**
     * 创建小组件
     * POST /_matrix/client/v1/widgets
     *
     * @param roomId - 房间 ID（可选，不传则创建全局小组件）
     * @param widget - 小组件配置
     * @returns 创建的小组件
     */
    async addWidget(roomId: string, widget: Omit<IWidget, "roomId">): Promise<IWidget> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        const widgetId = widget.id || `widget_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<WidgetApiResponse>(
                    Method.Post,
                    wp("/widgets"),
                    undefined,
                    this.toCreateWidgetBody(
                        {
                            roomId,
                            type: widget.type,
                            url: widget.url,
                            name: widget.name,
                            data: widget.data,
                        },
                        widgetId,
                    ),
                    { prefix: "/_matrix/client/v1" },
                );
            }, "addWidget");

            const newWidget = this.toIWidget(response.widget, roomId);

            if (!this.widgets.has(roomId)) {
                this.widgets.set(roomId, new Map());
            }
            this.widgets.get(roomId)!.set(newWidget.id, newWidget);

            this.emit(WidgetEvent.WidgetAdded, roomId, newWidget);

            return newWidget;
        } catch (e) {
            const error = this.normalizeError(e, "addWidget");
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error);
            throw error;
        }
    }

    async createWidget(options: CreateWidgetOptions): Promise<IWidget> {
        if (!options.type) {
            throw new InvalidParamError("Widget type is required");
        }
        if (!options.url) {
            throw new InvalidParamError("Widget URL is required");
        }
        if (!options.name) {
            throw new InvalidParamError("Widget name is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<WidgetApiResponse>(
                    Method.Post,
                    wp("/widgets/create"),
                    undefined,
                    this.toCreateWidgetBody(options),
                    { prefix: ClientPrefix.V3 },
                );
            }, "createWidget");

            const widget = this.toIWidget(response.widget, options.roomId);
            if (options.roomId) {
                if (!this.widgets.has(options.roomId)) {
                    this.widgets.set(options.roomId, new Map());
                }
                this.widgets.get(options.roomId)!.set(widget.id, widget);
                this.emit(WidgetEvent.WidgetAdded, options.roomId, widget);
            } else {
                this.emit(WidgetEvent.WidgetAdded, widget.roomId ?? "", widget);
            }

            return widget;
        } catch (e) {
            const error = this.normalizeError(e, "createWidget");
            this.emit(WidgetEvent.WidgetError, options.roomId, undefined, error);
            throw error;
        }
    }

    async removeWidget(roomId: string, widgetId: string): Promise<void> {
        if (!roomId || !widgetId) {
            throw new InvalidParamError("Room ID and Widget ID are required");
        }

        try {
            // DELETE /_matrix/client/v1/widgets/{widget_id}
            await this.withRetry(async () => {
                await this.client.http.authedRequest(
                    Method.Delete,
                    `/widgets/${encodeURIComponent(widgetId)}`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "removeWidget");

            if (this.widgets.has(roomId)) {
                this.widgets.get(roomId)!.delete(widgetId);
            }

            this.emit(WidgetEvent.WidgetRemoved, roomId, widgetId);
        } catch (e) {
            const error = this.normalizeError(e, "removeWidget");
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error);
            throw error;
        }
    }

    async updateWidget(roomId: string, widgetId: string, updates: Partial<IWidget>): Promise<IWidget> {
        if (!roomId || !widgetId) {
            throw new InvalidParamError("Room ID and Widget ID are required");
        }

        const existingWidgets = this.widgets.get(roomId);
        if (!existingWidgets || !existingWidgets.has(widgetId)) {
            throw new Error(`Widget ${widgetId} not found in room ${roomId}`);
        }

        const existingWidget = existingWidgets.get(widgetId)!;
        const updatedWidget: IWidget = {
            ...existingWidget,
            ...updates,
            id: widgetId,
            roomId,
        };

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<WidgetApiResponse>(
                    Method.Put,
                    `/widgets/${encodeURIComponent(widgetId)}`,
                    undefined,
                    {
                        url: updatedWidget.url,
                        name: updatedWidget.name,
                        data: updatedWidget.data,
                    },
                    { prefix: "/_matrix/client/v1" },
                );
            }, "updateWidget");

            const finalWidget = this.toIWidget(response.widget, roomId);

            this.widgets.get(roomId)!.set(widgetId, finalWidget);
            this.emit(WidgetEvent.WidgetUpdated, roomId, finalWidget);

            return finalWidget;
        } catch (e) {
            const error = this.normalizeError(e, "updateWidget");
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error);
            throw error;
        }
    }

    /**
     * Get a widget by room and widget ID
     * First checks cache, then fetches from backend
     */
    async getWidgetById(roomId: string, widgetId: string): Promise<IWidget | null> {
        const roomWidgets = this.widgets.get(roomId);
        if (roomWidgets && roomWidgets.has(widgetId)) {
            return roomWidgets.get(widgetId) || null;
        }

        await this.getRoomWidgets(roomId);

        const widgets = this.widgets.get(roomId);
        return widgets?.get(widgetId) || null;
    }

    async checkWidgetPermission(roomId: string, widgetId: string, permissions: string[]): Promise<boolean> {
        const permissionKey = `${roomId}:${widgetId}`;
        const existing = this.permissions.get(permissionKey);

        if (existing && existing.granted) {
            const hasAll = permissions.every((p) => existing.permissions.includes(p));
            if (hasAll) {
                return true;
            }
        }

        this.emit(WidgetEvent.PermissionRequested, widgetId, permissions);

        return false;
    }

    async grantWidgetPermission(roomId: string, widgetId: string, permissions: string[]): Promise<void> {
        const permissionKey = `${roomId}:${widgetId}`;

        const permission: IWidgetPermission = {
            widgetId,
            roomId,
            permissions,
            granted: true,
            grantedAt: Date.now(),
        };

        this.permissions.set(permissionKey, permission);
        this.emit(WidgetEvent.PermissionGranted, widgetId, permissions);
    }

    async denyWidgetPermission(roomId: string, widgetId: string, permissions: string[]): Promise<void> {
        const permissionKey = `${roomId}:${widgetId}`;

        const permission: IWidgetPermission = {
            widgetId,
            roomId,
            permissions,
            granted: false,
        };

        this.permissions.set(permissionKey, permission);
        this.emit(WidgetEvent.PermissionDenied, widgetId, permissions);
    }

    async getWidgetCapabilities(roomId: string, widgetId: string): Promise<IWidgetCapabilities> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ capabilities?: string[] }>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getWidgetCapabilities");

            return {
                capabilities: response.capabilities || [],
            };
        } catch (e) {
            const error = this.normalizeError(e, "getWidgetCapabilities");
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error);
            throw error;
        }
    }

    async setWidgetCapabilities(
        roomId: string,
        widgetId: string,
        capabilities: string[],
    ): Promise<IWidgetCapabilities> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ capabilities?: string[] }>(
                    Method.Put,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`,
                    undefined,
                    { capabilities },
                    { prefix: ClientPrefix.V3 },
                );
            }, "setWidgetCapabilities");

            return {
                capabilities: response.capabilities || [],
            };
        } catch (e) {
            const error = this.normalizeError(e, "setWidgetCapabilities");
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error);
            throw error;
        }
    }

    async sendWidgetMessage(roomId: string, widgetId: string, message: WidgetMessage): Promise<WidgetMessageResponse> {
        const requestId = message.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const normalizedMessage = this.normalizeWidgetMessage(message);

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{
                    event_id?: string;
                    widget_id?: string;
                    room_id?: string;
                    type?: string;
                    content?: Record<string, unknown>;
                }>(
                    Method.Post,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/send`,
                    undefined,
                    normalizedMessage,
                    { prefix: ClientPrefix.V3 },
                );
            }, "sendWidgetMessage");

            return {
                requestId,
                eventId: response.event_id,
                widgetId: response.widget_id,
                roomId: response.room_id,
                type: response.type,
                content: response.content,
                response,
            };
        } catch (e: unknown) {
            const error = this.normalizeError(e, "sendWidgetMessage");
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error);
            throw error;
        }
    }

    async navigateWidget(roomId: string, widgetId: string, url: string): Promise<void> {
        await this.sendWidgetMessage(roomId, widgetId, {
            type: "navigate",
            content: { url },
        });
    }

    async openWidgetURL(roomId: string, widgetId: string, options?: WidgetOpenURLOptions): Promise<void> {
        const widget = await this.getWidgetById(roomId, widgetId);
        if (!widget) {
            throw new Error(`Widget ${widgetId} not found`);
        }

        if (options?.useIframe) {
            const iframe = document.createElement("iframe");
            iframe.src = widget.url;
            iframe.width = String(options.width || 400);
            iframe.height = String(options.height || 300);
            iframe.title = options.title || widget.name;
            document.body.appendChild(iframe);
        } else {
            window.open(widget.url, "_blank", "noopener,noreferrer");
        }
    }

    /**
     * 获取小组件配置
     * GET /_matrix/client/v1/widgets/{widget_id}/config
     *
     * @param widgetId - 小组件 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 null）
     * @returns 小组件配置信息
     */
    async getWidgetConfig(widgetId: string, throwOnError = true): Promise<WidgetConfigResponse | null> {
        if (!widgetId) {
            throw new InvalidParamError("Widget ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<WidgetConfigResponse>(
                    Method.Get,
                    `/widgets/${encodeURIComponent(widgetId)}/config`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "getWidgetConfig");

            return response;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getWidgetConfig");
            this.emitWidgetRequestError(undefined, widgetId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.getWidgetConfig failed for ${widgetId}:`, error);
            return null;
        }
    }

    /**
     * 获取 Jitsi 视频会议配置
     * GET /_matrix/client/v1/rooms/{room_id}/widgets/jitsi/config
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 null）
     * @returns Jitsi 会议配置
     */
    async getJitsiConfig(roomId: string, throwOnError = true): Promise<JitsiConfigResponse | null> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<JitsiConfigResponse>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/jitsi/config`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "getJitsiConfig");

            return response;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getJitsiConfig");
            this.emitWidgetRequestError(roomId, "jitsi", error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.getJitsiConfig failed for room ${roomId}:`, error);
            return null;
        }
    }

    /**
     * 获取小组件的所有权限列表
     * GET /_matrix/client/v1/widgets/{widget_id}/permissions
     *
     * @param widgetId - 小组件 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 null）
     * @returns 权限列表
     */
    async getWidgetPermissions(widgetId: string, throwOnError = true): Promise<WidgetPermissionsResponse | null> {
        if (!widgetId) {
            throw new InvalidParamError("Widget ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<WidgetPermissionsResponse>(
                    Method.Get,
                    `/widgets/${encodeURIComponent(widgetId)}/permissions`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "getWidgetPermissions");

            return response;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getWidgetPermissions");
            this.emitWidgetRequestError(undefined, widgetId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.getWidgetPermissions failed for ${widgetId}:`, error);
            return null;
        }
    }

    /**
     * 设置小组件权限
     * POST /_matrix/client/v1/widgets/{widget_id}/permissions
     *
     * @param widgetId - 小组件 ID
     * @param userId - 用户 ID
     * @param permissions - 权限列表
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 null）
     * @returns 设置结果
     */
    async setWidgetPermission(
        widgetId: string,
        userId: string,
        permissions: string[],
        throwOnError = true,
    ): Promise<SetPermissionResponse | null> {
        if (!widgetId) {
            throw new InvalidParamError("Widget ID is required");
        }

        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<SetPermissionResponse>(
                    Method.Post,
                    `/widgets/${encodeURIComponent(widgetId)}/permissions`,
                    undefined,
                    {
                        user_id: userId,
                        permissions,
                    },
                    { prefix: "/_matrix/client/v1" },
                );
            }, "setWidgetPermission");

            return response;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "setWidgetPermission");
            this.emitWidgetRequestError(undefined, widgetId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.setWidgetPermission failed for ${widgetId}:`, error);
            return null;
        }
    }

    /**
     * 删除小组件权限
     * DELETE /_matrix/client/v1/widgets/{widget_id}/permissions/{user_id}
     *
     * @param widgetId - 小组件 ID
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 false）
     * @returns 删除结果
     */
    async deleteWidgetPermission(widgetId: string, userId: string, throwOnError = true): Promise<boolean> {
        if (!widgetId) {
            throw new InvalidParamError("Widget ID is required");
        }

        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ deleted: boolean }>(
                    Method.Delete,
                    `/widgets/${encodeURIComponent(widgetId)}/permissions/${encodeURIComponent(userId)}`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "deleteWidgetPermission");

            return response.deleted ?? false;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "deleteWidgetPermission");
            this.emitWidgetRequestError(undefined, widgetId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.deleteWidgetPermission failed for ${widgetId}:`, error);
            return false;
        }
    }

    /**
     * 创建小组件会话
     * POST /_matrix/client/v1/widgets/{widget_id}/sessions
     *
     * @param widgetId - 小组件 ID
     * @param options - 会话选项（可选）
     * @param options.deviceId - 设备 ID（可选）
     * @param options.expiresInMs - 过期时间（毫秒，可选）
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 null）
     * @returns 创建的会话信息
     */
    async createWidgetSession(
        widgetId: string,
        options?: { deviceId?: string; expiresInMs?: number },
        throwOnError = true,
    ): Promise<SessionApiData | null> {
        if (!widgetId) {
            throw new InvalidParamError("Widget ID is required");
        }

        try {
            const body: CreateSessionRequest = {
                widget_id: widgetId,
            };

            if (options?.deviceId !== undefined) {
                body.device_id = options.deviceId;
            }

            if (options?.expiresInMs !== undefined) {
                body.expires_in_ms = options.expiresInMs;
            }

            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<SessionResponse>(
                    Method.Post,
                    `/widgets/${encodeURIComponent(widgetId)}/sessions`,
                    undefined,
                    body,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "createWidgetSession");

            return response.session;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "createWidgetSession");
            this.emitWidgetRequestError(undefined, widgetId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.createWidgetSession failed for ${widgetId}:`, error);
            return null;
        }
    }

    /**
     * 获取小组件的所有会话列表
     * GET /_matrix/client/v1/widgets/{widget_id}/sessions
     *
     * @param widgetId - 小组件 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为空列表）
     * @returns 会话列表
     */
    async getWidgetSessions(widgetId: string, throwOnError = true): Promise<SessionApiData[]> {
        if (!widgetId) {
            throw new InvalidParamError("Widget ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<SessionListResponse>(
                    Method.Get,
                    `/widgets/${encodeURIComponent(widgetId)}/sessions`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "getWidgetSessions");

            return response.sessions ?? [];
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getWidgetSessions");
            this.emitWidgetRequestError(undefined, widgetId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.getWidgetSessions failed for ${widgetId}:`, error);
            return [];
        }
    }

    /**
     * 获取单个小组件会话
     * GET /_matrix/client/v1/widgets/sessions/{session_id}
     *
     * @param sessionId - 会话 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 null）
     * @returns 会话详情
     */
    async getWidgetSession(sessionId: string, throwOnError = true): Promise<SessionApiData | null> {
        if (!sessionId) {
            throw new InvalidParamError("Session ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<SessionResponse>(
                    Method.Get,
                    `/widgets/sessions/${encodeURIComponent(sessionId)}`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "getWidgetSession");

            return response.session;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "getWidgetSession");
            this.emitWidgetRequestError(undefined, sessionId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.getWidgetSession failed for ${sessionId}:`, error);
            return null;
        }
    }

    /**
     * 终止小组件会话
     * DELETE /_matrix/client/v1/widgets/sessions/{session_id}
     *
     * @param sessionId - 会话 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时回退为 false）
     * @returns 是否成功终止
     */
    async terminateWidgetSession(sessionId: string, throwOnError = true): Promise<boolean> {
        if (!sessionId) {
            throw new InvalidParamError("Session ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ terminated: boolean }>(
                    Method.Delete,
                    `/widgets/sessions/${encodeURIComponent(sessionId)}`,
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v1" },
                );
            }, "terminateWidgetSession");

            return response.terminated ?? false;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            const error = this.normalizeError(e, "terminateWidgetSession");
            this.emitWidgetRequestError(undefined, sessionId, error);
            if (throwOnError) {
                throw error;
            }
            logger.warn(`WidgetManager.terminateWidgetSession failed for ${sessionId}:`, error);
            return false;
        }
    }

    async validateWidgetURL(url: string): Promise<boolean> {
        try {
            const parsedUrl = new URL(url);

            const allowedSchemes = ["http:", "https:"];
            if (!allowedSchemes.includes(parsedUrl.protocol)) {
                return false;
            }

            return true;
            // @swallow-error { owner: "widget", expires: "2026-12-31" }
        } catch (e) {
            logger.debug("WidgetManager boolean probe failed", e);
            return false;
        }
    }

    getCachedWidgets(roomId: string): IWidget[] {
        const roomWidgets = this.widgets.get(roomId);
        return roomWidgets ? Array.from(roomWidgets.values()) : [];
    }

    getCachedWidget(roomId: string, widgetId: string): IWidget | null {
        const roomWidgets = this.widgets.get(roomId);
        return roomWidgets?.get(widgetId) || null;
    }

    clearRoomWidgets(roomId: string): void {
        this.widgets.delete(roomId);

        for (const [key, permission] of this.permissions.entries()) {
            if (permission.roomId === roomId) {
                this.permissions.delete(key);
            }
        }
    }

    async start(): Promise<void> {
        const rooms = this.client.getRooms?.() || [];
        for (const room of rooms) {
            try {
                await this.getRoomWidgets(room.roomId);
            } catch (e) {
                const error = this.normalizeError(e, "start");
                logger.warn(`Failed to load widgets for room ${room.roomId}:`, error);
            }
        }
    }

    stop(): void {
        this.widgets.clear();
        this.permissions.clear();
        this.pendingRequests.clear();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getWidgetManager(): WidgetManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getWidgetManager = function (): WidgetManager {
        return getOrCreateManager(this, "widget", () => new WidgetManager(this));
    };
}

export default extendMatrixClient;
