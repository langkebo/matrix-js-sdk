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
 * Room Key Sharing Manager - 房间密钥分享管理
 *
 * 提供房间密钥分享相关功能
 */

import {
    type ICreateRoomKeyRequest,
    type IGetRoomKeyRequestsQuery,
    type IRoomKeyRequestCreateResponse,
    type IRoomKeyRequestsResponse,
    MatrixClient,
} from "../client";
import { type EmptyObject } from "../@types/common";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface RoomKeyInfo {
    roomId: string;
    sessionId: string;
    algorithm: string;
}

export interface RoomKeySharingManagerEvents {
    key_shared: { roomId: string; users: string[] };
    key_requested: { roomId: string; sessionId: string };
    keys_exported: { count: number };
    keys_imported: { count: number };
}

export class RoomKeySharingManager extends BaseManager<keyof RoomKeySharingManagerEvents, RoomKeySharingManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async shareRoomKey(roomId: string, users: string[]): Promise<unknown> {
        return this.withRetry(() => this.client.shareRoomKey(roomId, users), "shareRoomKey");
    }

    public async requestRoomKey(
        roomId: string,
        sessionId: string,
        algorithm = "m.megolm.v1.aes-sha2",
        requestType = "request",
    ): Promise<IRoomKeyRequestCreateResponse> {
        const request: ICreateRoomKeyRequest = {
            algorithm,
            room_id: roomId,
            session_id: sessionId,
            request_type: requestType,
        };
        return this.withRetry(() => this.client.requestRoomKey(request), "requestRoomKey");
    }

    public async getRoomKeyRequests(query: IGetRoomKeyRequestsQuery = {}): Promise<IRoomKeyRequestsResponse> {
        return this.withRetry(() => this.client.getRoomKeyRequests(query), "getRoomKeyRequests");
    }

    public async deleteRoomKeyRequest(requestId: string): Promise<EmptyObject> {
        return this.withRetry(() => this.client.deleteRoomKeyRequest(requestId), "deleteRoomKeyRequest");
    }

    public async getSharedWithUsers(roomId: string): Promise<string[]> {
        return this.withRetry(async () => {
            const result = await this.client.getSharedWithUsers(roomId);
            return Object.keys(result);
        }, "getSharedWithUsers");
    }

    public async hasSharedKeyWithUser(userId: string): Promise<boolean> {
        return this.withRetry(() => this.client.hasSharedKeyWithUser(userId), "hasSharedKeyWithUser");
    }

    public async exportRoomKeys(): Promise<unknown> {
        return this.withRetry(() => this.client.exportRoomKeys(), "exportRoomKeys");
    }

    public async importRoomKeys(
        keys: Array<{
            room_id: string;
            session_id: string;
            session_key: string;
            algorithm?: string;
            forwarding_curve25519_key_chain?: string[];
            sender_key?: string;
            sender_claimed_keys?: Record<string, string>;
            export_format?: number;
        }>,
    ): Promise<unknown> {
        return this.withRetry(() => this.client.importRoomKeys(keys), "importRoomKeys");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomKeySharingManager = function (): RoomKeySharingManager {
        registerManagerClass("roomKeySharing", RoomKeySharingManager);
        return getOrCreateManager(this, "roomKeySharing", () => new RoomKeySharingManager(this));
    };
}

export default extendMatrixClient;
