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
 * HTTP Manager - HTTP请求管理
 *
 * 提供HTTP请求相关功能
 */

import { MatrixClient } from "../client";
import { MatrixHttpApi, IHttpOpts } from "../http-api";
import { BaseManager } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

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

export interface HttpManagerEvents {
    request_started: { url: string; method: string };
    request_completed: { url: string; method: string };
    request_failed: { url: string; method: string; error: Error };
}

export class HttpManager extends BaseManager<keyof HttpManagerEvents, HttpManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getHttp(): ClientHttpApi {
        return this.client.http;
    }

    public setHttp(http: ClientHttpApi): void {
        this.client.http = http;
    }

    public async createRequest(options: IRequestOptions): Promise<unknown> {
        return this.withRetry(
            () => this.client.createRequest(options),
            "createRequest",
        );
    }

    public pickAnyDestinationCertificate(roomId: string, eventId: string): unknown {
        return this.client.pickAnyDestinationCertificate(roomId, eventId);
    }

    public getPendingRequests(): IPendingRequest[] {
        return this.client.getPendingRequests();
    }

    public cancelPendingRequests(reason: string): void {
        this.client.cancelPendingRequests(reason);
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getHttpManager = function (): HttpManager {
        registerManagerClass("http", HttpManager);
    return getOrCreateManager(this, "http", () => new HttpManager(this));
    };
}

export default extendMatrixClient;
