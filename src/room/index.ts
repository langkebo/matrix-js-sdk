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
 * Room Manager - 房间管理
 * 
 * 提供房间创建、加入、离开、管理等功能
 */

import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { Method } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import { type ICreateRoomOpts, type IJoinRoomOpts, type KnockRoomOpts, type InviteOpts, type ITagsResponse } from "../@types/requests";
import { type RoomAccountDataEvents } from "../@types/event";
import * as utils from "../utils";

interface ITagMetadata {
    order?: number;
}

interface ISendEventResponse {
    event_id: string;
    room_id?: string;
}

export class RoomManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get a room by ID
     */
    public getRoom(roomId: string | undefined): Room | null {
        return this.client.store.getRoom(roomId!);
    }

    /**
     * Get all rooms
     */
    public getRooms(): Room[] {
        return this.client.store.getRooms();
    }

    /**
     * Get visible rooms (filtered)
     */
    public getVisibleRooms(msc3946ProcessDynamicPredecessor = false): Room[] {
        const allRooms = this.client.store.getRooms();
        return allRooms;
    }

    /**
     * Create a room
     */
    public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
        // Inject id_access_token if inviting 3rd party addresses
        const invitesNeedingToken = (options.invite_3pid || []).filter((i: any) => !i.id_access_token);
        if (invitesNeedingToken.length > 0 && (this.client as any).identityServer?.getAccessToken) {
            const identityAccessToken = await (this.client as any).identityServer.getAccessToken();
            if (identityAccessToken) {
                for (const invite of invitesNeedingToken) {
                    (invite as any).id_access_token = identityAccessToken;
                }
            }
        }

        return this.client.http.authedRequest(Method.Post, "/createRoom", undefined, options);
    }

    /**
     * Join a room
     */
    public async joinRoom(roomIdOrAlias: string, opts: IJoinRoomOpts = {}): Promise<Room> {
        const path = utils.encodeUri("/join/$roomId", { $roomId: roomIdOrAlias });
        
        const res = await this.client.http.authedRequest<{ room_id: string }>(
            Method.Post,
            path,
            undefined,
            opts,
        );

        const newRoom = this.client.getRoom(res.room_id)!;
        return newRoom;
    }

    /**
     * Knock on a room
     */
    public knockRoom(roomIdOrAlias: string, opts: KnockRoomOpts = {}): Promise<{ room_id: string }> {
        const path = utils.encodeUri("/knock/$roomId", { $roomId: roomIdOrAlias });
        return this.client.http.authedRequest<{ room_id: string }>(Method.Post, path, undefined, opts);
    }

    /**
     * Leave a room
     */
    public leave(roomId: string): Promise<EmptyObject> {
        const path = utils.encodeUri("/rooms/$roomId/leave", { $roomId: roomId });
        return this.client.http.authedRequest(Method.Post, path, undefined, {});
    }

    /**
     * Invite a user to a room
     */
    public async invite(roomId: string, userId: string, opts: InviteOpts | string = {}): Promise<EmptyObject> {
        const path = utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId });
        const body: Record<string, any> = typeof opts === "string" ? { user_id: opts } : { user_id: userId, ...opts };
        return this.client.http.authedRequest(Method.Post, path, undefined, body);
    }

    /**
     * Invite by email
     */
    public inviteByEmail(roomId: string, email: string): Promise<EmptyObject> {
        return this.invite(roomId, email, { id_server: (this.client as any).idServer?.hostname } as any);
    }

    /**
     * Invite by third-party ID
     */
    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<EmptyObject> {
        const path = utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId });
        const idServer = (this.client as any).idServer?.hostname;
        if (!idServer) {
            throw new Error("No ID server configured");
        }
        return this.client.http.authedRequest(Method.Post, path, undefined, {
            id_server: idServer,
            medium,
            address,
        });
    }

    /**
     * Ban a user from a room
     */
    public ban(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        const path = utils.encodeUri("/rooms/$roomId/ban", { $roomId: roomId });
        return this.client.http.authedRequest(Method.Post, path, undefined, { user_id: userId, reason });
    }

    /**
     * Unban a user from a room
     */
    public unban(roomId: string, userId: string): Promise<EmptyObject> {
        const path = utils.encodeUri("/rooms/$roomId/unban", { $roomId: roomId });
        return this.client.http.authedRequest(Method.Post, path, undefined, { user_id: userId });
    }

    /**
     * Forget a room
     */
    public async forget(roomId: string, deleteRoom = true): Promise<EmptyObject> {
        if (deleteRoom) {
            this.client.store.removeRoom(roomId);
        }
        const path = utils.encodeUri("/rooms/$roomId/forget", { $roomId: roomId });
        return this.client.http.authedRequest(Method.Post, path, undefined, { delete_room: deleteRoom });
    }

    /**
     * Set room name
     */
    public setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        const path = utils.encodeUri("/rooms/$roomId/state/m.room.name", { $roomId: roomId });
        return this.client.http.authedRequest(Method.Put, path, undefined, { name });
    }

    /**
     * Set room topic
     */
    public setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse> {
        const path = utils.encodeUri("/rooms/$roomId/state/m.room.topic", { $roomId: roomId });
        return this.client.http.authedRequest(Method.Put, path, undefined, { topic, formatted_topic: htmlTopic });
    }

    /**
     * Get room tags
     */
    public getRoomTags(roomId: string): Promise<ITagsResponse> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/tags", {
            $userId: this.client.getUserId()!,
            $roomId: roomId,
        });
        return this.client.http.authedRequest(Method.Get, path);
    }

    /**
     * Set room tag
     */
    public setRoomTag(roomId: string, tagName: string, metadata: ITagMetadata = {}): Promise<EmptyObject> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
            $userId: this.client.getUserId()!,
            $roomId: roomId,
            $tag: tagName,
        });
        return this.client.http.authedRequest(Method.Put, path, undefined, metadata);
    }

    /**
     * Delete room tag
     */
    public deleteRoomTag(roomId: string, tagName: string): Promise<EmptyObject> {
        const path = utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
            $userId: this.client.getUserId()!,
            $roomId: roomId,
            $tag: tagName,
        });
        return this.client.http.authedRequest(Method.Delete, path);
    }

    /**
     * Set room account data
     */
    public setRoomAccountData<K extends keyof RoomAccountDataEvents>(
        roomId: string,
        eventType: K,
        content: RoomAccountDataEvents[K],
    ): Promise<EmptyObject> {
        const path = utils.encodeUri("/rooms/$roomId/account_data/$type", {
            $roomId: roomId,
            $type: eventType,
        });
        return this.client.http.authedRequest(Method.Put, path, undefined, content);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomManager(): RoomManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomManager = function (): RoomManager {
        return new RoomManager(this);
    };
}

export default extendMatrixClient;
