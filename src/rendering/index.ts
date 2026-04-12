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
import { MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";

export type EventRenderer = (event: MatrixEvent) => string | null;

export interface IRenderOptions {
    showTimestamp?: boolean;
    showSender?: boolean;
    maxLength?: number;
}

export interface RenderingManagerEvents {
    renderer_set: void;
    renderer_cleared: void;
}

export class RenderingManager extends BaseManager<keyof RenderingManagerEvents, RenderingManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getEventRenderer(): EventRenderer | null {
        return (this.client as unknown as { eventRenderer?: EventRenderer }).eventRenderer ?? null;
    }

    public setEventRenderer(renderer: EventRenderer): void {
        (this.client as unknown as { eventRenderer?: EventRenderer }).eventRenderer = renderer;
    }

    public renderEvent(event: MatrixEvent, options?: IRenderOptions): string | null {
        return (
            this.client as unknown as {
                renderEvent: (event: MatrixEvent, options?: IRenderOptions) => string | null;
            }
        ).renderEvent(event, options);
    }

    public renderMessage(message: Record<string, unknown>): string | null {
        return (
            this.client as unknown as {
                renderMessage: (message: Record<string, unknown>) => string | null;
            }
        ).renderMessage(message);
    }

    public getTextForEvent(event: MatrixEvent): string {
        return (
            this.client as unknown as {
                getTextForEvent: (event: MatrixEvent) => string;
            }
        ).getTextForEvent(event);
    }

    public getPreviewText(event: MatrixEvent): string {
        return (
            this.client as unknown as {
                getPreviewText: (event: MatrixEvent) => string;
            }
        ).getPreviewText(event);
    }
}

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
