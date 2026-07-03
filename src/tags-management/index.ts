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
import { type IContent } from "../models/event";
import { buildRoomAccountDataPath, buildRoomTagPath } from "../client-account-data-requests";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface ITagContent {
    order?: number;
}

export interface IRoomAccountData {
    tags?: {
        [tag: string]: ITagContent;
    };
}

export interface TagsManagerEvents {
    tag_added: { roomId: string; tag: string };
    tag_removed: { roomId: string; tag: string };
    tags_updated: { roomId: string; tags: Record<string, ITagContent> };
}

export class TagsManager extends BaseManager<keyof TagsManagerEvents, TagsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getRoomTags(roomId: string): string[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        return Object.keys(room.tags);
    }

    public getRoomAccountData(roomId: string, eventType: string): IContent | null {
        const room = this.client.getRoom(roomId);
        if (!room) return null;
        const event = room.getAccountData(eventType);
        return (event?.getContent() as IContent) ?? null;
    }

    public async setRoomAccountData(
        roomId: string,
        eventType: string,
        content: IContent,
    ): Promise<EmptyObject> {
        return this.withRetry(async () => {
            const path = buildRoomAccountDataPath(this.client.credentials.userId!, roomId, eventType);
            return this.request<EmptyObject>({
                method: Method.Put,
                path: path,
                body: content,
            });
        }, "setRoomAccountData");
    }

    public async addRoomTag(roomId: string, tag: string, content?: ITagContent): Promise<EmptyObject> {
        return this.withRetry(async () => {
            const path = buildRoomTagPath(this.client.credentials.userId!, roomId, tag);
            return this.request<EmptyObject>({
                method: Method.Put,
                path: path,
                body: content || {},
            });
        }, "addRoomTag");
    }

    public async removeRoomTag(roomId: string, tag: string): Promise<EmptyObject> {
        return this.withRetry(async () => {
            const path = buildRoomTagPath(this.client.credentials.userId!, roomId, tag);
            return this.request<EmptyObject>({
                method: Method.Delete,
                path: path,
            });
        }, "removeRoomTag");
    }
}

interface EmptyObject {}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getTagsManager = function (): TagsManager {
        registerManagerClass("tagsManagement", TagsManager);
    return getOrCreateManager(this, "tagsManagement", () => new TagsManager(this));
    };
}

export default extendMatrixClient;
