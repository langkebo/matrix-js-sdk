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

export class WidgetsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get user widgets
     */
    public getUserWidgets(): Record<string, MatrixEvent[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUserWidgets();
    }

    /**
     * Get room widgets
     */
    public getRoomWidgets(roomId: string): MatrixEvent[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomWidgets(roomId);
    }

    /**
     * Set user widgets
     */
    public async setUserWidgets(widgets: Record<string, any>): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setUserWidgets(widgets);
    }

    /**
     * Set room widgets
     */
    public async setRoomWidgets(roomId: string, widgets: MatrixEvent[]): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomWidgets(roomId, widgets);
    }

    /**
     * Get all widget events
     */
    public getAllWidgetEvents(): MatrixEvent[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAllWidgetEvents();
    }
}

// Declare prototype extension
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
