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
 * 本模块使用 __generated__ route-table 路径常量，提供 Ledger 对齐的 widget API。
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { validateUserId, validateRoomId } from "../common/validators";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { WidgetPath } from "./__generated__/route-table";
import type { PathAssert, StripVendor } from "../http-api/strip-prefix";
import { VendorPrefix } from "../http-api/prefix";

/**
 * Widget 面在 Batch 1–3 已整体归位 `/_matrix/vendor/v1`，后端**不留 client 别名**。
 * 2026-10-09 修正：本模块此前用 `WIDGET_PREFIX_VENDOR` / `WIDGET_PREFIX_VENDOR`（client 前缀），
 * 因此其全部调用点在真实后端上都会 404。之所以长期没被 `verify-path-contract.mjs`
 * 报出来：前缀是**模块内常量**、路径经 `wpv()` 恒等助手包装，两者都不在门禁的
 * 前缀声明表里 —— 与 `src/widgets/`（旧层）、`src/thread{,ing}/` 属同一类盲区。
 */
const WIDGET_PREFIX_VENDOR = VendorPrefix;

/**
 * vendor（`/_matrix/vendor/v1`）前缀下的路径断言。
 *
 * 不能用 `StripV1<WidgetPath>`：`WidgetPath` 是**只增不减**的并集（codegen 的
 * "既有条目 ∪ ledger"），残留的 v1 条目会让断言静默通过一个后端已不注册的路径。
 */
