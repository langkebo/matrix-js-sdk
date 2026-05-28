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

import { MatrixClient, ClientEvent } from "../client";
import { Room } from "../models/room";
import { Method } from "../http-api/method";
import { ClientPrefix, MediaPrefix } from "../http-api/prefix";
import { MatrixError } from "../http-api/errors";
import { type EmptyObject } from "../@types/common";
import {
    type ICreateRoomOpts,
    type IJoinRoomOpts,
    type KnockRoomOpts,
    type InviteOpts,
    type ITagsResponse,
    type IGuestAccessOpts,
} from "../@types/requests";
import { type RoomAccountDataEvents, EventType } from "../@types/event";
import { type IContent } from "../models/event";
import { InvalidParamError } from "../common/errors";
import { BaseManager } from "../managers/base-manager";
import * as utils from "../utils";
import { logger } from "../logger";
import { KnownMembership } from "../@types/membership";
import { IThirdPartySigned, IJoinRequestBody, ITagMetadata, IRoomHierarchy } from "../client-internal-types";
import { IRoomInitialSyncResponse, type IPreviewUrlResponse } from "../client-api-types";
import { QueryDict } from "../utils";
import { SyncApi } from "../sync";
import { searchRoomsRequest } from "../client-secure-backup-requests";
import { LRUCache } from "../utils/lru-cache";
import { InflightRequestCache } from "../utils/inflight-request-cache";
import { Visibility, GuestAccess, HistoryVisibility } from "../@types/partials";
import * as ContentHelpers from "../content-helpers";
import { beginRoomPeek, endRoomPeek } from "../client-room-peek";
import type { InviteRequest } from "./__generated__/dto";
import type { RoomPathPattern } from "./__generated__/route-table";
import type { TagsPathPattern } from "../tags/__generated__/route-table";
import type { MSC3575SlidingSyncRequest, MSC3575SlidingSyncResponse } from "../sliding-sync";

export enum RoomEvent {
    RoomCreated = "RoomCreated",
    RoomJoined = "RoomJoined",
    RoomLeft = "RoomLeft",
    MemberJoined = "MemberJoined",
    MemberLeft = "MemberLeft",
    StateChanged = "StateChanged",
    Error = "Error",
}

export interface IRoomEvent {
    content: IContent;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: IContent;
}

export interface IStateEvent extends IRoomEvent {
    state_key: string;
}

export interface IRoomVersionResponse {
    room_version: string;
}

export interface IRoomCapabilitiesResponse {
    capabilities: Record<string, unknown>;
}

export interface IRoomMetadataResponse {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    history_visibility?: string;
    guest_access?: string;
    created_ts?: number;
}

export interface IGetMembersResponse {
    chunk: IStateEvent[];
}

export interface IJoinedMembersResponse {
    joined: {
        [userId: string]: {
            display_name?: string;
            avatar_url?: string;
        };
    };
}

export interface IGetMessagesResponse {
    chunk: IRoomEvent[];
    start: string;
    end?: string;
    state?: IStateEvent[];
}

export interface ISendEventResponse {
    event_id: string;
    room_id?: string;
}

export interface IEventContextResponse {
    event: IRoomEvent;
    events_before: IRoomEvent[];
    events_after: IRoomEvent[];
    start: string;
    end: string;
    state: IStateEvent[];
}

export interface IMyRoom {
    membership?: string;
    join_state?: string;
    [key: string]: unknown;
}

export interface IMyRoomsResponse {
    rooms: IMyRoom[];
    total: number;
}

interface RoomManagerEventMap {
    [RoomEvent.RoomCreated]: (roomId: string) => void;
    [RoomEvent.RoomJoined]: (roomId: string) => void;
    [RoomEvent.RoomLeft]: (roomId: string) => void;
    [RoomEvent.MemberJoined]: (roomId: string, userId: string) => void;
    [RoomEvent.MemberLeft]: (roomId: string, userId: string) => void;
    [RoomEvent.StateChanged]: (roomId: string, eventType: string, stateKey: string) => void;
    [RoomEvent.Error]: (error: Error) => void;
}

