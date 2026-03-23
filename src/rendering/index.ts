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
 * Rendering Manager - 渲染管理
 * 
 * 提供消息渲染相关功能
 */

import { MatrixClient } from "../client";

export class RenderingManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get event renderer
     */
    public getEventRenderer(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).eventRenderer;
    }

    /**
     * Set event renderer
     */
    public setEventRenderer(renderer: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).eventRenderer = renderer;
    }

    /**
     * Render event
     */
    public renderEvent(event: any): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).renderEvent(event);
    }

    /**
     * Render message
     */
    public renderMessage(message: any): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).renderMessage(message);
    }

    /**
     * Get text for event
     */
    public getTextForEvent(event: any): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getTextForEvent(event);
    }

    /**
     * Get preview text
     */
    public getPreviewText(event: any): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPreviewText(event);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRenderingManager(): RenderingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRenderingManager = function (): RenderingManager {
        return new RenderingManager(this);
    };
}

export default extendMatrixClient;
