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
 * Tags Manager - 标签管理
 * 
 * 提供房间标签管理功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class TagsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room tags
     */
    public getRoomTags(roomId: string): string[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).store.getRoomTags(roomId);
    }

    /**
     * Get room account data
     */
    public getRoomAccountData(roomId: string, eventType: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).store.getRoomAccountData(roomId, eventType);
    }

    /**
     * Set room account data
     */
    public async setRoomAccountData(roomId: string, eventType: string, content: any): Promise<any> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/account_data/$type", {
            $userId: this.client.credentials.userId!,
            $roomId: roomId,
            $type: eventType,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, path, undefined, content);
    }

    /**
     * Add room tag
     */
    public async addRoomTag(roomId: string, tag: string, content?: any): Promise<any> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
            $userId: this.client.credentials.userId!,
            $roomId: roomId,
            $tag: tag,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, path, undefined, content || {});
    }

    /**
     * Remove room tag
     */
    public async removeRoomTag(roomId: string, tag: string): Promise<any> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
            $userId: this.client.credentials.userId!,
            $roomId: roomId,
            $tag: tag,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Delete, path);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getTagsManager(): TagsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTagsManager = function (): TagsManager {
        return new TagsManager(this);
    };
}

export default extendMatrixClient;
