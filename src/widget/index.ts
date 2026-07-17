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
 * 提供 Matrix widget 的创建、查询、配置、权限管理功能
 * 对应后端: synapse-rust widget 模块
 *
 * Note: 此模块区别于 src/widgets/（WidgetsManager，历史兼容层）。
 * 本模块使用 __generated__ route-table 路径常量，提供 Ledger 对齐的 widget API。
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { validateUserId, validateRoomId } from "../common/validators";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { WidgetPathPattern } from "./__generated__/route-table";

const WIDGET_PREFIX_V1 = "/_matrix/client/v1";
const WIDGET_PREFIX_V3 = "/_matrix/client/v3";

type StripV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;
type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function wp(path: StripV1<WidgetPathPattern>): string {
    return path;
}

function wpV3(path: StripV3<WidgetPathPattern>): string {
    return path;
}

// ============ Events ============

export enum WidgetEvent {
    WidgetCreated = "WidgetCreated",
    WidgetDeleted = "WidgetDeleted",
    WidgetUpdated = "WidgetUpdated",
    WidgetError = "WidgetError",
}

// ============ Types ============

export interface IWidget {
    widget_id: string;
    room_id: string | null;
    user_id: string;
    type: string;
    url: string;
    name: string;
    /** Dynamic: widget data varies by widget type */
    data: Record<string, unknown>; // Dynamic: dynamic Matrix content
    creator: string;
    active: boolean;
}

export interface IWidgetConfig {
    widget_id: string;
    room_id: string | null;
    url: string;
    name: string;
    type: string;
    data: Record<string, unknown>;
}

export interface IWidgetPermission {
    id: number;
    widget_id: string;
    user_id: string;
    permissions: string[];
    created_ts: number;
    updated_ts: number | null;
}

export interface IWidgetPermissionListResponse {
    permissions: IWidgetPermission[];
}

export interface IWidgetSession {
    session_id: string;
    widget_id: string;
    device_id: string | null;
    created_ts: number;
    expires_ts: number | null;
}

export interface IWidgetSessionResponse {
    session: IWidgetSession;
}

export interface IWidgetSessionsListResponse {
    sessions: IWidgetSession[];
    total: number;
}

export interface IWidgetCapabilities {
    widget_id: string;
    room_id: string;
    capabilities: string[];
}

export interface IWidgetSendResponse {
    event_id: string;
}

export interface IWidgetResponse {
    widget: IWidget;
}

export interface IWidgetsListResponse {
    widgets: IWidget[];
}

export interface IJitsiConfig {
    conf_id: string;
    name: string;
    domain: string;
    app_id: string | null;
    jwt: string | null;
}

interface WidgetManagerEventMap {
    [WidgetEvent.WidgetCreated]: (widget: IWidget) => void;
    [WidgetEvent.WidgetDeleted]: (widgetId: string) => void;
    [WidgetEvent.WidgetUpdated]: (widget: IWidget) => void;
    [WidgetEvent.WidgetError]: (error: Error) => void;
}

// ============ Manager ============