type RoomInfoCacheEntry =
    | IRoomVersionResponse
    | IRoomCapabilitiesResponse
    | IRoomMetadataResponse
    | IJoinedMembersResponse;

type StripR0<P extends string> = P extends `/_matrix/client/r0${infer Rest}` ? Rest : never;
type StripV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;
type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
type RoomManagerPathPattern =
    | StripR0<RoomPathPattern | TagsPathPattern>
    | StripV1<RoomPathPattern>
    | StripV3<RoomPathPattern | TagsPathPattern>;

function rp<P extends RoomManagerPathPattern>(path: P): P {
    return path;
}

export class RoomManager extends BaseManager<RoomEvent, RoomManagerEventMap> {
    private roomInfoCache: LRUCache<RoomInfoCacheEntry>;
    private membersCache: LRUCache<IStateEvent[]>;
    private stateCache: LRUCache<IStateEvent[]>;
    private peekSync: SyncApi | null = null;
    private readonly urlPreviewRequestCache: InflightRequestCache<IPreviewUrlResponse>;

    constructor(client: MatrixClient) {
        super(client);

        this.roomInfoCache = new LRUCache<RoomInfoCacheEntry>(100, 5 * 60 * 1000);
        this.membersCache = new LRUCache<IStateEvent[]>(100, 2 * 60 * 1000);
        this.stateCache = new LRUCache<IStateEvent[]>(50, 5 * 60 * 1000);
        this.urlPreviewRequestCache = new InflightRequestCache<IPreviewUrlResponse>(client.urlPreviewCache);
    }

