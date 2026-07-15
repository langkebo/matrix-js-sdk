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
    type IContextResponse,
} from "../@types/requests";
import { type RoomAccountDataEvents, EventType } from "../@types/event";
import { type IContent } from "../models/event";
import { type IRoomEventFilter } from "../filter";
import { InvalidParamError } from "../common/errors";
import { validateRoomId, validateUserId } from "../common/validators";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import * as utils from "../utils";
import { logger } from "../logger";
import { KnownMembership } from "../@types/membership";
import { IThirdPartySigned, IJoinRequestBody, ITagMetadata, IRoomHierarchy } from "../client-internal-types";
import { IRoomInitialSyncResponse, type IPreviewUrlResponse } from "../client-api-types";
import { QueryDict } from "../http-api/utils";
import { SyncApi } from "../sync";
import { searchRoomsRequest } from "../client-secure-backup-requests";
import type { Body, IRequestOpts } from "../http-api/interface";
import { LRUCache } from "../utils/lru-cache";
import { InflightRequestCache } from "../utils/inflight-request-cache";
import { Visibility, GuestAccess, HistoryVisibility } from "../@types/partials";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import * as ContentHelpers from "../content-helpers";
import { beginRoomPeek, endRoomPeek } from "../client-room-peek";
import type { InviteRequest } from "./__generated__/dto";
import type { RoomPathPattern } from "./__generated__/route-table";
import type { TagsPathPattern } from "../tags/__generated__/route-table";
import type { SlidingSyncPathPattern } from "../sliding-sync/__generated__/route-table";
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

export interface RoomCapabilities {
    [capabilityName: string]: {
        enabled?: boolean;
        [key: string]: unknown;
    };
}

export interface IRoomCapabilitiesResponse {
    capabilities: RoomCapabilities;
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
type StripSimplifiedSlidingSync<P extends string> =
    P extends `/_matrix/client/unstable/org.matrix.simplified_msc3575${infer Rest}` ? Rest : never;
type RoomManagerPathPattern =
    | StripR0<RoomPathPattern | TagsPathPattern>
    | StripV1<RoomPathPattern>
    | StripV3<RoomPathPattern | TagsPathPattern>
    | StripSimplifiedSlidingSync<SlidingSyncPathPattern>;

function rp<P extends RoomManagerPathPattern>(path: P): P {
    return path;
}

export class RoomManager extends BaseManager<RoomEvent, RoomManagerEventMap> {
    private roomInfoCache: LRUCache<RoomInfoCacheEntry>;
    private membersCache: LRUCache<IStateEvent[]>;
    private stateCache: LRUCache<IStateEvent[]>;
    private peekSync: SyncApi | null = null;
    private readonly urlPreviewRequestCache: InflightRequestCache<IPreviewUrlResponse>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);

        this.roomInfoCache = new LRUCache<RoomInfoCacheEntry>(100, 5 * 60 * 1000);
        this.membersCache = new LRUCache<IStateEvent[]>(100, 2 * 60 * 1000);
        this.stateCache = new LRUCache<IStateEvent[]>(50, 5 * 60 * 1000);
        this.urlPreviewRequestCache = new InflightRequestCache<IPreviewUrlResponse>(client.urlPreviewCache);
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
        validateRoomId(roomId);

