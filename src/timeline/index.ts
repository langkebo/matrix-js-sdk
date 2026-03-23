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
 * Timeline Manager - 时间线管理
 * 
 * 提供时间线相关功能
 */

import { MatrixClient } from "../client";

export class TimelineManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get timeline for room
     */
    public getTimelineForRoom(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getTimelineForRoom(roomId);
    }

    /**
     * Get event timeline
     */
    public getEventTimeline(roomId: string, eventId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEventTimeline(roomId, eventId);
    }

    /**
     * Get event andComments
     */
    public getEventAndComments(eventId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEventAndComments(eventId);
    }

    /**
     * Peek room
     */
    public async peekRoom(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).peekRoom(roomId);
    }

    /**
     * Stop peeking
     */
    public async stopPeeking(roomId: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).stopPeeking(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getTimelineManager(): TimelineManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTimelineManager = function (): TimelineManager {
        return new TimelineManager(this);
    };
}

export default extendMatrixClient;
