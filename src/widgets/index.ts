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
import { type WidgetData } from "../matrix-client-extensions";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";

export interface WidgetMessageData {
    [key: string]: unknown;
}

export interface WidgetInfo {
    id: string;
    type: string;
    url: string;
    name: string;
    /** Dynamic: widget data varies by widget type */
    data?: WidgetMessageData;
}

export interface Widget {
    widget_id: string;
    room_id: string | null;
    user_id: string;
    type: string;
    url: string;
    name: string;
    /** Dynamic: widget data varies by widget type */
    data: WidgetMessageData;
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
    /** Dynamic: widget data varies by widget type */
    data?: WidgetMessageData;
}

export interface UpdateWidgetBody {
    url?: string;
    name?: string;
    /** Dynamic: widget data varies by widget type */
    data?: WidgetMessageData;
}

/** Response for GET /_matrix/client/v1/widgets/{widgetId}/config */
export interface WidgetConfigResponse {
    widget_id: string;
    room_id: string | null;
    url: string;
    name: string;
    /** Dynamic: widget data varies by widget type */
    data: WidgetMessageData;
    type: string;
}

/** Response for GET /_matrix/client/v1/rooms/{roomId}/widgets/jitsi/config */
export interface WidgetJitsiConfigResponse {
    conf_id: string;
    name: string;
    domain: string;
    app_id: string | null;
    jwt: string | null;
}

/** Response for POST /_matrix/client/v1/widgets/{widgetId}/permissions */
export interface SetWidgetPermissionResponse {
    success: boolean;
    permission_id: number;
}

/** Response for GET /_matrix/client/v1/widgets/{widgetId}/permissions */
export interface GetWidgetPermissionsResponse {
    permissions: WidgetPermissionItem[];
}

/** A single widget permission entry */
export interface WidgetPermissionItem {
    id: number;
    widget_id: string;
    user_id: string;
    permissions: string[];
    created_ts: number;
    updated_ts: number | null;
}

/** A widget session */
export interface WidgetSession {
    session_id: string;
    widget_id: string;
    device_id: string | null;
    created_ts: number;
    expires_ts: number | null;
}

/** Response for POST/GET widget sessions (single session) */
export interface WidgetSessionResponse {
    session: WidgetSession;
}

/** Response for GET /_matrix/client/v1/widgets/{widgetId}/sessions */
export interface WidgetSessionsListResponse {
    sessions: WidgetSession[];
    total: number;
}

export interface WidgetCapabilitiesResponse {
    widget_id: string;
    room_id: string;
    capabilities: string[];
    [key: string]: unknown;
}

export interface UpdateWidgetCapabilitiesBody {
    capabilities: string[];
    [key: string]: unknown;
}

export interface WidgetMessageResponse {
    event_id: string;
    [key: string]: unknown;
}

export interface CreateWidgetV3Body {
    room_id?: string;
    widget_type: string;
    url: string;
    name: string;
    data?: WidgetMessageData;
}