        const cacheKey = `version:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "room_version" in cached && typeof cached.room_version === "string") {
                return cached.room_version;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomVersionResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/version`),
                prefix: ClientPrefix.V3,
            });
        });

        this.roomInfoCache.set(cacheKey, { room_version: response.room_version });
        return response.room_version;
    }

    public async getRoomCapabilities(roomId: string, forceRefresh = false): Promise<IRoomCapabilitiesResponse> {
        validateRoomId(roomId);

        const cacheKey = `capabilities:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "capabilities" in cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomCapabilitiesResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/capabilities`),
                prefix: ClientPrefix.V3,
            });
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    public async getRoomMetadata(roomId: string, forceRefresh = false): Promise<IRoomMetadataResponse> {
        validateRoomId(roomId);

        const cacheKey = `metadata:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "room_id" in cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomMetadataResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/metadata`),
                prefix: ClientPrefix.V3,
            });
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
            return await this.request<{ room_id: string }>({
                method: Method.Post,
                path: rp("/createRoom"),
                body: options,
                prefix: ClientPrefix.V3,
            });
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

        const queryParams: Record<string, string | string[]> = {};
        if (opts.viaServers) {
            queryParams.via = queryParams.server_name = opts.viaServers.slice(0, 3);
        }

        const data: IJoinRequestBody = {};
        const signedInviteObj = await signPromise;
        if (signedInviteObj) {
            data.third_party_signed = signedInviteObj;
        }

        const path = rp(`/join/${encodeURIComponent(roomIdOrAlias)}`);
        const res = await this.request<{ room_id: string }>({
            method: Method.Post,
            path: path,
            queryParams: queryParams,
            body: data,
            prefix: ClientPrefix.V3,
        });

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

        const queryParams: Record<string, string | string[]> = {};
        if (opts.viaServers) {
            const viaServers = Array.isArray(opts.viaServers) ? opts.viaServers.slice(0, 3) : [opts.viaServers];
            queryParams.server_name = viaServers;
            queryParams.via = viaServers;
        }

        const body: Record<string, string> = {};
        if (opts.reason) {
            body.reason = opts.reason;
        }

        return this.withRetry(
            async () => {
                return await this.request({
                    method: Method.Post,
                    path: path,
                    queryParams: queryParams,
                    body: body,
                    prefix: ClientPrefix.V3,
                });
            },
            { label: "knockRoom", idempotent: false },
        );
    }

    public async leave(roomId: string): Promise<EmptyObject> {
        validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/leave`),
                body: {},
                prefix: ClientPrefix.V3,
            });
        });

        this.emit(RoomEvent.RoomLeft, roomId);
        this.clearRoomCache(roomId);
        return response;
    }

    public async forget(roomId: string, deleteRoom = true): Promise<EmptyObject> {
        validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/forget`),
                body: { delete_room: deleteRoom },
                prefix: ClientPrefix.V3,
            });
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
        validateRoomId(roomId);

        if (!forceRefresh && !params) {
            const cached = this.membersCache.get(`members:${roomId}`);
            if (cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IGetMembersResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/members`),
                queryParams: params as Record<string, string>,
                prefix: ClientPrefix.V3,
            });
        });

        if (!params) {
            this.membersCache.set(`members:${roomId}`, response.chunk);
        }
        return response.chunk;
    }

    public async getJoinedMembers(roomId: string, forceRefresh = false): Promise<IJoinedMembersResponse> {
        validateRoomId(roomId);

        const cacheKey = `joined_members:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "joined" in cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IJoinedMembersResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/joined_members`),
                prefix: ClientPrefix.V3,
            });
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
        validateRoomId(roomId);
        validateUserId(userId);

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IStateEvent>({
                    method: Method.Get,
                    path: rp(`/rooms/${encodeURIComponent(roomId)}/membership/${encodeURIComponent(userId)}`),
                    prefix: ClientPrefix.V3,
                });
            });

            return response;
            // @swallow-error { owner: "room", expires: "2026-12-31" }
        } catch (error: unknown) {
            if (throwOnError) {
                throw error;
            }
            const err = error as Record<string, unknown>; /* Dynamic: error shape varies by source */
            const httpStatus = err?.httpStatus as number | undefined;
            if (httpStatus === 404) {
                return null;
            }
            throw error;
        }
    }

    // ==================== Member Actions ====================

    public async invite(roomId: string, userId: string, opts: InviteOpts | string = {}): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const normalizedOpts = typeof opts === "string" ? { reason: opts } : opts;

        if (normalizedOpts.shareEncryptedHistory) {
            await this.client.getCrypto()?.shareRoomHistoryWithUser(roomId, userId);
        }

        const body: InviteRequest = {
            user_id: userId,
            ...(normalizedOpts.reason ? { reason: normalizedOpts.reason } : {}),
        };

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/invite`),
                body: body,
                prefix: ClientPrefix.V3,
            });
        });

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberJoined, roomId, userId);
        return response;
    }

    public async inviteByEmail(roomId: string, email: string): Promise<EmptyObject> {
        return this.inviteByThreePid(roomId, "email", email);
    }

    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        const identityAccessToken = this.client.identityServer?.getAccessToken
            ? await this.client.identityServer.getAccessToken()
            : undefined;

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/invite`),
                body: {
                    id_server: this.client.getIdentityServerManager().getIdentityServerUrl(true),
                    id_access_token: identityAccessToken,
                    medium,
                    address,
                },
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async kick(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/kick`),
                body: { user_id: userId, reason },
                prefix: ClientPrefix.V3,
            });
        });

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberLeft, roomId, userId);
        return response;
    }

    public async ban(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/ban`),
                body: { user_id: userId, reason },
                prefix: ClientPrefix.V3,
            });
        });

        this.membersCache.delete(`members:${roomId}`);
        return response;
    }

    public async unban(roomId: string, userId: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/unban`),
                body: { user_id: userId },
                prefix: ClientPrefix.V3,
            });
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
        validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomEvent>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: IRoomEventFilter },
    ): Promise<IContextResponse> {
        validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const queryParams: Record<string, string> = {};
        if (params?.limit !== undefined) queryParams.limit = params.limit.toString();
        if (params?.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.request<IContextResponse>({
            method: Method.Get,
            path: rp(`/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(eventId)}`),
            queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
            prefix: ClientPrefix.V3,
        });

        return response;
    }

    public async redactEvent(
        roomId: string,
        eventId: string,
        reason?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const txn = txnId || `m${Date.now()}`;
        const response = await this.withRetry(async () => {
            return await this.request<ISendEventResponse>({
                method: Method.Put,
                path: rp(
                    `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(txn)}`,
                ),
                body: reason ? { reason } : {},
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    // ==================== Tags ====================

    public async getRoomTags(roomId: string): Promise<ITagsResponse> {
        validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.request<ITagsResponse>({
                method: Method.Get,
                path: rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                    }) as StripV3<TagsPathPattern>,
                ),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async setRoomTag(roomId: string, tagName: string, metadata: ITagMetadata = {}): Promise<EmptyObject> {
        validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                        $tag: tagName,
                    }) as StripV3<TagsPathPattern>,
                ),
                body: metadata,
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async deleteRoomTag(roomId: string, tagName: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Delete,
                path: rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                        $tag: tagName,
                    }) as StripV3<TagsPathPattern>,
                ),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    // ==================== Account Data ====================

    public async setRoomAccountData<K extends keyof RoomAccountDataEvents>(
        roomId: string,
        eventType: K,
        content: RoomAccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: utils.encodeUri("/rooms/$roomId/account_data/$type", { $roomId: roomId, $type: eventType }),
                body: content,
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    // ==================== Room Directory ====================

    public async getRoomDirectoryVisibility(roomId: string): Promise<{ visibility: Visibility }> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<{ visibility: Visibility }>({
                method: Method.Get,
                path: utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId }),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async setRoomDirectoryVisibility(roomId: string, visibility: Visibility): Promise<EmptyObject> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId }),
                body: { visibility },
                prefix: ClientPrefix.V3,
            });
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
        validateRoomId(roomId);
        const path = utils.encodeUri("/rooms/$roomId/hierarchy", { $roomId: roomId });
        const query: QueryDict = {
            suggested_only: String(suggestedOnly),
            max_depth: maxDepth?.toString(),
            from: fromToken,
            limit: limit?.toString(),
        };

        try {
            return await this.request<IRoomHierarchy>({
                method: Method.Get,
                path: path,
                queryParams: query as Record<string, string | string[]>,
                prefix: ClientPrefix.V1,
            });
        } catch (e) {
            if ((e as MatrixError).errcode === "M_UNRECOGNIZED") {
                return await this.request<IRoomHierarchy>({
                    method: Method.Get,
                    path: path,
                    queryParams: query as Record<string, string | string[]>,
                    prefix: "/_matrix/client/unstable/org.matrix.msc2946",
                });
            }
            throw e;
        }
    }

    public async getRoomIdForAlias(roomAlias: string): Promise<{ room_id: string; servers: string[] }> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        const response = await this.withRetry(async () => {
            return await this.request<{ room_id: string; servers: string[] }>({
                method: Method.Get,
                path: utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async createAlias(roomAlias: string, roomId: string): Promise<EmptyObject> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                body: { room_id: roomId },
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async deleteAlias(roomAlias: string): Promise<EmptyObject> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Delete,
                path: utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async getLocalAliases(roomId: string): Promise<{ aliases: string[] }> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<{ aliases: string[] }>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/aliases`),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    // ==================== Room Management ====================

    public async upgradeRoom(
        roomId: string,
        newVersion: string,
        additionalCreators?: string[],
    ): Promise<{ replacement_room: string }> {
        validateRoomId(roomId);
        const body: { new_version: string; additional_creators?: string[] } = {
            new_version: newVersion,
        };
        if (additionalCreators) {
            body.additional_creators = additionalCreators;
        }

        const response = await this.withRetry(async () => {
            return await this.request<{ replacement_room: string }>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/upgrade`),
                body: body,
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async reportRoom(roomId: string, reason: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/report`),
                body: { reason },
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async roomInitialSync(roomId: string): Promise<IRoomInitialSyncResponse> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<IRoomInitialSyncResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/initialSync`),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        validateRoomId(roomId);
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
        validateRoomId(roomId);
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
        validateRoomId(roomId);
        const path = `/rooms/${encodeURIComponent(roomId)}/typing`;
        const response = await this.request<{ user_ids: string[] }>({
            method: Method.Get,
            path: path,
            prefix: ClientPrefix.V3,
        });
        return response.user_ids || [];
    }

    public async getBatchTyping(roomIds: string[]): Promise<Record<string, string[]>> {
        const path = "/rooms/typing";
        const response = await this.request<{
            rooms: Record<string, { user_ids: string[] }>;
        }>({ method: Method.Post, path: path, body: { room_ids: roomIds }, prefix: ClientPrefix.V3 });

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
            this.request<IPreviewUrlResponse>({
                method: Method.Get,
                path: "/preview_url",
                queryParams: { url: normalizedUrl, ts: bucketedTs.toString() },
                prefix: MediaPrefix.V3,
            }),
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
        const response = await this.request<IMyRoomsResponse>({
            method: Method.Get,
            path: "/_matrix/client/v3/my_rooms",
            prefix: ClientPrefix.V3,
        });
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
            <T>(
                method: Method,
                path: string,
                queryParams?: QueryDict,
                body?: Body,
                requestOpts?: IRequestOpts,
            ): Promise<T> =>
                this.request<T>({
                    method,
                    path,
                    queryParams: queryParams as Record<string, string | string[]>,
                    body,
                    prefix: requestOpts?.prefix ?? ClientPrefix.V3,
                }),
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
        return this.request({ method: Method.Get, path: "/_matrix/client/v1/config/client", prefix: ClientPrefix.V3 });
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
        return this.request({
            method: Method.Get,
            path: "/_matrix/client/v3/login/sso/userinfo",
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * Check whether the homeserver advertises the synapse-rust sliding-sync surface.
     *
     * Falls back to true for clients that do not expose centralized feature discovery
     * so existing proxy-based sliding-sync deployments keep working.
     */
    public async isSlidingSyncSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.SlidingSync, true);
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
        _proxyBaseUrl?: string,
        _abortSignal?: AbortSignal,
    ): Promise<MSC3575SlidingSyncResponse> {
        const qps: Record<string, string | string[] | number> = {};
        if (req.pos !== undefined) {
            qps.pos = req.pos;
        }
        if (req.timeout !== undefined) {
            qps.timeout = req.timeout;
        }
        const { pos: _pos, timeout: _timeout, clientTimeout, ...body } = req;
        return this.request({
            method: Method.Post,
            path: rp("/sync"),
            queryParams: qps,
            body: body,
            prefix: "/_matrix/client/unstable/org.matrix.simplified_msc3575",
            localTimeoutMs: clientTimeout,
        });
    }
}
