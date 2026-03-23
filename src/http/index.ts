/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * HTTP Manager - HTTP请求管理
 * 
 * 提供HTTP请求相关功能
 */

import { MatrixClient } from "../client";

export class HttpManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get HTTP agent
     */
    public getHttp(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http;
    }

    /**
     * Set HTTP agent
     */
    public setHttp(http: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).http = http;
    }

    /**
     * Create http request
     */
    public createRequest(options: any): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).createRequest(options);
    }

    /**
     * Pick any destination certificate
     */
    public pickAnyDestinationCertificate(roomId: string, eventId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).pickAnyDestinationCertificate(roomId, eventId);
    }

    /**
     * Get pending requests
     */
    public getPendingRequests(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPendingRequests();
    }

    /**
     * Cancel pending requests
     */
    public cancelPendingRequests(reason: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).cancelPendingRequests(reason);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getHttpManager(): HttpManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getHttpManager = function (): HttpManager {
        return new HttpManager(this);
    };
}

export default extendMatrixClient;
