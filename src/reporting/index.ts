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
 * Reporting Manager - 举报管理
 * 
 * 提供内容举报功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class ReportingManager {
    constructor(private client: MatrixClient) {}

    /**
     * Report room
     */
    public async reportRoom(roomId: string, reason: string, score?: number): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/report", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { reason, score });
    }

    /**
     * Report event
     */
    public async reportEvent(roomId: string, eventId: string, reason: string, score?: number): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/report/$eventId", { $roomId: roomId, $eventId: eventId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { reason, score });
    }

    /**
     * Report user
     */
    public async reportUser(userId: string, reason: string): Promise<any> {
        const path = utils.encodeUri("/users/$userId/report", { $userId: userId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { reason });
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getReportingManager(): ReportingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getReportingManager = function (): ReportingManager {
        return new ReportingManager(this);
    };
}

export default extendMatrixClient;
