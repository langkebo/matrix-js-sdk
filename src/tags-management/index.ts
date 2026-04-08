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
 * Tags Manager - 标签管理
 * 
 * 提供房间标签管理功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export interface ITagContent {
    order?: number;
    [key: string]: unknown;
}

export interface IRoomAccountData {
    tags?: {
        [tag: string]: ITagContent;
    };
    [key: string]: unknown;
}

export class TagsManager {
    constructor(private client: MatrixClient) {}

    public getRoomTags(roomId: string): string[] {
        return (this.client as unknown as {
            store: {
                getRoomTags: (roomId: string) => string[];
            };
        }).store.getRoomTags(roomId);
    }

    public getRoomAccountData(roomId: string, eventType: string): Record<string, unknown> | null {
        return (this.client as unknown as {
            store: {
                getRoomAccountData: (roomId: string, eventType: string) => Record<string, unknown> | null;
            };
        }).store.getRoomAccountData(roomId, eventType);
    }

    public async setRoomAccountData(roomId: string, eventType: string, content: Record<string, unknown>): Promise<{}> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/account_data/$type", {
            $userId: this.client.credentials.userId!,
            $roomId: roomId,
            $type: eventType,
        });
        return this.client.http.authedRequest<{}>(Method.Put, path, undefined, content);
    }

    public async addRoomTag(roomId: string, tag: string, content?: ITagContent): Promise<{}> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
            $userId: this.client.credentials.userId!,
            $roomId: roomId,
            $tag: tag,
        });
        return this.client.http.authedRequest<{}>(Method.Put, path, undefined, content || {});
    }

    public async removeRoomTag(roomId: string, tag: string): Promise<{}> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
            $userId: this.client.credentials.userId!,
            $roomId: roomId,
            $tag: tag,
        });
        return this.client.http.authedRequest<{}>(Method.Delete, path);
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