export interface CreateWidgetV3Response {
    widget: Widget;
    [key: string]: unknown;
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

    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.Widget, true);
    }

    private request<T>(method: Method, path: string, body?: unknown): Promise<T> {
        return this.client.http.authedRequest(method, path, undefined, body as Body | undefined, {
            prefix: ClientPrefix.V1,
        }) as Promise<T>;
    }

    private requestV3<T>(method: Method, path: string, body?: unknown): Promise<T> {
        return this.client.http.authedRequest(method, path, undefined, body as Body | undefined, {
            prefix: ClientPrefix.V3,
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
    public async getWidgetConfig(widgetId: string): Promise<WidgetConfigResponse> {
        return this.withRetry(
            () => this.request<WidgetConfigResponse>(Method.Get, `/widgets/${encodeURIComponent(widgetId)}/config`),
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
    public async getJitsiConfig(roomId: string): Promise<WidgetJitsiConfigResponse> {
        return this.withRetry(
            () =>
                this.request<WidgetJitsiConfigResponse>(
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
    ): Promise<SetWidgetPermissionResponse> {
        return this.withRetry(
            () =>
                this.request<SetWidgetPermissionResponse>(
                    Method.Post,
                    `/widgets/${encodeURIComponent(widgetId)}/permissions`,
                    body,
                ),
            "setWidgetPermission",
        );
    }

    /** GET /_matrix/client/v1/widgets/{widget_id}/permissions */
    public async getWidgetPermissions(widgetId: string): Promise<GetWidgetPermissionsResponse> {
        return this.withRetry(
            () =>
                this.request<GetWidgetPermissionsResponse>(
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
    ): Promise<WidgetSessionResponse> {
        return this.withRetry(
            () =>
                this.request<WidgetSessionResponse>(
                    Method.Post,
                    `/widgets/${encodeURIComponent(widgetId)}/sessions`,
                    body,
                ),
            "createWidgetSession",
        );
    }

    /** GET /_matrix/client/v1/widgets/{widget_id}/sessions */
    public async listWidgetSessions(widgetId: string): Promise<WidgetSessionsListResponse> {
        return this.withRetry(
            () =>
                this.request<WidgetSessionsListResponse>(Method.Get, `/widgets/${encodeURIComponent(widgetId)}/sessions`),
            "listWidgetSessions",
        );
    }

    /** GET /_matrix/client/v1/widgets/sessions/{session_id} */
    public async getWidgetSession(sessionId: string): Promise<WidgetSessionResponse> {
        return this.withRetry(
            () =>
                this.request<WidgetSessionResponse>(Method.Get, `/widgets/sessions/${encodeURIComponent(sessionId)}`),
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

    /** DELETE /_matrix/client/v1/widgets/sessions/{session_id} (alias for terminateWidgetSession) */
    public async deleteWidgetSession(sessionId: string): Promise<void> {
        await this.withRetry(
            () => this.request<void>(Method.Delete, `/widgets/sessions/${encodeURIComponent(sessionId)}`),
            "deleteWidgetSession",
        );
    }

    /** GET /_matrix/client/v3/rooms/{roomId}/widgets/{widgetId}/capabilities */
    public async getWidgetCapabilities(roomId: string, widgetId: string): Promise<WidgetCapabilitiesResponse> {
        this.requireNonEmptyString(roomId, "roomId");
        this.requireNonEmptyString(widgetId, "widgetId");
        return this.withRetry(
            () =>
                this.requestV3<WidgetCapabilitiesResponse>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`,
                ),
            "getWidgetCapabilities",
        );
    }

    /** PUT /_matrix/client/v3/rooms/{roomId}/widgets/{widgetId}/capabilities */
    public async updateWidgetCapabilities(
        roomId: string,
        widgetId: string,
        capabilities: UpdateWidgetCapabilitiesBody,
    ): Promise<WidgetCapabilitiesResponse> {
        this.requireNonEmptyString(roomId, "roomId");
        this.requireNonEmptyString(widgetId, "widgetId");
        return this.withRetry(
            () =>
                this.requestV3<WidgetCapabilitiesResponse>(
                    Method.Put,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/capabilities`,
                    capabilities,
                ),
            "updateWidgetCapabilities",
        );
    }

    /** POST /_matrix/client/v3/rooms/{roomId}/widgets/{widgetId}/send */
    public async sendWidgetMessage(roomId: string, widgetId: string, message: unknown): Promise<WidgetMessageResponse> {
        this.requireNonEmptyString(roomId, "roomId");
        this.requireNonEmptyString(widgetId, "widgetId");
        return this.withRetry(
            () =>
                this.requestV3<WidgetMessageResponse>(
                    Method.Post,
                    `/rooms/${encodeURIComponent(roomId)}/widgets/${encodeURIComponent(widgetId)}/send`,
                    message,
                ),
            "sendWidgetMessage",
        );
    }

    /** POST /_matrix/client/v3/widgets/create */
    public async createWidgetV3(body: CreateWidgetV3Body): Promise<CreateWidgetV3Response> {
        return this.withRetry(
            () => this.requestV3<CreateWidgetV3Response>(Method.Post, "/widgets/create", body),
            "createWidgetV3",
        );
    }

    // Legacy helpers kept for backward compatibility — account-data based.
    public async getUserWidgets(): Promise<WidgetData> {
        return this.withRetry(() => this.client.getUserWidgets(), "getUserWidgets");
    }

    public async getRoomWidgets(roomId: string): Promise<WidgetData> {
        return this.withRetry(() => this.client.getRoomWidgets(roomId), "getRoomWidgets");
    }

    public async setUserWidgets(widgets: WidgetData): Promise<void> {
        return this.withRetry(() => this.client.setUserWidgets(widgets), "setUserWidgets");
    }

    public async setRoomWidgets(roomId: string, widgets: WidgetData): Promise<void> {
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