function wpv<const P extends string>(path: P & PathAssert<P, StripVendor<WidgetPath>>): P {
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
     * GET /_matrix/vendor/v1/rooms/{room_id}/widgets
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const list = await widgets.getRoomWidgets(roomId);
     * console.log(list.widgets);
     * ```
     */
    async getRoomWidgets(roomId: string): Promise<IWidgetsListResponse> {
        validateRoomId(roomId);
        const path = wpv(`/rooms/${encodeURIComponent(roomId)}/widgets`);
        return this.withRetry(
            () =>
                this.request<IWidgetsListResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getRoomWidgets",
        );
    }

    /**
     * 获取房间 Jitsi 配置
     * GET /_matrix/vendor/v1/rooms/{room_id}/widgets/jitsi/config
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const config = await widgets.getJitsiConfig(roomId);
     * console.log(config.domain);
     * ```
     */
    async getJitsiConfig(roomId: string): Promise<IJitsiConfig> {
        validateRoomId(roomId);
        const path = wpv(`/rooms/${encodeURIComponent(roomId)}/widgets/jitsi/config`);
        return this.withRetry(
            () =>
                this.request<IJitsiConfig>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getJitsiConfig",
        );
    }

    // ============ Widget CRUD ============

    /**
     * 创建小组件
     * POST /_matrix/vendor/v1/widgets
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const created = await widgets.createWidget({
     *     room_id: roomId,
     *     widget_type: "m.custom",
     *     url: "https://example.org/widget",
     *     name: "My Widget",
     * });
     * ```
     *
     * @throws {InvalidParamError} 当 widget_type、url 或 name 缺失时抛出
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
        const path = wpv("/widgets");
        return this.withRetry(
            () =>
                this.request<IWidgetResponse>({
                    method: Method.Post,
                    path,
                    body,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "createWidget",
        );
    }

    /**
     * 获取小组件详情
     * GET /_matrix/vendor/v1/widgets/{widget_id}
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const widget = await widgets.getWidget(widgetId);
     * console.log(widget.widget.name);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async getWidget(widgetId: string): Promise<IWidgetResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}`);
        return this.withRetry(
            () =>
                this.request<IWidgetResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getWidget",
        );
    }

    /**
     * 更新小组件
     * PUT /_matrix/vendor/v1/widgets/{widget_id}
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const updated = await widgets.updateWidget(widgetId, { name: "Renamed" });
     * console.log(updated.widget.name);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async updateWidget(
        widgetId: string,
        body: { url?: string; name?: string; data?: Record<string, unknown> },
    ): Promise<IWidgetResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}`);
        return this.withRetry(
            () =>
                this.request<IWidgetResponse>({
                    method: Method.Put,
                    path,
                    body,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "updateWidget",
        );
    }

    /**
     * 删除小组件
     * DELETE /_matrix/vendor/v1/widgets/{widget_id}
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * await widgets.deleteWidget(widgetId);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async deleteWidget(widgetId: string): Promise<void> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "deleteWidget",
        );
    }

    // ============ Widget config ============

    /**
     * 获取小组件配置
     * GET /_matrix/vendor/v1/widgets/{widget_id}/config
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const config = await widgets.getWidgetConfig(widgetId);
     * console.log(config.url);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async getWidgetConfig(widgetId: string): Promise<IWidgetConfig> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}/config`);
        return this.withRetry(
            () =>
                this.request<IWidgetConfig>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getWidgetConfig",
        );
    }

    // ============ Widget permissions ============

    /**
     * 获取小组件权限列表
     * GET /_matrix/vendor/v1/widgets/{widget_id}/permissions
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const perms = await widgets.getWidgetPermissions(widgetId);
     * console.log(perms.permissions.length);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async getWidgetPermissions(widgetId: string): Promise<IWidgetPermissionListResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}/permissions`);
        return this.withRetry(
            () =>
                this.request<IWidgetPermissionListResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getWidgetPermissions",
        );
    }

    /**
     * 设置小组件权限
     * POST /_matrix/vendor/v1/widgets/{widget_id}/permissions
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const result = await widgets.setWidgetPermissions(widgetId, {
     *     user_id: userId,
     *     permissions: ["read", "write"],
     * });
     * console.log(result.permission_id);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 或 user_id 为空、permissions 为空数组时抛出
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
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}/permissions`);
        return this.withRetry(
            () =>
                this.request<{ success: boolean; permission_id: number }>({
                    method: Method.Post,
                    path,
                    body,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "setWidgetPermissions",
        );
    }

    /**
     * 移除用户的小组件权限
     * DELETE /_matrix/vendor/v1/widgets/{widget_id}/permissions/{user_id}
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * await widgets.removeWidgetPermission(widgetId, userId);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 或 userId 为空时抛出
     */
    async removeWidgetPermission(widgetId: string, userId: string): Promise<void> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        if (!userId) throw new InvalidParamError("user_id is required");
        validateUserId(userId);
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}/permissions/${encodeURIComponent(userId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "removeWidgetPermission",
        );
    }

    // ============ Widget sessions ============

    /**
     * 获取小组件的所有会话
     * GET /_matrix/vendor/v1/widgets/{widget_id}/sessions
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const sessions = await widgets.getWidgetSessions(widgetId);
     * console.log(sessions.total);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async getWidgetSessions(widgetId: string): Promise<IWidgetSessionsListResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}/sessions`);
        return this.withRetry(
            () =>
                this.request<IWidgetSessionsListResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getWidgetSessions",
        );
    }

    /**
     * 创建小组件会话
     * POST /_matrix/vendor/v1/widgets/{widget_id}/sessions
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const session = await widgets.createWidgetSession(widgetId, { expires_in_ms: 3600000 });
     * console.log(session.session.session_id);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async createWidgetSession(
        widgetId: string,
        body?: { device_id?: string; expires_in_ms?: number },
    ): Promise<IWidgetSessionResponse> {
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/widgets/${encodeURIComponent(widgetId)}/sessions`);
        return this.withRetry(
            () =>
                this.request<IWidgetSessionResponse>({
                    method: Method.Post,
                    path,
                    body: body ?? {},
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "createWidgetSession",
        );
    }

    /**
     * 获取小组件会话详情
     * GET /_matrix/vendor/v1/widgets/sessions/{session_id}
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const session = await widgets.getWidgetSession(sessionId);
     * console.log(session.session.widget_id);
     * ```
     *
     * @throws {InvalidParamError} 当 sessionId 为空时抛出
     */
    async getWidgetSession(sessionId: string): Promise<IWidgetSessionResponse> {
        if (!sessionId) throw new InvalidParamError("session_id is required");
        const path = wpv(`/widgets/sessions/${encodeURIComponent(sessionId)}`);
        return this.withRetry(
            () =>
                this.request<IWidgetSessionResponse>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getWidgetSession",
        );
    }

    /**
     * 删除小组件会话
     * DELETE /_matrix/vendor/v1/widgets/sessions/{session_id}
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * await widgets.deleteWidgetSession(sessionId);
     * ```
     *
     * @throws {InvalidParamError} 当 sessionId 为空时抛出
     */
    async deleteWidgetSession(sessionId: string): Promise<void> {
        if (!sessionId) throw new InvalidParamError("session_id is required");
        const path = wpv(`/widgets/sessions/${encodeURIComponent(sessionId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "deleteWidgetSession",
        );
    }

    // ============ Widget capabilities (v3) ============

    /**
     * 获取小组件能力
     * GET /_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const caps = await widgets.getWidgetCapabilities(roomId, widgetId);
     * console.log(caps.capabilities);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空时抛出
     */
    async getWidgetCapabilities(roomId: string, widgetId: string): Promise<IWidgetCapabilities> {
        validateRoomId(roomId);
        if (!widgetId) throw new InvalidParamError("widget_id is required");
        const path = wpv(`/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`);
        return this.withRetry(
            () =>
                this.request<IWidgetCapabilities>({
                    method: Method.Get,
                    path,
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "getWidgetCapabilities",
        );
    }

    /**
     * 设置小组件能力
     * PUT /_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * const caps = await widgets.setWidgetCapabilities(roomId, widgetId, ["read", "write"]);
     * console.log(caps.capabilities);
     * ```
     *
     * @throws {InvalidParamError} 当 widgetId 为空或 capabilities 为空数组时抛出
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
        const path = wpv(`/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`);
        return this.withRetry(
            () =>
                this.request<IWidgetCapabilities>({
                    method: Method.Put,
                    path,
                    body: { capabilities },
                    prefix: WIDGET_PREFIX_VENDOR,
                }),
            "setWidgetCapabilities",
        );
    }

    // ============ Lifecycle ============

    /**
     * 启动小组件管理器（初始化小组件状态）
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * widgets.start();
     * ```
     */
    start(): void {
        // Initialize widget state
    }

    /**
     * 停止小组件管理器（清理小组件状态）
     *
     * @example
     * ```typescript
     * const widgets = client.getWidgetManager();
     * widgets.stop();
     * ```
     */
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