export class WidgetManager extends BaseManager<WidgetEvent, WidgetManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    // ============ Room widgets ============

    /**
     * 获取房间内所有小组件
     * GET /_matrix/client/v1/rooms/{room_id}/widgets
     */
    async getRoomWidgets(roomId: string): Promise<IWidgetsListResponse> {
        validateRoomId(roomId);
        const path = wp(`/rooms/${encodeURIComponent(roomId)}/widgets`);
        return this.withRetry(
            () =>
                this.request<IWidgetsListResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "getRoomWidgets",
        );
    }

    /**
     * 获取房间 Jitsi 配置
     * GET /_matrix/client/v1/rooms/{room_id}/widgets/jitsi/config
     */
    async getJitsiConfig(roomId: string): Promise<IJitsiConfig> {
        validateRoomId(roomId);
        const path = wp(`/rooms/${encodeURIComponent(roomId)}/widgets/jitsi/config`);
        return this.withRetry(
            () =>
                this.request<IJitsiConfig>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "getJitsiConfig",
        );
    }

    // ============ Widget CRUD ============

    /**
     * 创建小组件
     * POST /_matrix/client/v1/widgets
     */
    async createWidget(body: {
        room_id?: string;
        widget_type: string;
        url: string;
        name: string;
        data?: Record<string, unknown>;
    }): Promise<IWidgetResponse> {
        if (!body.widget_type) throw new InvalidParamError("widget_type is required");
        if (!body.url) throw new InvalidParamError("url is required");
        if (!body.name) throw new InvalidParamError("name is required");
        const path = wp("/widgets");
        return this.withRetry(
            () =>
                this.request<IWidgetResponse>({
                    method: Method.Post,
                    path,
                    body,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "createWidget",
        );
    }

    /**
     * 获取小组件详情
     * GET /_matrix/client/v1/widgets/{widget_id}
     */
    async getWidget(widgetId: string): Promise<IWidgetResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}`);
        return this.withRetry(
            () =>
                this.request<IWidgetResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "getWidget",
        );
    }

    /**
     * 更新小组件
     * PUT /_matrix/client/v1/widgets/{widget_id}
     */
    async updateWidget(
        widgetId: string,
        body: { url?: string; name?: string; data?: Record<string, unknown> },
    ): Promise<IWidgetResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}`);
        return this.withRetry(
            () =>
                this.request<IWidgetResponse>({
                    method: Method.Put,
                    path,
                    body,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "updateWidget",
        );
    }

    /**
     * 删除小组件
     * DELETE /_matrix/client/v1/widgets/{widget_id}
     */
    async deleteWidget(widgetId: string): Promise<void> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "deleteWidget",
        );
    }

    // ============ Widget config ============

    /**
     * 获取小组件配置
     * GET /_matrix/client/v1/widgets/{widget_id}/config
     */
    async getWidgetConfig(widgetId: string): Promise<IWidgetConfig> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}/config`);
        return this.withRetry(
            () =>
                this.request<IWidgetConfig>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "getWidgetConfig",
        );
    }

    // ============ Widget permissions ============

    /**
     * 获取小组件权限列表
     * GET /_matrix/client/v1/widgets/{widget_id}/permissions
     */
    async getWidgetPermissions(widgetId: string): Promise<IWidgetPermissionListResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}/permissions`);
        return this.withRetry(
            () =>
                this.request<IWidgetPermissionListResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "getWidgetPermissions",
        );
    }

    /**
     * 设置小组件权限
     * POST /_matrix/client/v1/widgets/{widget_id}/permissions
     */
    async setWidgetPermissions(
        widgetId: string,
        body: { user_id: string; permissions: string[] },
    ): Promise<{ success: boolean; permission_id: number }> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        if (!body.user_id) throw new InvalidParamError("user_id is required");
        if (!body.permissions || body.permissions.length === 0) {
            throw new InvalidParamError("permissions must be a non-empty array");
        }
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}/permissions`);
        return this.withRetry(
            () =>
                this.request<{ success: boolean; permission_id: number }>({
                    method: Method.Post,
                    path,
                    body,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "setWidgetPermissions",
        );
    }

    /**
     * 移除用户的小组件权限
     * DELETE /_matrix/client/v1/widgets/{widget_id}/permissions/{user_id}
     */
    async removeWidgetPermission(widgetId: string, userId: string): Promise<void> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        if (!userId) throw new InvalidParamError("user_id is required");
        validateUserId(userId);
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}/permissions/${encodeURIComponent(userId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "removeWidgetPermission",
        );
    }

    // ============ Widget sessions ============

    /**
     * 获取小组件的所有会话
     * GET /_matrix/client/v1/widgets/{widget_id}/sessions
     */
    async getWidgetSessions(widgetId: string): Promise<IWidgetSessionsListResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}/sessions`);
        return this.withRetry(
            () =>
                this.request<IWidgetSessionsListResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "getWidgetSessions",
        );
    }

    /**
     * 创建小组件会话
     * POST /_matrix/client/v1/widgets/{widget_id}/sessions
     */
    async createWidgetSession(
        widgetId: string,
        body?: { device_id?: string; expires_in_ms?: number },
    ): Promise<IWidgetSessionResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wp(`/widgets/${encodeURIComponent(widgetId)}/sessions`);
        return this.withRetry(
            () =>
                this.request<IWidgetSessionResponse>({
                    method: Method.Post,
                    path,
                    body: body ?? {},
                    prefix: WIDGET_PREFIX_V1,
                }),
            "createWidgetSession",
        );
    }

    /**
     * 获取小组件会话详情
     * GET /_matrix/client/v1/widgets/sessions/{session_id}
     */
    async getWidgetSession(sessionId: string): Promise<IWidgetSessionResponse> {
        if (!sessionId) throw new InvalidParamError("session_id is required");
        const path = wp(`/widgets/sessions/${encodeURIComponent(sessionId)}`);
        return this.withRetry(
            () =>
                this.request<IWidgetSessionResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "getWidgetSession",
        );
    }

    /**
     * 删除小组件会话
     * DELETE /_matrix/client/v1/widgets/sessions/{session_id}
     */
    async deleteWidgetSession(sessionId: string): Promise<void> {
        if (!sessionId) throw new InvalidParamError("session_id is required");
        const path = wp(`/widgets/sessions/${encodeURIComponent(sessionId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path,
                    prefix: WIDGET_PREFIX_V1,
                }),
            "deleteWidgetSession",
        );
    }

    // ============ Widget capabilities (v3) ============

    /**
     * 获取小组件能力
     * GET /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities
     */
    async getWidgetCapabilities(roomId: string, widgetId: string): Promise<IWidgetCapabilities> {
        validateRoomId(roomId);
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpV3(`/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`);
        return this.withRetry(
            () =>
                this.request<IWidgetCapabilities>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_V3,
                }),
            "getWidgetCapabilities",
        );
    }

    /**
     * 设置小组件能力
     * PUT /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities
     */
    async setWidgetCapabilities(
        roomId: string,
        widgetId: string,
        capabilities: string[],
    ): Promise<IWidgetCapabilities> {
        validateRoomId(roomId);
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        if (!capabilities || capabilities.length === 0) {
            throw new InvalidParamError("capabilities must be a non-empty array");
        }
        const path = wpV3(`/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`);
        return this.withRetry(
            () =>
                this.request<IWidgetCapabilities>({
                    method: Method.Put,
                    path,
                    body: { capabilities },
                    prefix: WIDGET_PREFIX_V3,
                }),
            "setWidgetCapabilities",
        );
    }

    /**
     * 发送小组件事件
     * POST /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/send
     */
    async sendWidgetEvent(
        roomId: string,
        widgetId: string,
        message: Record<string, unknown>,
    ): Promise<IWidgetSendResponse> {
        validateRoomId(roomId);
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpV3(`/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/send`);
        return this.withRetry(
            () =>
                this.request<IWidgetSendResponse>({
                    method: Method.Post,
                    path,
                    body: message,
                    prefix: WIDGET_PREFIX_V3,
                }),
            "sendWidgetEvent",
        );
    }

    /**
     * 创建小组件（v3 端点）
     * POST /_matrix/client/v3/widgets/create
     */
    async createWidgetV3(body: {
        room_id?: string;
        widget_type: string;
        url: string;
        name: string;
        data?: Record<string, unknown>;
    }): Promise<IWidgetResponse> {
        if (!body.widget_type) throw new InvalidParamError("widget_type is required");
        if (!body.url) throw new InvalidParamError("url is required");
        const path = wpV3("/widgets/create");
        return this.withRetry(
            () =>
                this.request<IWidgetResponse>({
                    method: Method.Post,
                    path,
                    body,
                    prefix: WIDGET_PREFIX_V3,
                }),
            "createWidgetV3",
        );
    }

    // ============ Lifecycle ============

    start(): void {
        // Initialize widget state
    }

    stop(): void {
        // Clean up widget state
    }
}

// ============ MatrixClient extension ============

export function extendMatrixClient(): void {
    MatrixClient.prototype.getWidgetManager = function (): WidgetManager {
        registerManagerClass("widget", WidgetManager);
        return getOrCreateManager(this, "widget", () => new WidgetManager(this));
    };
}
