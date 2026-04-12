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
 * Turn Server Manager - TURN服务器管理
 *
 * 提供TURN服务器信息获取功能
 */

import { MatrixClient } from "../client";
import { type ITurnServer } from "../client";
import { BaseManager } from "../managers/base-manager";

export interface TurnServerManagerEvents {
    turn_servers_updated: { servers: ITurnServer[] };
    turn_server_expired: void;
}

export class TurnServerManager extends BaseManager<keyof TurnServerManagerEvents, TurnServerManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getTurnServers(): ITurnServer[] {
        return this.client.getTurnServers();
    }

    public async getTurnServerURIs(): Promise<string[]> {
        return await this.client.getTurnServerURIs();
    }

    public getTurnServerExpiry(): number {
        return this.client.getTurnServersExpiry();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getTurnServerManager(): TurnServerManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTurnServerManager = function (): TurnServerManager {
        return new TurnServerManager(this);
    };
}

export default extendMatrixClient;
