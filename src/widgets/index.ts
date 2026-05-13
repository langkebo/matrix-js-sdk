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
 * Widgets Manager - 小组件管理
 *
 * 提供 Matrix widgets 管理功能
 */

import { ClientPrefix } from "../http-api/prefix";
import { Method } from "../http-api/method";
import { type Body } from "../http-api/interface";
import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface WidgetInfo {
    id: string;
    type: string;
    url: string;
    name: string;
    data?: Record<string, unknown>;
}

export interface Widget {
    widget_id: string;
    room_id: string | null;
    user_id: string;
    type: string;
    url: string;
    name: string;
    data: Record<string, unknown>;
    creator: string;
    active: boolean;
}

export interface WidgetResponse {
    widget: Widget;
}

export interface CreateWidgetBody {
    room_id?: string;
    widget_type: string;
    url: string;
    name: string;
    data?: Record<string, unknown>;
}

export interface UpdateWidgetBody {
    url?: string;
    name?: string;
    data?: Record<string, unknown>;
}

export interface WidgetsManagerEvents {
    widget_added: { widgetId: string; roomId?: string };
    widget_removed: { widgetId: string; roomId?: string };
    widget_updated: { widgetId: string; roomId?: string };
}

export class WidgetsManager extends BaseManager<keyof WidgetsManagerEvents, WidgetsManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    private request<T>(method: Method, path: string, body?: unknown): Promise<T> {
        return this.client.http.authedRequest(method, path, undefined, body as Body | undefined, {
            prefix: ClientPrefix.V1,
        }) as Promise<T>;
    }

    /** POST /_matrix/client/v1/widgets */
    public async createWidget(body: CreateWidgetBody): Promise<WidgetResponse> {
        return this.withRetry(() => this.request<WidgetResponse>(Method.Post, "/widgets", body), "createWidget");
    }

    /** GET /_matrix/client/v1/widgets/{widget_id} */
    public async getWidgetById(widgetId: string): Promise<WidgetResponse> {
        return this.withRetry(
            () => this.request<WidgetResponse>(Method.Get, `/widgets/${encodeURIComponent(widgetId)}`),
            "getWidgetById",
        );
    }

    /** PUT /_matrix/client/v1/widgets/{widget_id} */
    public async updateWidget(widgetId: string, body: UpdateWidgetBody): Promise<WidgetResponse> {
        return this.withRetry(
            () => this.request<WidgetResponse>(Method.Put, `/widgets/${encodeURIComponent(widgetId)}`, body),
            "updateWidget",
        );
    }

    /** DELETE /_matrix/client/v1/widgets/{widget_id} */
    public async deleteWidget(widgetId: string): Promise<void> {
        await this.withRetry(
            () => this.request<void>(Method.Delete, `/widgets/${encodeURIComponent(widgetId)}`),
            "deleteWidget",
        );
    }

    /** GET /_matrix/client/v1/widgets/{widget_id}/config */
    public async getWidgetConfig(widgetId: string): Promise<Record<string, unknown>> {
        return this.withRetry(
            () => this.request<Record<string, unknown>>(Method.Get, `/widgets/${encodeURIComponent(widgetId)}/config`),
            "getWidgetConfig",
        );
    }

    /** GET /_matrix/client/v1/rooms/{room_id}/widgets */
    public async listRoomWidgets(roomId: string): Promise<{ widgets: Widget[] }> {
        return this.withRetry(
            () => this.request<{ widgets: Widget[] }>(Method.Get, `/rooms/${encodeURIComponent(roomId)}/widgets`),
            "listRoomWidgets",
        );
    }

    /** GET /_matrix/client/v1/rooms/{room_id}/widgets/jitsi/config */
    public async getJitsiConfig(roomId: string): Promise<Record<string, unknown>> {
        return this.withRetry(
            () =>
                this.request<Record<string, unknown>>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/jitsi/config`,
                ),
            "getJitsiConfig",
        );
    }

    /** POST /_matrix/client/v1/widgets/{widget_id}/permissions */
    public async setWidgetPermission(
        widgetId: string,
        body: { user_id: string; permissions: string[] },
    ): Promise<Record<string, unknown>> {
        return this.withRetry(
            () =>
                this.request<Record<string, unknown>>(
                    Method.Post,
                    `/widgets/${encodeURIComponent(widgetId)}/permissions`,
                    body,
                ),
            "setWidgetPermission",
        );
    }

    /** GET /_matrix/client/v1/widgets/{widget_id}/permissions */
    public async getWidgetPermissions(widgetId: string): Promise<Record<string, unknown>> {
        return this.withRetry(
            () =>
                this.request<Record<string, unknown>>(
                    Method.Get,
                    `/widgets/${encodeURIComponent(widgetId)}/permissions`,
                ),
            "getWidgetPermissions",
        );
    }

    /** DELETE /_matrix/client/v1/widgets/{widget_id}/permissions/{user_id} */
    public async deleteWidgetPermission(widgetId: string, userId: string): Promise<void> {
        await this.withRetry(
            () =>
                this.request<void>(
                    Method.Delete,
                    `/widgets/${encodeURIComponent(widgetId)}/permissions/${encodeURIComponent(userId)}`,
                ),
            "deleteWidgetPermission",
        );
    }

    /** POST /_matrix/client/v1/widgets/{widget_id}/sessions */
    public async createWidgetSession(
        widgetId: string,
        body: { widget_id?: string; device_id?: string; expires_in_ms?: number } = {},
    ): Promise<Record<string, unknown>> {
        return this.withRetry(
            () =>
                this.request<Record<string, unknown>>(
                    Method.Post,
                    `/widgets/${encodeURIComponent(widgetId)}/sessions`,
                    body,
                ),
            "createWidgetSession",
        );
    }

    /** GET /_matrix/client/v1/widgets/{widget_id}/sessions */
    public async listWidgetSessions(widgetId: string): Promise<Record<string, unknown>> {
        return this.withRetry(
            () =>
                this.request<Record<string, unknown>>(Method.Get, `/widgets/${encodeURIComponent(widgetId)}/sessions`),
            "listWidgetSessions",
        );
    }

    /** GET /_matrix/client/v1/widgets/sessions/{session_id} */
    public async getWidgetSession(sessionId: string): Promise<Record<string, unknown>> {
        return this.withRetry(
            () =>
                this.request<Record<string, unknown>>(Method.Get, `/widgets/sessions/${encodeURIComponent(sessionId)}`),
            "getWidgetSession",
        );
    }

    /** DELETE /_matrix/client/v1/widgets/sessions/{session_id} */
    public async terminateWidgetSession(sessionId: string): Promise<void> {
        await this.withRetry(
            () => this.request<void>(Method.Delete, `/widgets/sessions/${encodeURIComponent(sessionId)}`),
            "terminateWidgetSession",
        );
    }

    // Legacy helpers kept for backward compatibility — account-data based.
    public async getUserWidgets(): Promise<Record<string, unknown>> {
        return this.withRetry(() => this.client.getUserWidgets(), "getUserWidgets");
    }

    public async getRoomWidgets(roomId: string): Promise<Record<string, unknown>> {
        return this.withRetry(() => this.client.getRoomWidgets(roomId), "getRoomWidgets");
    }

    public async setUserWidgets(widgets: Record<string, unknown>): Promise<void> {
        return this.withRetry(() => this.client.setUserWidgets(widgets), "setUserWidgets");
    }

    public async setRoomWidgets(roomId: string, widgets: Record<string, unknown>): Promise<void> {
        return this.withRetry(() => this.client.setRoomWidgets(roomId, widgets), "setRoomWidgets");
    }

    public async getAllWidgetEvents(roomId: string): Promise<MatrixEvent[]> {
        return this.withRetry(() => this.client.getAllWidgetEvents(roomId), "getAllWidgetEvents");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getWidgetsManager(): WidgetsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getWidgetsManager = function (): WidgetsManager {
        return getOrCreateManager(this, "widgets", () => new WidgetsManager(this));
    };
}

export default extendMatrixClient;
