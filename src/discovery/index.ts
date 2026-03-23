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
 * Discovery Manager - 服务发现
 * 
 * 提供服务端点发现、房间别名解析等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class DiscoveryManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get homeserver URL
     */
    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    /**
     * Get client well-known
     */
    public getClientWellKnown(): any {
        return (this.client as any).clientWellKnown;
    }

    /**
     * Get server discovery info
     */
    public async getServerDiscoveryInfo(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, "/.well-known/matrix/client");
    }

    /**
     * Get room ID for alias
     */
    public async getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers: string[] }> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Get alias room ID
     */
    public async getAliasRoomId(alias: string): Promise<string | null> {
        try {
            const result = await this.getRoomIdForAlias(alias);
            return result.room_id;
        } catch {
            return null;
        }
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getDiscoveryManager(): DiscoveryManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDiscoveryManager = function (): DiscoveryManager {
        return new DiscoveryManager(this);
    };
}

export default extendMatrixClient;