    private validateRoomId(roomId: string): void {
        if (!roomId || typeof roomId !== "string") {
            throw new InvalidParamError("roomId is required and must be a string");
        }
        const trimmed = roomId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("roomId cannot be empty");
        }
    }

    private validateUserId(userId: string): void {
        if (!userId || typeof userId !== "string") {
            throw new InvalidParamError("userId is required and must be a string");
        }
        const trimmed = userId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("userId cannot be empty");
        }
    }

    // ==================== Room Info ====================

    public getRoom(roomId: string | undefined): Room | null {
        return this.client.store.getRoom(roomId!);
    }

    public getRooms(): Room[] {
        return this.client.store.getRooms();
    }

    public getVisibleRooms(_msc3946ProcessDynamicPredecessor = false): Room[] {
        // Implementation moved from MatrixClient
        const rooms = this.client.store.getRooms();
        return rooms.filter((room) => {
            const myMembership = room.getMyMembership();
            return myMembership === KnownMembership.Join || myMembership === KnownMembership.Invite;
        });
    }

    public async getRoomVersion(roomId: string, forceRefresh = false): Promise<string> {
        this.validateRoomId(roomId);

        const cacheKey = `version:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "room_version" in cached && typeof cached.room_version === "string") {
                return cached.room_version;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomVersionResponse>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/version`),
                undefined,
                undefined,
            );
        });

        this.roomInfoCache.set(cacheKey, { room_version: response.room_version });
        return response.room_version;
    }

    public async getRoomCapabilities(roomId: string, forceRefresh = false): Promise<IRoomCapabilitiesResponse> {
        this.validateRoomId(roomId);

        const cacheKey = `capabilities:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached) {
                return cached as unknown as IRoomCapabilitiesResponse;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomCapabilitiesResponse>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/capabilities`),
                undefined,
                undefined,
            );
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    public async getRoomMetadata(roomId: string, forceRefresh = false): Promise<IRoomMetadataResponse> {
        this.validateRoomId(roomId);

        const cacheKey = `metadata:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached) {
                return cached as unknown as IRoomMetadataResponse;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomMetadataResponse>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/metadata`),
                undefined,
                undefined,
            );
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    // ==================== Room Lifecycle ====================

    public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
        const invitesNeedingToken = (options.invite_3pid || []).filter(
            (i: { id_access_token?: string }) => !i.id_access_token,
        );
        if (invitesNeedingToken.length > 0 && this.client.identityServer?.getAccessToken) {
            const identityAccessToken = await this.client.identityServer.getAccessToken();
            if (identityAccessToken) {
                for (const invite of invitesNeedingToken) {
                    (invite as { id_access_token?: string }).id_access_token = identityAccessToken;
                }
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ room_id: string }>(
                Method.Post,
                rp("/createRoom"),
                undefined,
                options,
            );
        });

        this.emit(RoomEvent.RoomCreated, response.room_id);
        return response;
    }

    public async joinRoom(roomIdOrAlias: string, opts: IJoinRoomOpts = {}): Promise<Room> {
        const room = this.getRoom(roomIdOrAlias);
        const roomMember = room?.getMember(this.client.getSafeUserId());
        const preJoinMembership = roomMember?.membership;

        const inviter =
            preJoinMembership == KnownMembership.Invite ? (roomMember?.events.member?.getSender() ?? null) : null;

        logger.debug(
            `joinRoom[${roomIdOrAlias}]: preJoinMembership=${preJoinMembership}, inviter=${inviter}, opts=${JSON.stringify(opts)}`,
        );
        if (preJoinMembership == KnownMembership.Join) return room!;

        let signPromise: Promise<IThirdPartySigned | void> = Promise.resolve();

        if (opts.inviteSignUrl) {
            const url = new URL(opts.inviteSignUrl);
            url.searchParams.set("mxid", this.client.credentials.userId!);
            signPromise = this.client.http.requestOtherUrl<IThirdPartySigned>(Method.Post, url);
        }

        const queryParams: QueryDict = {};
        if (opts.viaServers) {
            queryParams.via = queryParams.server_name = opts.viaServers.slice(0, 3);
        }

        const data: IJoinRequestBody = {};
        const signedInviteObj = await signPromise;
        if (signedInviteObj) {
            data.third_party_signed = signedInviteObj;
        }

        const path = rp(`/join/${encodeURIComponent(roomIdOrAlias)}`);
        const res = await this.client.http.authedRequest<{ room_id: string }>(Method.Post, path, queryParams, data);

        const roomId = res.room_id;
        const cryptoBackend = this.client.getCryptoBackend();
        if (opts.acceptSharedHistory && inviter && cryptoBackend) {
            const bundleDownloaded = await cryptoBackend.maybeAcceptKeyBundle(roomId, inviter);
            if (!bundleDownloaded) {
                cryptoBackend.markRoomAsPendingKeyBundle(roomId, inviter);
            }
        }

        const resolvedRoom = this.getRoom(roomId);
        if (resolvedRoom?.hasMembershipState(this.client.getSafeUserId(), KnownMembership.Join)) return resolvedRoom;

        const syncApi = new SyncApi(this.client, this.client.getClientOpts(), this.client.getSyncApiOptions());
        return syncApi.createRoom(roomId);
    }

    public async knockRoom(roomIdOrAlias: string, opts: KnockRoomOpts = {}): Promise<{ room_id: string }> {
        const room = this.getRoom(roomIdOrAlias);
        if (room?.hasMembershipState(this.client.getSafeUserId(), KnownMembership.Knock)) {
            return { room_id: room.roomId };
        }

        const path = rp(`/knock/${encodeURIComponent(roomIdOrAlias)}`);

        const queryParams: QueryDict = {};
        if (opts.viaServers) {
            const viaServers = Array.isArray(opts.viaServers) ? opts.viaServers.slice(0, 3) : [opts.viaServers];
            queryParams.server_name = viaServers;
            queryParams.via = viaServers;
        }

        const body: Record<string, string> = {};
        if (opts.reason) {
            body.reason = opts.reason;
        }

        return this.withRetry(async () => {
            return await this.client.http.authedRequest(Method.Post, path, queryParams, body);
        }, { label: "knockRoom", idempotent: false });
    }

    public async leave(roomId: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/leave`),
                undefined,
                {},
            );
        });

        this.emit(RoomEvent.RoomLeft, roomId);
        this.clearRoomCache(roomId);
        return response;
    }

    public async forget(roomId: string, deleteRoom = true): Promise<EmptyObject> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/forget`),
                undefined,
                { delete_room: deleteRoom },
            );
        });

        if (deleteRoom) {
            this.client.store.removeRoom(roomId);
            this.client.emit(ClientEvent.DeleteRoom, roomId);
        }

        this.clearRoomCache(roomId);
        return response;
    }

    // ==================== Members ====================

    public async getMembers(
        roomId: string,
        params?: {
            membership?: string;
            not_membership?: string;
            at?: string;
        },
        forceRefresh = false,
    ): Promise<IStateEvent[]> {
        this.validateRoomId(roomId);

        if (!forceRefresh && !params) {
            const cached = this.membersCache.get(`members:${roomId}`);
            if (cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IGetMembersResponse>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/members`),
                params as Record<string, string>,
                undefined,
            );
        });

        if (!params) {
            this.membersCache.set(`members:${roomId}`, response.chunk);
        }
        return response.chunk;
    }

    public async getJoinedMembers(roomId: string, forceRefresh = false): Promise<IJoinedMembersResponse> {
        this.validateRoomId(roomId);

        const cacheKey = `joined_members:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached) {
                return cached as unknown as IJoinedMembersResponse;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IJoinedMembersResponse>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/joined_members`),
                undefined,
                undefined,
            );
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    /**
     * Get user membership in a room
     *
     * @param roomId - room ID
     * @param userId - user ID
     * @param throwOnError - Whether to throw on error (default true, pass false to keep compatibility fallback)
     * @returns membership event
     */
    public async getMembership(roomId: string, userId: string, throwOnError = true): Promise<IStateEvent | null> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IStateEvent>(
                    Method.Get,
                    rp(`/rooms/${encodeURIComponent(roomId)}/membership/${encodeURIComponent(userId)}`),
                    undefined,
                    undefined,
                );
            });

            return response;
            // @swallow-error { owner: "room", expires: "2026-12-31" }
        } catch (error: unknown) {
            if (throwOnError) {
                throw error;
            }
            const err = error as Record<string, unknown>;
            const httpStatus = err?.httpStatus as number | undefined;
            if (httpStatus === 404) {
                return null;
            }
            throw error;
        }
    }

    // ==================== Member Actions ====================

    public async invite(roomId: string, userId: string, opts: InviteOpts | string = {}): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const normalizedOpts = typeof opts === "string" ? { reason: opts } : opts;

        if (normalizedOpts.shareEncryptedHistory) {
            await this.client.getCrypto()?.shareRoomHistoryWithUser(roomId, userId);
        }

        const body: InviteRequest = {
            user_id: userId,
            ...(normalizedOpts.reason ? { reason: normalizedOpts.reason } : {}),
        };

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/invite`),
                undefined,
                body,
            );
        });

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberJoined, roomId, userId);
        return response;
    }

    public async inviteByEmail(roomId: string, email: string): Promise<EmptyObject> {
        return this.inviteByThreePid(roomId, "email", email);
    }

    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        const identityAccessToken = this.client.identityServer?.getAccessToken
            ? await this.client.identityServer.getAccessToken()
            : undefined;

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/invite`),
                undefined,
                {
                    id_server: this.client.getIdentityServerUrl(true),
                    id_access_token: identityAccessToken,
                    medium,
                    address,
                },
            );
        });

        return response;
    }

    public async kick(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/kick`),
                undefined,
                { user_id: userId, reason },
            );
        });

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberLeft, roomId, userId);
        return response;
    }

    public async ban(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/ban`),
                undefined,
                { user_id: userId, reason },
            );
        });

        this.membersCache.delete(`members:${roomId}`);
        return response;
    }

    public async unban(roomId: string, userId: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/unban`),
                undefined,
                { user_id: userId },
            );
        });

        this.membersCache.delete(`members:${roomId}`);
        return response;
    }

    // ==================== Messages ====================

    // getMessages method has been moved to EventManager

    // ==================== State ====================

    public async getState(roomId: string, forceRefresh = false): Promise<IStateEvent[]> {
        return this.client.getEventManager().getState(roomId, forceRefresh);
    }

    public async getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<IContent> {
        return this.client.getEventManager().getStateEvent(roomId, eventType, stateKey);
    }

    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey = "",
    ): Promise<ISendEventResponse> {
        return this.client.getEventManager().sendStateEvent(roomId, eventType, content, stateKey);
    }

    public setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.client.sendStateEvent(roomId, "m.room.name", { name }, "");
    }

    public setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse> {
        const content = ContentHelpers.makeTopicContent(topic, htmlTopic);
        return this.client.sendStateEvent(roomId, EventType.RoomTopic, content, undefined);
    }

    // ==================== Events ====================

    public async getEvent(roomId: string, eventId: string): Promise<IRoomEvent> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomEvent>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`),
                undefined,
                undefined,
            );
        });

        return response;
    }

    public async getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: Record<string, unknown> }, // Dynamic: Matrix filter objects are spec-defined but arbitrarily shaped
    ): Promise<IEventContextResponse> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const queryParams: Record<string, string> = {};
        if (params?.limit !== undefined) queryParams.limit = params.limit.toString();
        if (params?.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IEventContextResponse>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(eventId)}`),
                Object.keys(queryParams).length > 0 ? queryParams : undefined,
                undefined,
            );
        });

        return response;
    }

    public async redactEvent(
        roomId: string,
        eventId: string,
        reason?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const txn = txnId || `m${Date.now()}`;
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ISendEventResponse>(
                Method.Put,
                rp(`/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(txn)}`),
                undefined,
                reason ? { reason } : {},
            );
        });

        return response;
    }

    // ==================== Tags ====================

    public async getRoomTags(roomId: string): Promise<ITagsResponse> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ITagsResponse>(
                Method.Get,
                rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                    }) as StripV3<TagsPathPattern>,
                ),
                undefined,
                undefined,
            );
        });

        return response;
    }

    public async setRoomTag(roomId: string, tagName: string, metadata: ITagMetadata = {}): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                        $tag: tagName,
                    }) as StripV3<TagsPathPattern>,
                ),
                undefined,
                metadata,
            );
        });

        return response;
    }

    public async deleteRoomTag(roomId: string, tagName: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Delete,
                rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                        $tag: tagName,
                    }) as StripV3<TagsPathPattern>,
                ),
                undefined,
                undefined,
            );
        });

        return response;
    }

    // ==================== Account Data ====================

    public async setRoomAccountData<K extends keyof RoomAccountDataEvents>(
        roomId: string,
        eventType: K,
        content: RoomAccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/account_data/$type", {
                    $roomId: roomId,
                    $type: eventType,
                }),
                undefined,
                content,
            );
        });

        return response;
    }

    // ==================== Room Directory ====================

    public async getRoomDirectoryVisibility(roomId: string): Promise<{ visibility: Visibility }> {
        this.validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ visibility: Visibility }>(
                Method.Get,
                utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId }),
                undefined,
                undefined,
            );
        });
        return response;
    }

    public async setRoomDirectoryVisibility(roomId: string, visibility: Visibility): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId }),
                undefined,
                { visibility },
            );
        });
        return response;
    }

    public async getRoomHierarchy(
        roomId: string,
        limit?: number,
        maxDepth?: number,
        suggestedOnly = false,
        fromToken?: string,
    ): Promise<IRoomHierarchy> {
        this.validateRoomId(roomId);
        const path = utils.encodeUri("/rooms/$roomId/hierarchy", { $roomId: roomId });
        const query: QueryDict = {
            suggested_only: String(suggestedOnly),
            max_depth: maxDepth?.toString(),
            from: fromToken,
            limit: limit?.toString(),
        };

        try {
            return await this.client.http.authedRequest<IRoomHierarchy>(Method.Get, path, query, undefined, {
                prefix: ClientPrefix.V1,
            });
        } catch (e) {
            if ((e as MatrixError).errcode === "M_UNRECOGNIZED") {
                return await this.client.http.authedRequest<IRoomHierarchy>(Method.Get, path, query, undefined, {
                    prefix: "/_matrix/client/unstable/org.matrix.msc2946",
                });
            }
            throw e;
        }
    }

    public async getRoomIdForAlias(roomAlias: string): Promise<{ room_id: string; servers: string[] }> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ room_id: string; servers: string[] }>(
                Method.Get,
                utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                undefined,
                undefined,
            );
        });
        return response;
    }

    public async createAlias(roomAlias: string, roomId: string): Promise<EmptyObject> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        this.validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                undefined,
                { room_id: roomId },
            );
        });
        return response;
    }

    public async deleteAlias(roomAlias: string): Promise<EmptyObject> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Delete,
                utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                undefined,
                undefined,
            );
        });
        return response;
    }

    public async getLocalAliases(roomId: string): Promise<{ aliases: string[] }> {
        this.validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ aliases: string[] }>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/aliases`),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
        return response;
    }

    // ==================== Room Management ====================

    public async upgradeRoom(
        roomId: string,
        newVersion: string,
        additionalCreators?: string[],
    ): Promise<{ replacement_room: string }> {
        this.validateRoomId(roomId);
        const body: { new_version: string; additional_creators?: string[] } = {
            new_version: newVersion,
        };
        if (additionalCreators) {
            body.additional_creators = additionalCreators;
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ replacement_room: string }>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/upgrade`),
                undefined,
                body,
            );
        });
        return response;
    }

    public async reportRoom(roomId: string, reason: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                rp(`/rooms/${encodeURIComponent(roomId)}/report`),
                undefined,
                { reason },
            );
        });
        return response;
    }

    public async roomInitialSync(roomId: string): Promise<IRoomInitialSyncResponse> {
        this.validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomInitialSyncResponse>(
                Method.Get,
                rp(`/rooms/${encodeURIComponent(roomId)}/initialSync`),
                undefined,
                undefined,
            );
        });
        return response;
    }

    public async setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        this.validateRoomId(roomId);
        const writePromise = this.client.sendStateEvent(
            roomId,
            EventType.RoomGuestAccess,
            {
                guest_access: opts.allowJoin ? GuestAccess.CanJoin : GuestAccess.Forbidden,
            },
            "",
        );
        let readPromise: Promise<unknown> = Promise.resolve();
        if (opts.allowRead) {
            readPromise = this.client.sendStateEvent(
                roomId,
                EventType.RoomHistoryVisibility,
                {
                    history_visibility: HistoryVisibility.WorldReadable,
                },
                "",
            );
        }
        await Promise.all([readPromise, writePromise]);
    }

    // ==================== Peeking ====================

    public async peekInRoom(roomId: string, limit = 20): Promise<Room> {
        this.validateRoomId(roomId);
        const { nextPeekSync, peekPromise } = beginRoomPeek(
            roomId,
            limit,
            this.peekSync,
            () => new SyncApi(this.client, this.client.getClientOpts(), this.client.getSyncApiOptions()),
        );
        this.peekSync = nextPeekSync;
        return peekPromise;
    }

    public stopPeeking(): void {
        this.peekSync = endRoomPeek(this.peekSync);
    }

    // ==================== Typing ====================

    public async getRoomTyping(roomId: string): Promise<string[]> {
        this.validateRoomId(roomId);
        const path = `/rooms/${encodeURIComponent(roomId)}/typing`;
        const response = await this.client.http.authedRequest<{ user_ids: string[] }>(
            Method.Get,
            path,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        return response.user_ids || [];
    }

    public async getBatchTyping(roomIds: string[]): Promise<Record<string, string[]>> {
        const path = "/rooms/typing";
        const response = await this.client.http.authedRequest<{
            rooms: Record<string, { user_ids: string[] }>;
        }>(Method.Post, path, undefined, { room_ids: roomIds }, { prefix: ClientPrefix.V3 });

        const result: Record<string, string[]> = {};
        for (const [roomId, data] of Object.entries(response.rooms || {})) {
            result[roomId] = data.user_ids || [];
        }
        return result;
    }

    // ==================== URL Preview ====================

    public async getUrlPreview(url: string, ts: number): Promise<IPreviewUrlResponse> {
        const bucketedTs = Math.floor(ts / 60000) * 60000;

        const parsed = new URL(url);
        parsed.hash = "";
        const normalizedUrl = parsed.toString();
        const key = bucketedTs + "_" + normalizedUrl;

        return this.urlPreviewRequestCache.getOrCreate(key, () =>
            this.client.http.authedRequest<IPreviewUrlResponse>(
                Method.Get,
                "/preview_url",
                {
                    url: normalizedUrl,
                    ts: bucketedTs.toString(),
                },
                undefined,
                {
                    prefix: MediaPrefix.V3,
                },
            ),
        );
    }

    // ==================== Cache Management ====================

    public clearRoomCache(roomId: string): void {
        this.roomInfoCache.delete(`version:${roomId}`);
        this.roomInfoCache.delete(`capabilities:${roomId}`);
        this.roomInfoCache.delete(`metadata:${roomId}`);
        this.roomInfoCache.delete(`joined_members:${roomId}`);
        this.membersCache.delete(`members:${roomId}`);
        this.stateCache.delete(`state:${roomId}`);
    }

    public clearAllCaches(): void {
        this.roomInfoCache.clear();
        this.membersCache.clear();
        this.stateCache.clear();
    }

    // ==================== Synapse-rust specific methods ====================

    /**
     * Get all rooms for the current user, including join, invite, and leave status.
     * Custom endpoint for synapse-rust.
     */
    public async getMyRooms(): Promise<IMyRoomsResponse> {
        const response = await this.client.http.authedRequest<IMyRoomsResponse>(
            Method.Get,
            "/_matrix/client/v3/my_rooms",
        );
        return {
            ...response,
            rooms: response.rooms.map((room: IMyRoom) => {
                const membership = room.membership ?? room.join_state;
                const joinState = room.join_state ?? room.membership;
                if (membership === room.membership && joinState === room.join_state) {
                    return room;
                }
                return { ...room, membership, join_state: joinState };
            }),
        };
    }

    /**
     * Search rooms by term (synapse-rust specific).
     * POST /_matrix/client/v3/search_rooms
     */
    public async searchRooms(
        searchTerm: string,
        limit?: number,
    ): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        return searchRoomsRequest(
            this.client.http.authedRequest.bind(this.client.http),
            searchTerm,
            limit,
        );
    }

    /**
     * Get client-facing server config (synapse-rust specific).
     * GET /_matrix/client/v1/config/client
     */
    public async getClientConfig(): Promise<{
        homeserver: { base_url: string; server_name: string };
        identity_server: { base_url: string };
        push: { enabled: boolean };
        email: { enabled: boolean };
        features: Record<string, boolean>;
        defaults: Record<string, unknown>; // Dynamic: server-defined default configuration values
    }> {
        return this.client.http.authedRequest(
            Method.Get,
            "/_matrix/client/v1/config/client",
        );
    }

    /**
     * Get SSO/OIDC userinfo (synapse-rust specific).
     * GET /_matrix/client/v3/login/sso/userinfo
     */
    public async getSSOUserInfo(): Promise<{
        sub: string;
        name?: string;
        picture?: string;
        email?: string;
    }> {
        return this.client.http.authedRequest(
            Method.Get,
            "/_matrix/client/v3/login/sso/userinfo",
        );
    }

    /**
     * Perform a single MSC3575 sliding sync request.
     * @param req - The request to make.
     * @param proxyBaseUrl - The base URL for the sliding sync proxy.
     * @param abortSignal - Optional signal to abort request mid-flight.
     * @returns The sliding sync response.
     */
    public async slidingSync(
        req: MSC3575SlidingSyncRequest,
        proxyBaseUrl?: string,
        abortSignal?: AbortSignal,
    ): Promise<MSC3575SlidingSyncResponse> {
        const qps: Record<string, string | number> = {};
        if (req.pos !== undefined) {
            qps.pos = req.pos;
        }
        if (req.timeout !== undefined) {
            qps.timeout = req.timeout;
        }
        const clientTimeout = req.clientTimeout;
        const { pos: _pos, timeout: _timeout, clientTimeout: _clientTimeout, ...body } = req;
        return this.client.http.authedRequest(
            Method.Post,
            "/sync",
            qps,
            body,
            {
                prefix: "/_matrix/client/unstable/org.matrix.simplified_msc3575",
                baseUrl: proxyBaseUrl,
                localTimeoutMs: clientTimeout,
                abortSignal,
            },
        );
    }
}
