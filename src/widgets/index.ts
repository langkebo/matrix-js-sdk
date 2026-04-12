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

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";

export interface WidgetInfo {
    id: string;
    type: string;
    url: string;
    name: string;
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
        return new WidgetsManager(this);
    };
}

export default extendMatrixClient;
