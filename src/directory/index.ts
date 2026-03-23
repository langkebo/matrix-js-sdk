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
 * Directory Manager - 目录管理
 * 
 * 提供公共房间列表、房间目录等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class DirectoryManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get public rooms list
     */
    public async getPublicRoomsList(opts?: any): Promise<any> {
        const path = "/publicRooms";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path, opts);
    }

    /**
     * Get public rooms
     */
    public async getPublicRooms(server: string, limit?: number, since?: string): Promise<any> {
        const path = "/publicRooms";
        const opts: any = { server };
        if (limit) opts.limit = limit;
        if (since) opts.since = since;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, opts);
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
     * Create room alias
     */
    public async createRoomAlias(roomId: string, alias: string): Promise<any> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, path, undefined, { room_id: roomId });
    }

    /**
     * Delete room alias
     */
    public async deleteRoomAlias(alias: string): Promise<any> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Delete, path);
    }

    /**
     * Get aliases for room
     */
    public async getAliasesForRoom(roomId: string): Promise<string[]> {
        const path = utils.encodeUri("/rooms/$roomId/aliases", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getDirectoryManager(): DirectoryManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDirectoryManager = function (): DirectoryManager {
        return new DirectoryManager(this);
    };
}

export default extendMatrixClient;
