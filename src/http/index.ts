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
import { MatrixHttpApi, IHttpOpts } from "../http-api";

export interface IRequestOptions {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
}

export interface IPendingRequest {
    id: string;
    url: string;
    method: string;
    timestamp: number;
}

type ClientHttpApi = MatrixHttpApi<IHttpOpts & { onlyData: true }>;

export class HttpManager {
    constructor(private client: MatrixClient) {}

    public getHttp(): ClientHttpApi {
        return this.client.http;
    }

    public setHttp(http: ClientHttpApi): void {
        (this.client as unknown as { http: ClientHttpApi }).http = http;
    }

    public createRequest(options: IRequestOptions): Promise<unknown> {
        return (this.client as unknown as {
            createRequest: (options: IRequestOptions) => Promise<unknown>;
        }).createRequest(options);
    }

    public pickAnyDestinationCertificate(roomId: string, eventId: string): unknown {
        return (this.client as unknown as {
            pickAnyDestinationCertificate: (roomId: string, eventId: string) => unknown;
        }).pickAnyDestinationCertificate(roomId, eventId);
    }

    public getPendingRequests(): IPendingRequest[] {
        return (this.client as unknown as {
            getPendingRequests: () => IPendingRequest[];
        }).getPendingRequests();
    }

    public cancelPendingRequests(reason: string): void {
        (this.client as unknown as {
            cancelPendingRequests: (reason: string) => void;
        }).cancelPendingRequests(reason);
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
